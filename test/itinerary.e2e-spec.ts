import { randomUUID } from 'node:crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import { In, Repository } from 'typeorm';
import { AppModule } from './../src/app.module.js';
import { Group, User } from './../src/database/entities/index.js';
import { ElevationProvider } from './../src/enrichment/elevation.provider.js';
import { MapTileProvider } from './../src/enrichment/map-tile.provider.js';
import { WeatherProvider } from './../src/enrichment/weather.provider.js';
import { OtpDeliveryService } from './../src/notifications/otp-delivery.service.js';

// Phase 6 DoD against the real dev Postgres: a map-built itinerary can be edited, finalized and
// exported as a PDF. Third-party APIs are faked (no keys yet), so enrichment output is known.
describe('Itinerary (e2e)', () => {
  let app: INestApplication;
  let users: Repository<User>;
  let groups: Repository<Group>;
  const otpCodes = new Map<string, string>();

  const suffix = randomUUID().slice(0, 8);
  const isoDay = (offset: number) =>
    new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
  const ONE_PIXEL_PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
    'base64',
  );

  interface TestUser {
    id: string;
    username: string;
    token: string;
  }
  const userIds: string[] = [];
  let alice: TestUser; // admin
  let bob: TestUser; // viewer
  let carol: TestUser; // not a member
  let groupId: string;

  const http = () => request(app.getHttpServer());
  const as = (u: TestUser) => ({ Authorization: `Bearer ${u.token}` });
  const base = () => `/groups/${groupId}/itinerary`;

  async function registerUser(label: string): Promise<TestUser> {
    const email = `itin-e2e.${label}.${suffix}@example.com`; // not `e2e.%`, which the auth suite's cleanup matches
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
    return {
      id: signup.body.userId,
      username,
      token: verified.body.accessToken,
    };
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(OtpDeliveryService)
      .useValue({
        sendEmail: async (to: string, code: string) =>
          void otpCodes.set(to, code),
        sendSms: async (to: string, code: string) =>
          void otpCodes.set(to, code),
      })
      .overrideProvider(ElevationProvider)
      .useValue({
        configured: true,
        getElevation: async (lat: number) => (lat > 34 ? 3524 : 2050),
      })
      .overrideProvider(WeatherProvider)
      .useValue({
        configured: true,
        name: 'fake',
        attribution: 'Weather: fake',
        forecastDays: 8,
        getDailyForecast: async () =>
          Array.from({ length: 8 }, (_, i) => ({
            date: isoDay(i),
            summary: 'light snow',
            tempMinC: -2,
            tempMaxC: 9,
            precipitationChancePercent: 40,
            windSpeedKph: 15,
          })),
      })
      .overrideProvider(MapTileProvider)
      .useValue({
        configured: true,
        attribution: '© OpenStreetMap contributors',
        getTile: async () => ONE_PIXEL_PNG,
      })
      .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();
    users = moduleFixture.get(getRepositoryToken(User));
    groups = moduleFixture.get(getRepositoryToken(Group));

    alice = await registerUser('alice');
    bob = await registerUser('bob');
    carol = await registerUser('carol');

    const group = await http()
      .post('/groups')
      .set(as(alice))
      .send({
        name: 'Ladakh Ride 2026',
        description: 'Manali to Leh',
        tripStart: '2026-10-10T00:00:00Z',
        tripEnd: '2026-10-19T00:00:00Z',
      })
      .expect(201);
    groupId = group.body.id;
    await http()
      .post(`/groups/${groupId}/members`)
      .set(as(alice))
      .send({ username: bob.username })
      .expect(201);
  });

  afterAll(async () => {
    if (userIds.length) {
      await groups.delete({ createdById: In(userIds) });
      await users.delete({ id: In(userIds) });
    }
    await app.close();
  });

  const manali = { name: 'Manali', lat: 32.2432, lng: 77.1892 };
  const keylong = { name: 'Keylong', lat: 32.5717, lng: 77.0339 };
  const leh = { name: 'Leh', lat: 34.1526, lng: 77.5771 };

  it('enforces access: members-only, draft is admin-only, nothing finalized yet', async () => {
    await http().get(base()).set(as(carol)).expect(404); // not a member
    const none = await http().get(base()).set(as(bob)).expect(404);
    expect(none.body.message).toMatch(/no finalized itinerary/i);
    await http().post(`${base()}/draft`).set(as(bob)).expect(403);
    await http().get(`${base()}/draft`).set(as(alice)).expect(404);
    await http()
      .post(`${base()}/draft/waypoints`)
      .set(as(alice))
      .send(manali)
      .expect(404); // no draft yet
  });

  it('starts one empty draft per group', async () => {
    const draft = await http()
      .post(`${base()}/draft`)
      .set(as(alice))
      .expect(201);
    expect(draft.body).toMatchObject({
      status: 'DRAFT',
      version: null,
      basedOnVersion: null,
      waypoints: [],
    });
    await http().post(`${base()}/draft`).set(as(alice)).expect(409);
  });

  it('drops pins with enrichment, and derives start/mid/end from the order', async () => {
    await http()
      .post(`${base()}/draft/waypoints`)
      .set(as(alice))
      .send({ ...manali, lat: 100 })
      .expect(400);
    await http()
      .post(`${base()}/draft/waypoints`)
      .set(as(alice))
      .send({ ...manali, date: '10/10/2026' })
      .expect(400);
    await http()
      .post(`${base()}/draft/waypoints`)
      .set(as(bob))
      .send(manali)
      .expect(403);

    const one = await http()
      .post(`${base()}/draft/waypoints`)
      .set(as(alice))
      .send({ ...manali, date: isoDay(2), notes: 'Fuel up' })
      .expect(201);
    expect(one.body.waypoints).toHaveLength(1);
    expect(one.body.waypoints[0]).toMatchObject({
      position: 1,
      role: 'START',
      elevation: { status: 'OK', meters: 2050, zone: 'HIGH' },
      weather: {
        status: 'OK',
        forecast: { date: isoDay(2), summary: 'light snow', provider: 'fake' },
      },
    });

    await http().post(`${base()}/draft/finalize`).set(as(alice)).expect(400); // needs a start and an end

    await http()
      .post(`${base()}/draft/waypoints`)
      .set(as(alice))
      .send({ ...leh, date: isoDay(30) })
      .expect(201);
    const three = await http()
      .post(`${base()}/draft/waypoints`)
      .set(as(alice))
      .send({ ...keylong, position: 2 })
      .expect(201);

    const pins = three.body.waypoints;
    expect(
      pins.map((p: { name: string; role: string }) => `${p.name}:${p.role}`),
    ).toEqual(['Manali:START', 'Keylong:MID', 'Leh:END']);
    expect(pins[1].weather.status).toBe('NO_DATE');
    expect(pins[2].weather).toMatchObject({
      status: 'NOT_YET_AVAILABLE',
      availableFrom: isoDay(23),
    });
    expect(pins[2].elevation).toMatchObject({
      meters: 3524,
      zone: 'VERY_HIGH',
      oxygenPercentOfSeaLevel: 65,
    });
  });

  it('edits, reorders and deletes pins', async () => {
    const draft = await http()
      .get(`${base()}/draft`)
      .set(as(alice))
      .expect(200);
    const [m, k, l] = draft.body.waypoints;

    const edited = await http()
      .patch(`${base()}/draft/waypoints/${k.id}`)
      .set(as(alice))
      .send({ notes: 'Overnight stop', date: isoDay(3) })
      .expect(200);
    expect(edited.body.waypoints[1]).toMatchObject({
      notes: 'Overnight stop',
      weather: { status: 'OK' },
    });

    const cleared = await http()
      .patch(`${base()}/draft/waypoints/${k.id}`)
      .set(as(alice))
      .send({ date: null })
      .expect(200);
    expect(cleared.body.waypoints[1]).toMatchObject({
      date: null,
      weather: { status: 'NO_DATE' },
    });

    await http()
      .put(`${base()}/draft/waypoints/order`)
      .set(as(alice))
      .send({ waypointIds: [l.id, m.id] })
      .expect(400); // must list every pin
    const reversed = await http()
      .put(`${base()}/draft/waypoints/order`)
      .set(as(alice))
      .send({ waypointIds: [l.id, k.id, m.id] })
      .expect(200);
    expect(
      reversed.body.waypoints.map(
        (p: { name: string; role: string }) => `${p.name}:${p.role}`,
      ),
    ).toEqual(['Leh:START', 'Keylong:MID', 'Manali:END']);

    await http()
      .put(`${base()}/draft/waypoints/order`)
      .set(as(alice))
      .send({ waypointIds: [m.id, k.id, l.id] })
      .expect(200);
    const afterDelete = await http()
      .delete(`${base()}/draft/waypoints/${k.id}`)
      .set(as(alice))
      .expect(200);
    expect(
      afterDelete.body.waypoints.map(
        (p: { name: string; position: number }) => `${p.position}.${p.name}`,
      ),
    ).toEqual(['1.Manali', '2.Leh']);
    await http()
      .delete(`${base()}/draft/waypoints/${k.id}`)
      .set(as(alice))
      .expect(404);
  });

  it('finalizes into version 1, which viewers can read and export as a PDF', async () => {
    const locked = await http()
      .post(`${base()}/draft/finalize`)
      .set(as(alice))
      .expect(201);
    expect(locked.body).toMatchObject({ status: 'LOCKED', version: 1 });
    expect(locked.body.lockedAt).toBeTruthy();
    await http().get(`${base()}/draft`).set(as(alice)).expect(404);

    const latest = await http().get(base()).set(as(bob)).expect(200);
    expect(latest.body).toMatchObject({
      version: 1,
      waypoints: [{ name: 'Manali' }, { name: 'Leh' }],
    });

    const versions = await http()
      .get(`${base()}/versions`)
      .set(as(bob))
      .expect(200);
    expect(versions.body).toEqual([
      expect.objectContaining({ version: 1, waypointCount: 2 }),
    ]);

    const pdf = await http()
      .get(`${base()}/pdf`)
      .set(as(bob))
      .buffer(true)
      .parse((res, done) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => done(null, Buffer.concat(chunks)));
      })
      .expect(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect(pdf.headers['content-disposition']).toBe(
      'attachment; filename="ladakh-ride-2026-itinerary-v1.pdf"',
    );
    expect((pdf.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');

    await http().get(`${base()}/pdf?version=9`).set(as(bob)).expect(404);
    await http().get(`${base()}/pdf`).set(as(carol)).expect(404);
  });

  it('edits after finalizing via a new draft copied from the latest version → version 2', async () => {
    const draft = await http()
      .post(`${base()}/draft`)
      .set(as(alice))
      .expect(201);
    expect(draft.body).toMatchObject({
      basedOnVersion: 1,
      waypoints: [{ name: 'Manali' }, { name: 'Leh' }],
    });
    // The copy keeps enrichment, so nothing is re-fetched just to start editing.
    expect(draft.body.waypoints[1].elevation.meters).toBe(3524);

    await http()
      .patch(`${base()}/draft/waypoints/${draft.body.waypoints[1].id}`)
      .set(as(alice))
      .send({ name: 'Leh (Ladakh)' })
      .expect(200);
    const v2 = await http()
      .post(`${base()}/draft/finalize`)
      .set(as(alice))
      .expect(201);
    expect(v2.body.version).toBe(2);

    expect(
      (await http().get(base()).set(as(bob)).expect(200)).body.waypoints[1]
        .name,
    ).toBe('Leh (Ladakh)');
    const v1 = await http()
      .get(`${base()}/versions/1`)
      .set(as(bob))
      .expect(200);
    expect(v1.body.waypoints[1].name).toBe('Leh'); // old versions are immutable
    expect(
      (
        await http().get(`${base()}/versions`).set(as(bob)).expect(200)
      ).body.map((v: { version: number }) => v.version),
    ).toEqual([2, 1]);
  });

  it('refreshes enrichment (admin only) and discards drafts', async () => {
    await http().post(`${base()}/refresh`).set(as(bob)).expect(403);
    const refreshed = await http()
      .post(`${base()}/refresh`)
      .set(as(alice))
      .expect(201);
    expect(refreshed.body.version).toBe(2);

    await http().post(`${base()}/draft`).set(as(alice)).expect(201);
    await http().delete(`${base()}/draft`).set(as(alice)).expect(200);
    await http().delete(`${base()}/draft`).set(as(alice)).expect(404);
    expect(
      (await http().get(base()).set(as(bob)).expect(200)).body.version,
    ).toBe(2);
  });
});
