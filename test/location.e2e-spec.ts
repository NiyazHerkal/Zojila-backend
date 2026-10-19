import { randomUUID } from 'node:crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Redis } from 'ioredis';
import { io, type Socket } from 'socket.io-client';
import request from 'supertest';
import { In, Repository } from 'typeorm';
import { AppModule } from './../src/app.module.js';
import { DeviceToken, Group, LocationShare, User } from './../src/database/entities/index.js';
import { LocationService } from './../src/location/location.service.js';
import { OtpDeliveryService } from './../src/notifications/otp-delivery.service.js';
import { PushService, type PushMessage } from './../src/notifications/push.service.js';

// Needs Redis (REDIS_URL, default localhost:6379, e.g. Redis in WSL). Without it, only the
// "fails cleanly with 503" check runs.
async function redisIsUp(): Promise<boolean> {
  const probe = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
    lazyConnect: true,
    retryStrategy: () => null,
    connectTimeout: 1500,
    maxRetriesPerRequest: 0,
  });
  probe.on('error', () => undefined);
  try {
    await probe.connect();
    return (await probe.ping()) === 'PONG';
  } catch {
    return false;
  } finally {
    probe.disconnect();
  }
}
const REDIS_UP = await redisIsUp();

// Phase 7 DoD against the real dev Postgres + Redis: members see each other's live location for
// the chosen duration, and the sharer is notified when it runs out.
describe('Live location (e2e)', () => {
  let app: INestApplication;
  let baseUrl: string;
  let users: Repository<User>;
  let groups: Repository<Group>;
  let shares: Repository<LocationShare>;
  let location: LocationService;
  const otpCodes = new Map<string, string>();
  const pushes: { userId: string; message: PushMessage }[] = [];
  const sockets: Socket[] = [];

  const suffix = randomUUID().slice(0, 8);
  interface TestUser {
    id: string;
    username: string;
    token: string;
  }
  const userIds: string[] = [];
  let alice: TestUser; // admin
  let bob: TestUser; // viewer, shares his location
  let carol: TestUser; // not a member
  let groupId: string;

  const http = () => request(app.getHttpServer());
  const as = (u: TestUser) => ({ Authorization: `Bearer ${u.token}` });
  const url = (path = '') => `/groups/${groupId}/location${path}`;

  async function registerUser(label: string): Promise<TestUser> {
    const email = `loc-e2e.${label}.${suffix}@example.com`; // not `e2e.%`, which the auth suite's cleanup matches
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

  function connect(user: TestUser): Promise<Socket> {
    const socket = io(baseUrl, { auth: { token: user.token }, transports: ['websocket'], reconnection: false });
    sockets.push(socket);
    return new Promise((resolve) => socket.once('ready', () => resolve(socket)));
  }

  const nextEvent = <T>(socket: Socket, event: string, timeoutMs = 2000) =>
    new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`no "${event}" within ${timeoutMs} ms`)), timeoutMs);
      socket.once(event, (payload: T) => {
        clearTimeout(timer);
        resolve(payload);
      });
    });
  const receives = (socket: Socket, event: string, windowMs = 400) =>
    nextEvent(socket, event, windowMs).then(
      () => true,
      () => false,
    );

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(OtpDeliveryService)
      .useValue({
        sendEmail: async (to: string, code: string) => void otpCodes.set(to, code),
        sendSms: async (to: string, code: string) => void otpCodes.set(to, code),
      })
      .overrideProvider(PushService)
      .useValue({
        configured: false,
        sendToUser: async (userId: string, message: PushMessage) => void pushes.push({ userId, message }),
        sendToUsers: async (userIds: string[], message: PushMessage) =>
          void userIds.forEach((userId) => pushes.push({ userId, message })),
      })
      .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.listen(0, '127.0.0.1');
    baseUrl = (await app.getUrl()).replace('[::1]', '127.0.0.1');
    users = moduleFixture.get(getRepositoryToken(User));
    groups = moduleFixture.get(getRepositoryToken(Group));
    shares = moduleFixture.get(getRepositoryToken(LocationShare));
    location = moduleFixture.get(LocationService);

    alice = await registerUser('alice');
    bob = await registerUser('bob');
    carol = await registerUser('carol');
    const group = await http()
      .post('/groups')
      .set(as(alice))
      .send({ name: 'Ladakh Ride 2026', description: 'd', tripStart: '2026-10-10T00:00:00Z', tripEnd: '2026-10-19T00:00:00Z' })
      .expect(201);
    groupId = group.body.id;
    await http().post(`/groups/${groupId}/members`).set(as(alice)).send({ username: bob.username }).expect(201);

    // Wait for the app's Redis client (it connects asynchronously).
    for (let i = 0; REDIS_UP && i < 40 && (await http().get(url()).set(as(alice))).status === 503; i++) {
      await new Promise((r) => setTimeout(r, 100));
    }
  });

  afterAll(async () => {
    sockets.forEach((s) => s.disconnect());
    if (userIds.length) {
      await groups.delete({ createdById: In(userIds) });
      await users.delete({ id: In(userIds) });
    }
    await app.close();
  });

  it.runIf(!REDIS_UP)('fails cleanly with 503 when Redis is down', async () => {
    await http().get(url()).set(as(alice)).expect(503);
    await http().put(url('/share')).set(as(bob)).send({ duration: 'ONE_HOUR' }).expect(503);
    await http().get(url('/share')).set(as(bob)).expect(200); // reading your own state still works
  });

  describe.runIf(REDIS_UP)('with Redis', () => {
    let aliceSocket: Socket;
    let bobSocket: Socket;
    let carolSocket: Socket;

    beforeAll(async () => {
      [aliceSocket, bobSocket, carolSocket] = await Promise.all([connect(alice), connect(bob), connect(carol)]);
    });

    it('starts with nobody sharing, a 10 s interval, and members-only access', async () => {
      const mine = await http().get(url('/share')).set(as(bob)).expect(200);
      expect(mine.body).toEqual({ sharing: false, updateIntervalSeconds: 10 });

      const feed = await http().get(url()).set(as(alice)).expect(200);
      expect(feed.body.updateIntervalSeconds).toBe(10);
      expect(feed.body.members).toHaveLength(2);
      expect(feed.body.members.every((m: { sharing: unknown; location: unknown }) => m.sharing === null && m.location === null)).toBe(true);

      await http().get(url()).set(as(carol)).expect(404);
      await http().post(url()).set(as(bob)).send({ points: [{ lat: 32.2, lng: 77.1 }] }).expect(409); // not sharing
      await http().put(url('/share')).set(as(bob)).send({ duration: 'TWO_DAYS' }).expect(400);
    });

    it('starts a 1-hour share: timer, expiry job, and a live event for members only', async () => {
      const aliceHears = nextEvent<{ userId: string; duration: string }>(aliceSocket, 'location:sharing-started');
      const carolHears = receives(carolSocket, 'location:sharing-started');

      const res = await http().put(url('/share')).set(as(bob)).send({ duration: 'ONE_HOUR' }).expect(200);
      expect(res.body).toMatchObject({ sharing: true, duration: 'ONE_HOUR', updateIntervalSeconds: 10 });
      expect(res.body.remainingSeconds).toBeGreaterThan(3590);
      expect(res.body.remainingSeconds).toBeLessThanOrEqual(3600);

      expect(await aliceHears).toMatchObject({ userId: bob.id, duration: 'ONE_HOUR' });
      expect(await carolHears).toBe(false);
    });

    it('broadcasts the newest position of a batch, ignoring stale and pre-sharing points', async () => {
      await http().post(url()).set(as(bob)).send({ points: [{ lat: 100, lng: 77 }] }).expect(400);
      await http().post(url()).set(as(bob)).send({ points: [] }).expect(400);

      const aliceHears = nextEvent<{ userId: string; lat: number }>(aliceSocket, 'location:updated');
      const carolHears = receives(carolSocket, 'location:updated');
      const now = Date.now();
      const res = await http()
        .post(url())
        .set(as(bob))
        .send({
          points: [
            { lat: 32.24, lng: 77.18, recordedAt: new Date(now - 2000).toISOString() },
            { lat: 32.25, lng: 77.19, accuracy: 6, heading: 30, speed: 11.5, recordedAt: new Date(now).toISOString() },
            { lat: 1, lng: 1, recordedAt: new Date(now - 3_600_000).toISOString() }, // before sharing started
          ],
        })
        .expect(201);
      expect(res.body.accepted).toBe(2);
      expect(res.body.latest).toMatchObject({ lat: 32.25, lng: 77.19, accuracy: 6, heading: 30, speed: 11.5 });

      expect(await aliceHears).toMatchObject({ userId: bob.id, lat: 32.25, groupId });
      expect(await carolHears).toBe(false);

      // An older point arriving late doesn't move the pin back.
      const late = await http()
        .post(url())
        .set(as(bob))
        .send({ points: [{ lat: 10, lng: 10, recordedAt: new Date(now - 1000).toISOString() }] })
        .expect(201);
      expect(late.body.latest.lat).toBe(32.25);
    });

    it("shows Bob's live pin, timer and trip status on the group map", async () => {
      await http().post(`/groups/${groupId}/status`).set(as(bob)).send({ status: 'IN_TRANSIT' }).expect(201);
      const feed = await http().get(url()).set(as(alice)).expect(200);
      const byUser = Object.fromEntries(feed.body.members.map((m: { userId: string }) => [m.userId, m]));
      expect(byUser[bob.id]).toMatchObject({
        username: bob.username,
        tripStatus: { status: 'IN_TRANSIT' },
        sharing: { duration: 'ONE_HOUR' },
        location: { lat: 32.25, lng: 77.19 },
      });
      expect(byUser[alice.id]).toMatchObject({ sharing: null, location: null });
    });

    it('switches to ALWAYS (no timer) and stops on request', async () => {
      const always = await http().put(url('/share')).set(as(bob)).send({ duration: 'ALWAYS' }).expect(200);
      expect(always.body).toMatchObject({ sharing: true, duration: 'ALWAYS', expiresAt: null, remainingSeconds: null });

      const aliceHears = nextEvent<{ userId: string; reason: string }>(aliceSocket, 'location:sharing-stopped');
      const stopped = await http().delete(url('/share')).set(as(bob)).expect(200);
      expect(stopped.body.sharing).toBe(false);
      expect(await aliceHears).toEqual({ groupId, userId: bob.id, reason: 'STOPPED' });

      const feed = await http().get(url()).set(as(alice)).expect(200);
      expect(feed.body.members.find((m: { userId: string }) => m.userId === bob.id)).toMatchObject({ sharing: null, location: null });
      await http().delete(url('/share')).set(as(bob)).expect(200); // idempotent
    });

    it('expires a share: tells the group, notifies the sharer (socket + push), and stops accepting points', async () => {
      await http().put(url('/share')).set(as(bob)).send({ duration: 'FOUR_HOURS' }).expect(200);
      await http().post(url()).set(as(bob)).send({ points: [{ lat: 32.5, lng: 77.0 }] }).expect(201);
      await shares.update({ groupId, userId: bob.id }, { expiresAt: new Date(Date.now() - 1000) }); // pretend 4 h passed

      const bobHears = nextEvent<{ groupId: string; groupName: string }>(bobSocket, 'location:share-expired');
      const aliceHears = nextEvent<{ reason: string }>(aliceSocket, 'location:sharing-stopped');
      expect(await location.expireDueShares()).toBeGreaterThanOrEqual(1); // what the minutely sweep does

      expect(await bobHears).toMatchObject({ groupId, groupName: 'Ladakh Ride 2026' });
      expect((await aliceHears).reason).toBe('EXPIRED');
      expect(pushes.at(-1)).toMatchObject({
        userId: bob.id,
        message: { title: 'Live location sharing ended', data: { type: 'LOCATION_SHARE_EXPIRED', groupId } },
      });
      expect(pushes.at(-1)!.message.body).toMatch(/4-hour live location sharing with "Ladakh Ride 2026" has ended/);

      await http().post(url()).set(as(bob)).send({ points: [{ lat: 32.6, lng: 77.0 }] }).expect(409);
      expect((await http().get(url('/share')).set(as(bob)).expect(200)).body.sharing).toBe(false);
    });

    it('expires immediately on use if the timer ran out before the job fired', async () => {
      await http().put(url('/share')).set(as(bob)).send({ duration: 'ONE_HOUR' }).expect(200);
      await shares.update({ groupId, userId: bob.id }, { expiresAt: new Date(Date.now() - 1000) });
      const bobHears = nextEvent(bobSocket, 'location:share-expired');
      await http().post(url()).set(as(bob)).send({ points: [{ lat: 32.6, lng: 77.0 }] }).expect(409);
      await bobHears;
    });

    it('takes one position feed for every group the user shares with (POST /location)', async () => {
      await http().post('/location').set(as(bob)).send({ points: [{ lat: 32.6, lng: 77.0 }] }).expect(409); // sharing nowhere
      expect((await http().get('/location/sharing').set(as(bob)).expect(200)).body.groups).toEqual([]);

      const second = await http()
        .post('/groups')
        .set(as(alice))
        .send({ name: 'Second Trip', description: 'd', tripStart: '2026-11-01T00:00:00Z', tripEnd: '2026-11-05T00:00:00Z' })
        .expect(201);
      const secondId = second.body.id as string;
      await http().post(`/groups/${secondId}/members`).set(as(alice)).send({ username: bob.username }).expect(201);
      await http().put(url('/share')).set(as(bob)).send({ duration: 'ONE_HOUR' }).expect(200);
      await http().put(`/groups/${secondId}/location/share`).set(as(bob)).send({ duration: 'ALWAYS' }).expect(200);

      const sharing = await http().get('/location/sharing').set(as(bob)).expect(200);
      expect(sharing.body.updateIntervalSeconds).toBe(10);
      expect(sharing.body.groups.map((g: { groupId: string; groupName: string; duration: string }) => [g.groupName, g.duration]).sort()).toEqual([
        ['Ladakh Ride 2026', 'ONE_HOUR'],
        ['Second Trip', 'ALWAYS'],
      ]);

      const updates: { groupId: string }[] = [];
      aliceSocket.on('location:updated', (e: { groupId: string }) => updates.push(e));
      const res = await http().post('/location').set(as(bob)).send({ points: [{ lat: 32.7, lng: 77.1 }] }).expect(201);
      expect(res.body.groups).toHaveLength(2);
      await new Promise((r) => setTimeout(r, 300));
      aliceSocket.off('location:updated');
      expect(updates.map((u) => u.groupId).sort()).toEqual([groupId, secondId].sort());

      const feed = await http().get(`/groups/${secondId}/location`).set(as(alice)).expect(200);
      expect(feed.body.members.find((m: { userId: string }) => m.userId === bob.id).location).toMatchObject({ lat: 32.7, lng: 77.1 });
      await http().post('/location').send({ points: [{ lat: 1, lng: 1 }] }).expect(401);
      await http().delete(`/groups/${secondId}`).set(as(alice)).expect(200);
    });

    it('ends sharing when the member is removed from the group, and tells the group', async () => {
      await http().put(url('/share')).set(as(bob)).send({ duration: 'ALWAYS' }).expect(200);
      const aliceHears = nextEvent<{ userId: string; reason: string }>(aliceSocket, 'location:sharing-stopped');
      await http().delete(`/groups/${groupId}/members/${bob.id}`).set(as(alice)).expect(200);
      expect(await aliceHears).toEqual({ groupId, userId: bob.id, reason: 'REMOVED' });
      expect(await shares.count({ where: { groupId, userId: bob.id } })).toBe(0); // FK cascade
      await http().post(url()).set(as(bob)).send({ points: [{ lat: 1, lng: 1 }] }).expect(404);
      const feed = await http().get(url()).set(as(alice)).expect(200);
      expect(feed.body.members.map((m: { userId: string }) => m.userId)).toEqual([alice.id]);
    });
  });

  describe('devices (push registration)', () => {
    let devices: Repository<DeviceToken>;
    beforeAll(() => {
      devices = app.get(getRepositoryToken(DeviceToken));
    });

    it('registers, moves a token to the latest user, and unregisters', async () => {
      const token = `fcm-${suffix}-${'x'.repeat(40)}`;
      await http().post('/devices').send({ token, platform: 'ANDROID' }).expect(401);
      await http().post('/devices').set(as(alice)).send({ token, platform: 'BLACKBERRY' }).expect(400);
      await http().post('/devices').set(as(alice)).send({ token, platform: 'ANDROID' }).expect(201);
      await http().post('/devices').set(as(alice)).send({ token, platform: 'ANDROID' }).expect(201); // re-register is fine
      expect(await devices.count({ where: { token } })).toBe(1);

      await http().post('/devices').set(as(carol)).send({ token, platform: 'IOS' }).expect(201); // phone changed hands
      expect(await devices.findOneBy({ token })).toMatchObject({ userId: carol.id, platform: 'IOS' });

      await http().delete('/devices').set(as(carol)).send({ token }).expect(200);
      expect(await devices.count({ where: { token } })).toBe(0);
    });
  });
});
