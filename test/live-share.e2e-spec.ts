import { randomUUID } from 'node:crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Redis } from 'ioredis';
import { io, type Socket } from 'socket.io-client';
import request from 'supertest';
import { In, Repository } from 'typeorm';
import { AppModule } from './../src/app.module.js';
import { LocationShareLink, User } from './../src/database/entities/index.js';
import { LiveShareService } from './../src/location/live-share.service.js';
import { OtpDeliveryService } from './../src/notifications/otp-delivery.service.js';
import { PushService, type PushMessage } from './../src/notifications/push.service.js';
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

// Change request v1.0, change 10: live location for people outside the app, through a link.
// Needs Redis (live positions), like the Phase 7 suite.
describe.runIf(REDIS_UP)('Live location for loved ones (e2e)', () => {
  let app: INestApplication;
  let baseUrl: string;
  let users: Repository<User>;
  let links: Repository<LocationShareLink>;
  let liveShare: LiveShareService;
  let retention: RetentionService;
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
  let alice: TestUser; // shares her location
  let bob: TestUser;
  let momLink: { id: string; token: string; link: string };

  const http = () => request(app.getHttpServer());
  const as = (u: TestUser) => ({ Authorization: `Bearer ${u.token}` });
  const next = (socket: Socket, event: string) => new Promise<Record<string, any>>((r) => socket.once(event, r));

  async function registerUser(label: string): Promise<TestUser> {
    const email = `live-e2e.${label}.${suffix}@example.com`;
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

  /** A recipient's page on the `/live` socket namespace: no account, just the link token. */
  function watch(token: string): Promise<Socket> {
    const socket = io(`${baseUrl}/live`, { auth: { token }, transports: ['websocket'], reconnection: false });
    sockets.push(socket);
    return new Promise((resolve, reject) => {
      socket.once('ready', () => resolve(socket));
      socket.once('connect_error', reject);
    });
  }

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
        sendToUsers: async (ids: string[], message: PushMessage) => void ids.forEach((userId) => pushes.push({ userId, message })),
      })
      .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.listen(0, '127.0.0.1');
    baseUrl = (await app.getUrl()).replace('[::1]', '127.0.0.1');
    users = moduleFixture.get(getRepositoryToken(User));
    links = moduleFixture.get(getRepositoryToken(LocationShareLink));
    liveShare = moduleFixture.get(LiveShareService);
    retention = moduleFixture.get(RetentionService);

    alice = await registerUser('alice');
    bob = await registerUser('bob');
  });

  afterAll(async () => {
    sockets.forEach((s) => s.disconnect());
    if (userIds.length) await users.delete({ id: In(userIds) });
    await app.close();
  });

  it('creates a link for someone outside the app, shown once', async () => {
    await http().post('/location-share/sessions').send({ duration: 'ONE_HOUR' }).expect(401);
    await http().post('/location-share/sessions').set(as(alice)).send({ duration: 'FOREVER' }).expect(400);

    const res = await http().post('/location-share/sessions').set(as(alice)).send({ duration: 'ONE_HOUR', recipientLabel: ' Mom ' }).expect(201);
    expect(res.body).toMatchObject({ recipientLabel: 'Mom', duration: 'ONE_HOUR', firstViewedAt: null });
    expect(res.body.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(res.body.link).toBe(`https://travelgo.app/live/${res.body.token}`);
    expect(res.body.remainingSeconds).toBeGreaterThan(3590);
    momLink = res.body;

    const list = await http().get('/location-share/sessions').set(as(alice)).expect(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0].token).toBeUndefined(); // never shown again
    expect((await http().get('/location-share/sessions').set(as(bob)).expect(200)).body).toEqual([]);
  });

  it('lets the recipient see it without an account, and tells the sharer on first open', async () => {
    await http().get(`/public/live/${'x'.repeat(43)}`).expect(404);

    const first = await http().get(`/public/live/${momLink.token}`).expect(200);
    expect(first.body).toMatchObject({ sessionId: momLink.id, sharer: { name: 'E2E alice' }, recipientLabel: 'Mom', location: null, updateIntervalSeconds: 10 });
    expect(pushes.filter((p) => p.message.data?.type === 'LIVE_SHARE_VIEWED')).toEqual([
      expect.objectContaining({ userId: alice.id, message: expect.objectContaining({ body: 'Mom opened your live location link.' }) }),
    ]);

    await http().get(`/public/live/${momLink.token}`).expect(200);
    expect(pushes.filter((p) => p.message.data?.type === 'LIVE_SHARE_VIEWED')).toHaveLength(1); // only once
    const list = await http().get('/location-share/sessions').set(as(alice)).expect(200);
    expect(list.body[0].firstViewedAt).not.toBeNull();
  });

  it('sends positions from POST /location to the recipient, live and by polling', async () => {
    const viewer = await watch(momLink.token);
    const update = next(viewer, 'location:update');

    // Alice shares with no group, only with Mom: POST /location still works.
    const res = await http().post('/location').set(as(alice)).send({ points: [{ lat: 32.24, lng: 77.18, accuracy: 5 }] }).expect(201);
    expect(res.body).toMatchObject({ groups: [], liveLinks: { active: 1, latest: { lat: 32.24, lng: 77.18 } } });
    expect(await update).toMatchObject({ sessionId: momLink.id, lat: 32.24, lng: 77.18, accuracy: 5 });

    const polled = await http().get(`/public/live/${momLink.token}`).expect(200);
    expect(polled.body.location).toMatchObject({ lat: 32.24, lng: 77.18 });

    await http().post('/location').set(as(bob)).send({ points: [{ lat: 1, lng: 1 }] }).expect(409); // bob shares nothing
  });

  it('caps active links at 5', async () => {
    for (let i = 0; i < 4; i++) {
      await http().post('/location-share/sessions').set(as(alice)).send({ duration: 'FIFTEEN_MINUTES' }).expect(201);
    }
    const res = await http().post('/location-share/sessions').set(as(alice)).send({ duration: 'FIFTEEN_MINUTES' }).expect(409);
    expect(res.body.message).toMatch('at most 5');
    for (const link of (await http().get('/location-share/sessions').set(as(alice))).body.filter((l: { id: string }) => l.id !== momLink.id)) {
      await http().delete(`/location-share/sessions/${link.id}`).set(as(alice)).expect(200);
    }
  });

  it('stops at once when the sharer stops it: recipient told, disconnected, then 410', async () => {
    const viewer = await watch(momLink.token);
    const stopped = next(viewer, 'location_share:stopped');
    const gone = new Promise((r) => viewer.once('disconnect', r));

    await http().delete(`/location-share/sessions/${momLink.id}`).set(as(bob)).expect(404); // not bob's
    await http().delete(`/location-share/sessions/${momLink.id}`).set(as(alice)).expect(200);
    expect(await stopped).toMatchObject({ sessionId: momLink.id, reason: 'STOPPED' });
    await gone;

    const after = await http().get(`/public/live/${momLink.token}`).expect(410);
    expect(after.body.message).toBe('This live location has ended');
    await expect(watch(momLink.token)).rejects.toThrow('Gone');
    await http().delete(`/location-share/sessions/${momLink.id}`).set(as(alice)).expect(200); // already stopped: fine
    await http().post('/location').set(as(alice)).send({ points: [{ lat: 1, lng: 1 }] }).expect(409); // nothing active
  });

  it('expires after its duration: recipient loses access, sharer gets a push', async () => {
    const res = await http().post('/location-share/sessions').set(as(alice)).send({ duration: 'FIFTEEN_MINUTES', recipientLabel: 'Dad' }).expect(201);
    await links.update({ id: res.body.id }, { expiresAt: new Date(Date.now() - 1000) }); // pretend 15 min passed

    expect(await liveShare.expireDue()).toBeGreaterThanOrEqual(1); // what the minutely sweep does
    expect(pushes.at(-1)).toMatchObject({
      userId: alice.id,
      message: { title: 'Live location sharing ended', body: 'Your live location link for Dad has expired.', data: { type: 'LIVE_SHARE_EXPIRED' } },
    });
    await http().get(`/public/live/${res.body.token}`).expect(410);
    expect((await http().get('/location-share/sessions').set(as(alice)).expect(200)).body).toEqual([]);
  });

  it('is in the data export, and old links are cleaned up by the retention job', async () => {
    const exported = await http().get('/auth/me/export').set(as(alice)).expect(200);
    expect(exported.body.liveLocationLinks.map((l: { recipientLabel: string | null }) => l.recipientLabel)).toEqual(
      expect.arrayContaining(['Mom', 'Dad']),
    );
    expect(JSON.stringify(exported.body)).not.toContain(momLink.token);

    const in31Days = new Date(Date.now() + 31 * 24 * 60 * 60 * 1000);
    expect(await retention.purgeOldLiveLinks(in31Days, [alice.id])).toBeGreaterThanOrEqual(2);
    expect(await links.count({ where: { userId: alice.id } })).toBe(0);
  });
});
