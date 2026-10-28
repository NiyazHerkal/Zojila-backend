import { randomUUID } from 'node:crypto';
import { existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { io, type Socket } from 'socket.io-client';
import request from 'supertest';
import { In, Repository } from 'typeorm';
import { AppModule } from './../src/app.module.js';
import { Group, User } from './../src/database/entities/index.js';
import { ElevationProvider } from './../src/enrichment/elevation.provider.js';
import { MapTileProvider } from './../src/enrichment/map-tile.provider.js';
import { NoRoadRouteError, RoutingProvider, type RoutePoint } from './../src/enrichment/routing.provider.js';
import { WeatherProvider } from './../src/enrichment/weather.provider.js';
import { OtpDeliveryService } from './../src/notifications/otp-delivery.service.js';

// Frontend requests of 2026-10-14: edit the trip (live `group:updated` / `itinerary:updated`),
// profile pictures instead of initials, and a road-route map through the stops.
describe('Trip edits, profile pictures and the route map (e2e)', () => {
  let app: INestApplication;
  let baseUrl: string;
  let users: Repository<User>;
  let groups: Repository<Group>;
  const otpCodes = new Map<string, string>();
  const sockets: Socket[] = [];

  const suffix = randomUUID().slice(0, 8);
  const uploads = resolve(process.env.UPLOAD_DIR || 'uploads');
  interface TestUser {
    id: string;
    username: string;
    token: string;
  }
  const userIds: string[] = [];
  let alice: TestUser; // admin
  let bob: TestUser; // viewer
  let groupId: string;
  let bobSocket: Socket;

  // Fake router: a midpoint per leg. "No road" to anything north of 34° (Leh), to test the fallback.
  let routeCalls = 0;
  let routingDown = false;
  const routing: RoutingProvider = {
    configured: true,
    profile: 'driving',
    attribution: 'Routes: test',
    route: async (points: RoutePoint[]) => {
      routeCalls++;
      if (routingDown) throw new Error('timeout');
      if (points.some((p) => p.lat > 34)) throw new NoRoadRouteError('no road');
      const coordinates: [number, number][] = [[points[0].lng, points[0].lat]];
      const legs = points.slice(1).map((b, i) => {
        const a = points[i];
        coordinates.push([(a.lng + b.lng) / 2, (a.lat + b.lat) / 2], [b.lng, b.lat]);
        return { distanceMeters: 60_000, durationSeconds: 3600 };
      });
      return { distanceMeters: legs.length * 60_000, durationSeconds: legs.length * 3600, coordinates, legs };
    },
  };

  const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);
  const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 2)]);
  const ONE_PIXEL_PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
    'base64',
  );
  const manali = { name: 'Manali', lat: 32.2432, lng: 77.1892 };
  const keylong = { name: 'Keylong', lat: 32.5715, lng: 77.0326 };
  const jispa = { name: 'Jispa', lat: 32.6403, lng: 77.1887 };
  const leh = { name: 'Leh', lat: 34.1526, lng: 77.5771 };

  const http = () => request(app.getHttpServer());
  const as = (u: TestUser) => ({ Authorization: `Bearer ${u.token}` });
  const next = (socket: Socket, event: string) => new Promise<Record<string, any>>((r) => socket.once(event, r));
  const itin = () => `/groups/${groupId}/itinerary`;
  const pathOf = (url: string) => new URL(url).pathname + new URL(url).search;

  async function registerUser(label: string): Promise<TestUser> {
    const email = `trip-edits-e2e.${label}.${suffix}@example.com`;
    const username = `${label}_${suffix}`;
    const signup = await http()
      .post('/auth/signup')
      .send({ email, username, password: 'Str0ng!Pass', name: `E2E ${label}` })
      .expect(201);
    const verified = await http()
      .post('/auth/verify')
      .send({ userId: signup.body.userId, code: otpCodes.get(email) })
      .expect(201);
    userIds.push(signup.body.userId);
    return { id: signup.body.userId, username, token: verified.body.accessToken };
  }

  async function connect(u: TestUser): Promise<Socket> {
    const socket = io(baseUrl, { auth: { token: u.token }, transports: ['websocket'], reconnection: false });
    sockets.push(socket);
    await new Promise((r) => socket.once('ready', r));
    return socket;
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(OtpDeliveryService)
      .useValue({
        sendEmail: async (to: string, code: string) => void otpCodes.set(to, code),
        sendSms: async (to: string, code: string) => void otpCodes.set(to, code),
      })
      .overrideProvider(RoutingProvider)
      .useValue(routing)
      .overrideProvider(ElevationProvider)
      .useValue({ configured: false, getElevation: async () => 0 })
      .overrideProvider(WeatherProvider)
      .useValue({ configured: false, name: 'off', attribution: '', forecastDays: 8, getDailyForecast: async () => [] })
      .overrideProvider(MapTileProvider)
      .useValue({ configured: true, attribution: '© OpenStreetMap contributors', getTile: async () => ONE_PIXEL_PNG })
      .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.listen(0, '127.0.0.1'); // sockets need a real port
    baseUrl = (await app.getUrl()).replace('[::1]', '127.0.0.1');
    users = moduleFixture.get(getRepositoryToken(User));
    groups = moduleFixture.get(getRepositoryToken(Group));

    alice = await registerUser('alice');
    bob = await registerUser('bob');
    const group = await http()
      .post('/groups')
      .set(as(alice))
      .send({ name: 'Lahaul Loop', description: 'd', tripStart: '2026-10-10T00:00:00Z', tripEnd: '2026-10-19T00:00:00Z' })
      .expect(201);
    groupId = group.body.id;
    await http().post(`/groups/${groupId}/members`).set(as(alice)).send({ username: bob.username }).expect(201);
    bobSocket = await connect(bob);
  });

  afterAll(async () => {
    sockets.forEach((s) => s.disconnect());
    if (userIds.length) {
      await groups.delete({ createdById: In(userIds) });
      await users.delete({ id: In(userIds) });
    }
    await app.close();
  });

  describe('editing the trip', () => {
    it('sends group:updated with the new details to every member', async () => {
      const updated = next(bobSocket, 'group:updated');
      const res = await http()
        .patch(`/groups/${groupId}`)
        .set(as(alice))
        .send({ name: 'Lahaul & Spiti Loop', tripEnd: '2026-10-20T00:00:00Z' })
        .expect(200);
      const event = await updated;
      expect(event).toMatchObject({
        groupId,
        changedBy: alice.id,
        group: { id: groupId, name: 'Lahaul & Spiti Loop', tripEnd: '2026-10-20T00:00:00.000Z' },
      });
      expect(event.group).not.toHaveProperty('myRole'); // differs per member
      expect(res.body.myRole).toBe('ADMIN');
    });

    it('also on cover image changes and close/reopen, but not on a no-op reopen', async () => {
      const cover = next(bobSocket, 'group:updated');
      await http().post(`/groups/${groupId}/cover-image`).set(as(alice)).attach('file', PNG, 'c.png').expect(200);
      expect((await cover).group.coverImageUrl).toMatch(/cover-image\?v=/);

      const closed = next(bobSocket, 'group:updated');
      await http().post(`/groups/${groupId}/close`).set(as(alice)).expect(200);
      expect((await closed).group.closedAt).not.toBeNull();
      const reopened = next(bobSocket, 'group:updated');
      await http().post(`/groups/${groupId}/reopen`).set(as(alice)).expect(200);
      expect((await reopened).group.closedAt).toBeNull();

      let announced = false;
      bobSocket.once('group:updated', () => (announced = true));
      await http().post(`/groups/${groupId}/reopen`).set(as(alice)).expect(200);
      await new Promise((r) => setTimeout(r, 300));
      expect(announced).toBe(false);
      bobSocket.off('group:updated');
    });
  });

  describe('profile pictures', () => {
    const url = '/auth/me/avatar';

    it('rejects missing, non-image, PDF and oversized files', async () => {
      await http().post(url).expect(401);
      await http().post(url).set(as(alice)).expect(400);
      await http().post(url).set(as(alice)).attach('file', Buffer.from('plain text, not an image'), 'a.jpg').expect(415);
      await http().post(url).set(as(alice)).attach('file', Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(64)]), 'a.pdf').expect(415);
      await http()
        .post(url)
        .set(as(alice))
        .attach('file', Buffer.concat([PNG, Buffer.alloc(5 * 1024 * 1024)]), 'big.png')
        .expect(413);
    });

    it('uploads, shows the photo to the group, serves it without a token, replaces and removes it', async () => {
      const announced = next(bobSocket, 'user:profile_updated');
      const first = await http().post(url).set(as(alice)).attach('file', PNG, 'me.png').expect(200);
      expect(first.body).toMatchObject({ id: alice.id, username: alice.username });
      expect(first.body.avatarUrl).toMatch(new RegExp(`/users/${alice.id}/avatar\\?v=[0-9a-f-]{36}$`));
      expect(await announced).toMatchObject({ userId: alice.id, avatarUrl: first.body.avatarUrl });

      // Every user object already carries avatarUrl, e.g. the member list.
      const members = await http().get(`/groups/${groupId}/members`).set(as(bob)).expect(200);
      expect(members.body.find((m: { userId: string }) => m.userId === alice.id).avatarUrl).toBe(first.body.avatarUrl);

      const file = await http().get(pathOf(first.body.avatarUrl)).buffer(true).expect(200); // no Authorization
      expect(file.headers['content-type']).toBe('image/png');
      expect(file.headers['cache-control']).toBe('public, max-age=31536000, immutable');
      expect(Buffer.compare(file.body as Buffer, PNG)).toBe(0);

      const second = await http().post(url).set(as(alice)).attach('file', JPEG, 'me.jpg').expect(200);
      expect(second.body.avatarUrl).not.toBe(first.body.avatarUrl);
      expect(readdirSync(resolve(uploads, 'avatars', alice.id))).toHaveLength(1);
      const replaced = await http().get(pathOf(second.body.avatarUrl)).buffer(true).expect(200);
      expect(replaced.headers['content-type']).toBe('image/jpeg');

      const removed = next(bobSocket, 'user:profile_updated');
      const res = await http().delete(url).set(as(alice)).expect(200);
      expect(res.body.avatarUrl).toBeNull();
      expect((await removed).avatarUrl).toBeNull();
      expect(readdirSync(resolve(uploads, 'avatars', alice.id))).toHaveLength(0);
      await http().get(`/users/${alice.id}/avatar`).expect(404);
      await http().delete(url).set(as(alice)).expect(200); // nothing to remove is fine
      await http().get('/users/not-a-uuid/avatar').expect(400);
    });

    it('drops the uploaded file when PATCH /auth/me sets an external avatarUrl', async () => {
      await http().post(url).set(as(bob)).attach('file', PNG, 'me.png').expect(200);
      const res = await http()
        .patch('/auth/me')
        .set(as(bob))
        .send({ avatarUrl: 'https://cdn.example.com/bob.jpg' })
        .expect(200);
      expect(res.body.avatarUrl).toBe('https://cdn.example.com/bob.jpg');
      expect(readdirSync(resolve(uploads, 'avatars', bob.id))).toHaveLength(0);
      await http().get(`/users/${bob.id}/avatar`).expect(404);
    });

    it('announces a name change too', async () => {
      const announced = next(bobSocket, 'user:profile_updated'); // own other devices get it as well
      await http().patch('/auth/me').set(as(bob)).send({ name: 'Bob R' }).expect(200);
      expect(await announced).toMatchObject({ userId: bob.id, name: 'Bob R' });
    });
  });

  describe('route map', () => {
    let draft: { revision: number; waypoints: { id: string; activityId: string; lat: number; lng: number }[] };

    it('joins the draft stops along roads, computed once and cached', async () => {
      await http().post(`${itin()}/draft`).set(as(alice)).expect(201);
      for (const stop of [manali, keylong, { ...jispa, date: '2026-10-12' }]) {
        draft = (await http().post(`${itin()}/draft/waypoints`).set(as(alice)).send(stop).expect(201)).body;
      }
      await http().get(`${itin()}/draft/route`).set(as(bob)).expect(403);
      await http().get(`${itin()}/route`).set(as(bob)).expect(404); // nothing finalized yet

      routeCalls = 0;
      const res = await http().get(`${itin()}/draft/route`).set(as(alice)).expect(200);
      expect(res.body).toMatchObject({
        itineraryStatus: 'DRAFT',
        version: null,
        status: 'OK',
        profile: 'driving',
        distanceMeters: 120_000,
        durationSeconds: 7200,
        attribution: 'Routes: test',
        legs: [
          { fromActivityId: draft.waypoints[0].activityId, toActivityId: draft.waypoints[1].activityId, routed: true },
          { fromActivityId: draft.waypoints[1].activityId, toActivityId: draft.waypoints[2].activityId, routed: true },
        ],
      });
      expect(res.body.geometry.type).toBe('LineString');
      expect(res.body.geometry.coordinates).toHaveLength(5);

      await http().get(`${itin()}/draft/route`).set(as(alice)).expect(200);
      expect(routeCalls).toBe(1); // second read came from the cache

      // Renaming a stop keeps the cache; moving one rebuilds it.
      await http().patch(`${itin()}/draft/waypoints/${draft.waypoints[1].id}`).set(as(alice)).send({ name: 'Keylong town' }).expect(200);
      await http().get(`${itin()}/draft/route`).set(as(alice)).expect(200);
      expect(routeCalls).toBe(1);
      await http().patch(`${itin()}/draft/waypoints/${draft.waypoints[1].id}`).set(as(alice)).send({ lat: 32.58, lng: draft.waypoints[1].lng }).expect(200);
      await http().get(`${itin()}/draft/route`).set(as(alice)).expect(200);
      expect(routeCalls).toBe(2);
    });

    it('uses a straight line for a leg with no road, and retries after a provider failure', async () => {
      draft = (await http().post(`${itin()}/draft/waypoints`).set(as(alice)).send({ ...leh, date: '2026-10-25' }).expect(201)).body;
      const partial = await http().get(`${itin()}/draft/route`).set(as(alice)).expect(200);
      expect(partial.body.status).toBe('PARTIAL');
      expect(partial.body.legs.map((l: { routed: boolean }) => l.routed)).toEqual([true, true, false]);
      expect(partial.body.legs[2].durationSeconds).toBeNull();
      expect(partial.body.durationSeconds).toBeNull();
      expect(partial.body.geometry.coordinates.at(-1)).toEqual([leh.lng, leh.lat]);

      routingDown = true;
      await http().patch(`${itin()}/draft/waypoints/${draft.waypoints[3].id}`).set(as(alice)).send({ lat: draft.waypoints[3].lat, lng: 77.58 }).expect(200);
      const down = await http().get(`${itin()}/draft/route`).set(as(alice)).expect(200);
      expect(down.body.status).toBe('UNAVAILABLE');
      expect(down.body.geometry.coordinates).toHaveLength(4); // straight through the 4 stops
      routingDown = false;
      const calls = routeCalls;
      const back = await http().get(`${itin()}/draft/route`).set(as(alice)).expect(200);
      expect(back.body.status).toBe('PARTIAL'); // the failure wasn't cached
      expect(routeCalls).toBeGreaterThan(calls);
    });

    it('flags stops dated outside the trip', async () => {
      const res = await http().get(`${itin()}/draft`).set(as(alice)).expect(200);
      expect(res.body.waypoints.map((w: { outsideTripDates: boolean }) => w.outsideTripDates)).toEqual([
        false, // no date
        false,
        false, // 2026-10-12
        true, // 2026-10-25, after the trip ends on the 20th
      ]);
    });

    it('publishes with itinerary:updated; members read the route and the PDF draws it', async () => {
      const published = next(bobSocket, 'itinerary:updated');
      await http().post(`${itin()}/draft/finalize`).set(as(alice)).expect(201);
      expect(await published).toMatchObject({ groupId, version: 1 });

      const res = await http().get(`${itin()}/route`).set(as(bob)).expect(200);
      expect(res.body).toMatchObject({ itineraryStatus: 'LOCKED', version: 1, status: 'PARTIAL' });
      await http().get(`${itin()}/route?version=1`).set(as(bob)).expect(200);
      await http().get(`${itin()}/route?version=9`).set(as(bob)).expect(404);

      const pdf = await http().get(`${itin()}/pdf`).set(as(bob)).buffer(true).expect(200);
      expect(pdf.headers['content-type']).toBe('application/pdf');
      expect((pdf.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
    });
  });

  it('deletes the profile picture with the account', async () => {
    await http().post('/auth/me/avatar').set(as(bob)).attach('file', PNG, 'me.png').expect(200);
    await http().delete('/auth/me').set(as(bob)).send({ password: 'Str0ng!Pass' }).expect(200);
    expect(existsSync(resolve(uploads, 'avatars', bob.id))).toBe(false);
    await http().get(`/users/${bob.id}/avatar`).expect(404);
  });
});
