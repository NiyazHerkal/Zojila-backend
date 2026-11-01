import { randomUUID } from 'node:crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Redis } from 'ioredis';
import { io, type Socket } from 'socket.io-client';
import request from 'supertest';
import { DataSource, In, Repository } from 'typeorm';
import { AppModule } from './../src/app.module.js';
import { Group, LocationHistoryConsent, LocationHistoryPoint, User } from './../src/database/entities/index.js';
import { LOCATION_HISTORY_NOTICE_VERSION, LocationHistoryService } from './../src/location/location-history.service.js';
import { OtpDeliveryService } from './../src/notifications/otp-delivery.service.js';
import { PushService } from './../src/notifications/push.service.js';
import { RetentionService } from './../src/privacy/retention.service.js';

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

// Location history (2026-10-28): opt-in per group, off by default, notice + consent records,
// 30-day retention enforced server-side, deleted on opt-out / leaving, members-only reads.
describe.runIf(REDIS_UP)('Location history (e2e)', () => {
  let app: INestApplication;
  let baseUrl: string;
  let users: Repository<User>;
  let groups: Repository<Group>;
  let points: Repository<LocationHistoryPoint>;
  let consents: Repository<LocationHistoryConsent>;
  const otpCodes = new Map<string, string>();
  const sockets: Socket[] = [];

  const suffix = randomUUID().slice(0, 8);
  interface TestUser {
    id: string;
    username: string;
    token: string;
  }
  const userIds: string[] = [];
  let alice: TestUser; // admin, history stays off
  let bob: TestUser; // viewer, opts in
  let carol: TestUser; // not a member
  let groupId: string;

  const http = () => request(app.getHttpServer());
  const as = (u: TestUser) => ({ Authorization: `Bearer ${u.token}` });
  const url = (path = '') => `/groups/${groupId}/location${path}`;
  const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

  async function registerUser(label: string): Promise<TestUser> {
    const email = `lochist-e2e.${label}.${suffix}@example.com`;
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

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(OtpDeliveryService)
      .useValue({
        sendEmail: async (to: string, code: string) => void otpCodes.set(to, code),
        sendSms: async (to: string, code: string) => void otpCodes.set(to, code),
      })
      .overrideProvider(PushService)
      .useValue({ configured: false, sendToUser: async () => undefined, sendToUsers: async () => undefined })
      .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.listen(0, '127.0.0.1');
    baseUrl = (await app.getUrl()).replace('[::1]', '127.0.0.1');
    users = moduleFixture.get(getRepositoryToken(User));
    groups = moduleFixture.get(getRepositoryToken(Group));
    points = moduleFixture.get(getRepositoryToken(LocationHistoryPoint));
    consents = moduleFixture.get(DataSource).getRepository(LocationHistoryConsent);

    alice = await registerUser('alice');
    bob = await registerUser('bob');
    carol = await registerUser('carol');
    const group = await http()
      .post('/groups')
      .set(as(alice))
      .send({ name: 'Hampi Trail', description: 'd', tripStart: '2026-10-10T00:00:00Z', tripEnd: '2026-10-19T00:00:00Z' })
      .expect(201);
    groupId = group.body.id;
    await http().post(`/groups/${groupId}/members`).set(as(alice)).send({ username: bob.username }).expect(201);

    for (let i = 0; i < 40 && (await http().get(url()).set(as(alice))).status === 503; i++) {
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

  it('is off by default, with the notice to show, and only for members', async () => {
    const res = await http().get(url('/history/settings')).set(as(bob)).expect(200);
    expect(res.body).toMatchObject({ available: true, enabled: false, enabledAt: null, retentionDays: 30 });
    expect(res.body.notice.version).toBe(LOCATION_HISTORY_NOTICE_VERSION);
    expect(res.body.notice.points.join(' ')).toContain('30 days');

    await http().get(url('/history/settings')).set(as(carol)).expect(404);
    const feed = await http().get(url()).set(as(alice)).expect(200);
    expect(feed.body.members.every((m: { historyEnabled: boolean }) => m.historyEnabled === false)).toBe(true);
    expect((await http().get(url('/share')).set(as(bob)).expect(200)).body.historyEnabled).toBe(false);
  });

  it('with the release switch off (production until approved), nobody can turn it on', async () => {
    const service = app.get(LocationHistoryService);
    service.optInOpen = false;
    try {
      const settings = await http().get(url('/history/settings')).set(as(bob)).expect(200);
      expect(settings.body).toMatchObject({ available: false, enabled: false });
      const res = await http()
        .put(url('/history/settings'))
        .set(as(bob))
        .send({ enabled: true, noticeVersion: LOCATION_HISTORY_NOTICE_VERSION })
        .expect(403);
      expect(res.body.code).toBe('FEATURE_UNAVAILABLE');
      await http().put(url('/history/settings')).set(as(bob)).send({ enabled: false }).expect(200); // off always works
      await http().delete(url('/history')).set(as(bob)).expect(200);
      expect(await consents.count({ where: { groupId, userId: bob.id } })).toBe(0);
    } finally {
      service.optInOpen = true;
    }
  });

  it('live sharing works with history off and saves nothing', async () => {
    await http().put(url('/share')).set(as(bob)).send({ duration: 'ONE_HOUR' }).expect(200);
    const res = await http().post(url()).set(as(bob)).send({ points: [{ lat: 15.33, lng: 76.46 }] }).expect(201);
    expect(res.body).toMatchObject({ accepted: 1, savedToHistory: 0 });
    expect(res.body.latest).toMatchObject({ lat: 15.33, lng: 76.46 });
    expect(await points.count({ where: { groupId } })).toBe(0);
  });

  it('opting in needs the current notice version, records consent and tells the group', async () => {
    const off = { enabled: true };
    const missing = await http().put(url('/history/settings')).set(as(bob)).send(off).expect(400);
    expect(missing.body.code).toBe('NOTICE_OUTDATED');
    await http().put(url('/history/settings')).set(as(bob)).send({ enabled: true, noticeVersion: '2020-01-01' }).expect(400);
    await http().put(url('/history/settings')).set(as(bob)).send({ enabled: 'yes' }).expect(400);

    const aliceSocket = await connect(alice);
    const aliceHears = nextEvent<{ userId: string; enabled: boolean }>(aliceSocket, 'location:history-changed');
    const res = await http()
      .put(url('/history/settings'))
      .set(as(bob))
      .send({ enabled: true, noticeVersion: LOCATION_HISTORY_NOTICE_VERSION })
      .expect(200);
    expect(res.body).toMatchObject({ enabled: true, retentionDays: 30 });
    expect(res.body.enabledAt).toBeTruthy();
    expect(await aliceHears).toEqual({ groupId, userId: bob.id, enabled: true });

    // Turning it on again is a no-op: no second consent record.
    await http().put(url('/history/settings')).set(as(bob)).send({ enabled: true, noticeVersion: LOCATION_HISTORY_NOTICE_VERSION }).expect(200);
    const records = await consents.find({ where: { groupId, userId: bob.id } });
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ action: 'GRANTED', noticeVersion: LOCATION_HISTORY_NOTICE_VERSION });

    const feed = await http().get(url()).set(as(alice)).expect(200);
    const bobRow = feed.body.members.find((m: { userId: string }) => m.userId === bob.id);
    expect(bobRow.historyEnabled).toBe(true);
    expect((await http().get('/location/sharing').set(as(bob)).expect(200)).body.groups[0].historyEnabled).toBe(true);
  });

  it('saves shared positions after opting in, thinned to one per 15 s', async () => {
    const res = await http()
      .post('/location') // the app-wide feed reaches the group too
      .set(as(bob))
      .send({
        points: [
          { lat: 15.3, lng: 76.4, recordedAt: ago(10 * 60_000) }, // before sharing began: not even live
          { lat: 15.31, lng: 76.41, recordedAt: ago(40_000) },
          { lat: 15.311, lng: 76.411, recordedAt: ago(35_000) }, // 5 s later: thinned
          { lat: 15.32, lng: 76.42, recordedAt: ago(20_000) },
        ],
      })
      .expect(201);
    // All four were taken before history was turned on, so none is saved.
    expect(res.body.groups[0].savedToHistory).toBe(0);

    const later = await http()
      .post(url())
      .set(as(bob))
      .send({ points: [{ lat: 15.33, lng: 76.43 }, { lat: 15.34, lng: 76.44, recordedAt: ago(-1000) }] })
      .expect(201);
    expect(later.body.savedToHistory).toBe(1); // second point is within 15 s of the first
    expect(await points.count({ where: { groupId, userId: bob.id } })).toBe(1);
  });

  it('members read the trail oldest first with paging; outsiders get 404', async () => {
    // Add older points straight to the table (as if recorded over the last hour).
    await points.insert([
      { groupId, userId: bob.id, lat: 15.1, lng: 76.1, accuracy: 5, heading: null, speed: null, recordedAt: new Date(Date.now() - 50 * 60_000) },
      { groupId, userId: bob.id, lat: 15.2, lng: 76.2, accuracy: null, heading: 90, speed: 3, recordedAt: new Date(Date.now() - 30 * 60_000) },
    ]);

    const all = await http().get(url(`/history/${bob.id}`)).set(as(alice)).expect(200);
    expect(all.body).toMatchObject({ userId: bob.id, username: bob.username, enabled: true, retentionDays: 30, nextCursor: null });
    expect(all.body.points.map((p: { lat: number }) => p.lat)).toEqual([15.1, 15.2, 15.33]);
    expect(all.body.points[0]).toMatchObject({ accuracy: 5, heading: null, speed: null });

    const page1 = await http().get(url(`/history/${bob.id}`)).query({ limit: 2 }).set(as(alice)).expect(200);
    expect(page1.body.points).toHaveLength(2);
    expect(page1.body.nextCursor).toMatch(/^\d+_\d+$/);
    const page2 = await http().get(url(`/history/${bob.id}`)).query({ limit: 2, after: page1.body.nextCursor }).set(as(alice)).expect(200);
    expect(page2.body.points.map((p: { lat: number }) => p.lat)).toEqual([15.33]);
    expect(page2.body.nextCursor).toBeNull();

    const window = await http().get(url(`/history/${bob.id}`)).query({ from: ago(40 * 60_000), to: ago(20 * 60_000) }).set(as(bob)).expect(200);
    expect(window.body.points.map((p: { lat: number }) => p.lat)).toEqual([15.2]);

    await http().get(url(`/history/${bob.id}`)).set(as(carol)).expect(404);
    await http().get(url(`/history/${carol.id}`)).set(as(alice)).expect(404); // not a member
    await http().get(url('/history/not-a-uuid')).set(as(alice)).expect(400);
    await http().get(url(`/history/${bob.id}`)).query({ after: 'x' }).set(as(alice)).expect(400);
    await http().get(url(`/history/${bob.id}`)).query({ limit: 999999 }).set(as(alice)).expect(400);
  });

  it("doesn't show the trail of a member with history off", async () => {
    const res = await http().get(url(`/history/${alice.id}`)).set(as(bob)).expect(200);
    expect(res.body).toMatchObject({ enabled: false, points: [], nextCursor: null });
  });

  it('enforces the 30-day retention server-side (reads and the purge job)', async () => {
    const old = new Date(Date.now() - 31 * 24 * 60 * 60_000);
    await points.insert({ groupId, userId: bob.id, lat: 14, lng: 75, accuracy: null, heading: null, speed: null, recordedAt: old });

    const res = await http().get(url(`/history/${bob.id}`)).query({ from: '2020-01-01T00:00:00Z' }).set(as(bob)).expect(200);
    expect(res.body.points.some((p: { lat: number }) => p.lat === 14)).toBe(false); // hidden even before the job runs

    const deleted = await app.get(RetentionService).purgeOldLocationHistory(new Date(), [bob.id]);
    expect(deleted).toBe(1);
    expect(await points.count({ where: { userId: bob.id } })).toBe(3);
  });

  it('includes the trail and consent records in the data export', async () => {
    const res = await http().get('/auth/me/export').set(as(bob)).expect(200);
    expect(res.body.locationHistory).toHaveLength(3);
    expect(res.body.locationHistory[0]).toMatchObject({ groupId, lat: 15.1, lng: 76.1 });
    expect(res.body.locationHistoryConsents).toEqual([
      expect.objectContaining({ groupId, action: 'GRANTED', noticeVersion: LOCATION_HISTORY_NOTICE_VERSION }),
    ]);
    expect(res.body.groups.find((g: { groupId: string }) => g.groupId === groupId).locationHistoryEnabled).toBe(true);
  });

  it('DELETE /history clears the trail but keeps the setting', async () => {
    const res = await http().delete(url('/history')).set(as(bob)).expect(200);
    expect(res.body).toEqual({ deletedPoints: 3 });
    expect((await http().get(url('/history/settings')).set(as(bob)).expect(200)).body.enabled).toBe(true);
  });

  it('opting out stops saving, deletes the trail at once and records the withdrawal', async () => {
    await http().post(url()).set(as(bob)).send({ points: [{ lat: 15.5, lng: 76.5 }] }).expect(201);
    expect(await points.count({ where: { groupId, userId: bob.id } })).toBe(1);

    const res = await http().put(url('/history/settings')).set(as(bob)).send({ enabled: false }).expect(200);
    expect(res.body).toMatchObject({ enabled: false, enabledAt: null, deletedPoints: 1 });
    expect(await points.count({ where: { groupId, userId: bob.id } })).toBe(0);
    const actions = (await consents.find({ where: { groupId, userId: bob.id }, order: { createdAt: 'ASC' } })).map((c) => c.action);
    expect(actions).toEqual(['GRANTED', 'WITHDRAWN']);

    const after = await http().post(url()).set(as(bob)).send({ points: [{ lat: 15.6, lng: 76.6 }] }).expect(201);
    expect(after.body.savedToHistory).toBe(0); // live sharing still works
    expect((await http().get(url(`/history/${bob.id}`)).set(as(alice)).expect(200)).body).toMatchObject({ enabled: false, points: [] });
  });

  it('on a closed trip, history can be turned off but not on', async () => {
    await http()
      .put(url('/history/settings'))
      .set(as(bob))
      .send({ enabled: true, noticeVersion: LOCATION_HISTORY_NOTICE_VERSION })
      .expect(200);
    await http().post(`/groups/${groupId}/close`).set(as(alice)).expect(200);

    await http().put(url('/history/settings')).set(as(bob)).send({ enabled: false }).expect(200);
    const res = await http()
      .put(url('/history/settings'))
      .set(as(bob))
      .send({ enabled: true, noticeVersion: LOCATION_HISTORY_NOTICE_VERSION })
      .expect(409);
    expect(res.body.code).toBe('TRIP_CLOSED');
    await http().delete(url('/history')).set(as(bob)).expect(200);
    await http().post(`/groups/${groupId}/reopen`).set(as(alice)).expect(200);
  });

  it('leaving the group deletes the trail (FK cascade)', async () => {
    await http()
      .put(url('/history/settings'))
      .set(as(bob))
      .send({ enabled: true, noticeVersion: LOCATION_HISTORY_NOTICE_VERSION })
      .expect(200);
    await http().put(url('/share')).set(as(bob)).send({ duration: 'ONE_HOUR' }).expect(200);
    await http().post(url()).set(as(bob)).send({ points: [{ lat: 15.7, lng: 76.7 }] }).expect(201);
    expect(await points.count({ where: { groupId, userId: bob.id } })).toBe(1);

    await http().delete(`/groups/${groupId}/members/${bob.id}`).set(as(alice)).expect(200);
    expect(await points.count({ where: { groupId, userId: bob.id } })).toBe(0);
    expect(await consents.count({ where: { groupId, userId: bob.id } })).toBe(5); // 3 grants + 2 withdrawals: proof of consent stays
  });
});
