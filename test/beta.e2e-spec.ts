import { randomUUID } from 'node:crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { io, type Socket } from 'socket.io-client';
import request from 'supertest';
import { In, Repository } from 'typeorm';
import { AppModule } from './../src/app.module.js';
import {
  Feedback,
  Group,
  UsageDaily,
  User,
} from './../src/database/entities/index.js';
import { ElevationProvider } from './../src/enrichment/elevation.provider.js';
import { WeatherProvider } from './../src/enrichment/weather.provider.js';
import {
  EmailService,
  type EmailMessage,
} from './../src/notifications/email.service.js';
import { OtpDeliveryService } from './../src/notifications/otp-delivery.service.js';
import { RetentionService } from './../src/privacy/retention.service.js';

// Phase 13 closed beta: in-app feedback (+ team email), the ops metrics and trip checklist, and
// the usage counters behind them. Real dev Postgres; Redis optional.
describe('Closed beta support (e2e)', () => {
  let app: INestApplication;
  let baseUrl: string;
  let users: Repository<User>;
  let groups: Repository<Group>;
  let feedbackRepo: Repository<Feedback>;
  let usage: Repository<UsageDaily>;
  let retention: RetentionService;
  const otpCodes = new Map<string, string>();
  const emails: EmailMessage[] = [];
  const sockets: Socket[] = [];
  const OPS_KEY = `ops-${randomUUID()}-${randomUUID()}`;

  const suffix = randomUUID().slice(0, 8);
  interface TestUser {
    id: string;
    username: string;
    token: string;
  }
  const userIds: string[] = [];
  let alice: TestUser;
  let bob: TestUser;
  let groupId: string;

  const http = () => request(app.getHttpServer());
  const as = (u: TestUser) => ({ Authorization: `Bearer ${u.token}` });
  const ops = () => ({ 'X-Ops-Key': OPS_KEY });
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.alloc(64, 2),
  ]);
  /** Usage counts are written in the background: wait until `check` passes. */
  const eventually = async (check: () => Promise<boolean>) => {
    for (let i = 0; i < 40 && !(await check()); i++)
      await new Promise((r) => setTimeout(r, 50));
  };

  async function registerUser(label: string): Promise<TestUser> {
    const email = `beta-e2e.${label}.${suffix}@example.com`;
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
    process.env.OPS_API_KEY = OPS_KEY;
    process.env.FEEDBACK_EMAIL = 'team@example.com, lead@example.com';
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
      .overrideProvider(EmailService)
      .useValue({
        configured: true,
        send: async (m: EmailMessage) => (emails.push(m), true),
      })
      .overrideProvider(ElevationProvider)
      .useValue({ configured: true, getElevation: async () => 2000 })
      .overrideProvider(WeatherProvider)
      .useValue({
        configured: false,
        name: 'none',
        attribution: 'Weather: fake',
        forecastDays: 8,
        getDailyForecast: async () => [],
      })
      .compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.listen(0, '127.0.0.1');
    baseUrl = (await app.getUrl()).replace('[::1]', '127.0.0.1');
    users = moduleFixture.get(getRepositoryToken(User));
    groups = moduleFixture.get(getRepositoryToken(Group));
    feedbackRepo = moduleFixture.get(getRepositoryToken(Feedback));
    usage = moduleFixture.get(getRepositoryToken(UsageDaily));
    retention = moduleFixture.get(RetentionService);

    alice = await registerUser('alice');
    bob = await registerUser('bob');
    const group = await http()
      .post('/groups')
      .set(as(alice))
      .send({
        name: 'Beta Ride',
        description: 'd',
        tripStart: '2026-09-01T00:00:00Z',
        tripEnd: '2026-09-05T00:00:00Z',
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
    delete process.env.OPS_API_KEY;
    delete process.env.FEEDBACK_EMAIL;
    sockets.forEach((s) => s.disconnect());
    if (userIds.length) {
      await groups.delete({ createdById: In(userIds) });
      await users.delete({ id: In(userIds) });
    }
    await app.close();
  });

  describe('feedback', () => {
    let reportId: string;

    it('stores a report with device details and emails the team', async () => {
      const res = await http()
        .post('/feedback')
        .set(as(bob))
        .send({
          category: 'BUG',
          message: 'Summary shows <b>wrong</b> total after editing',
          rating: 4,
          screen: 'expenses/summary',
          groupId,
          appVersion: '0.9.0 (42)',
          platform: 'ANDROID',
          osVersion: 'Android 15',
          deviceModel: 'Pixel 8',
        })
        .expect(201);
      reportId = res.body.id;
      expect(res.body).toMatchObject({
        category: 'BUG',
        status: 'NEW',
        rating: 4,
        groupId,
        hasScreenshot: false,
        opsNote: null,
      });

      await eventually(async () => emails.length >= 2);
      expect(emails.map((e) => e.to)).toEqual([
        'team@example.com',
        'lead@example.com',
      ]);
      expect(emails[0].subject).toMatch(
        /^\[TravelGo beta\] BUG: Summary shows/,
      );
      expect(emails[0].text).toContain('Trip: Beta Ride');
      expect(emails[0].text).toContain(
        '0.9.0 (42) on ANDROID · Android 15 · Pixel 8',
      );
      expect(emails[0].html).toContain('&lt;b&gt;wrong&lt;/b&gt;'); // escaped
    });

    it('validates input, and only allows trips you belong to', async () => {
      await http()
        .post('/feedback')
        .set(as(bob))
        .send({ category: 'BUG', message: '' })
        .expect(400);
      await http()
        .post('/feedback')
        .set(as(bob))
        .send({ category: 'RANT', message: 'x' })
        .expect(400);
      await http()
        .post('/feedback')
        .set(as(bob))
        .send({ category: 'IDEA', message: 'x', rating: 9 })
        .expect(400);
      await http()
        .post('/feedback')
        .set(as(bob))
        .send({ category: 'IDEA', message: 'x', groupId: randomUUID() })
        .expect(404);
      await http()
        .post('/feedback')
        .send({ category: 'IDEA', message: 'x' })
        .expect(401);
    });

    it('takes a screenshot (images only), from the reporter only', async () => {
      const up = await http()
        .put(`/feedback/${reportId}/screenshot`)
        .set(as(bob))
        .attach('file', png, 's.png')
        .expect(200);
      expect(up.body.hasScreenshot).toBe(true);
      await http()
        .put(`/feedback/${reportId}/screenshot`)
        .set(as(alice))
        .attach('file', png, 's.png')
        .expect(404);
      await http()
        .put(`/feedback/${reportId}/screenshot`)
        .set(as(bob))
        .attach('file', Buffer.from('%PDF-1.7 not an image at all'), 's.pdf')
        .expect(415);
    });

    it('lets the team triage it, and the tester sees the status and note', async () => {
      await http().get('/ops/feedback').expect(401);
      await http()
        .get('/ops/feedback')
        .set({ 'X-Ops-Key': 'wrong' })
        .expect(401);
      const list = await http()
        .get('/ops/feedback?status=NEW&category=BUG')
        .set(ops())
        .expect(200);
      const item = list.body.items.find(
        (f: { id: string }) => f.id === reportId,
      );
      expect(item).toMatchObject({
        user: { userId: bob.id },
        group: { id: groupId, name: 'Beta Ride' },
        deviceModel: 'Pixel 8',
      });

      const shot = await http()
        .get(`/ops/feedback/${reportId}/screenshot`)
        .set(ops())
        .buffer(true)
        .expect(200);
      expect(shot.headers['content-type']).toBe('image/png');

      await http()
        .patch(`/ops/feedback/${reportId}`)
        .set(ops())
        .send({ status: 'DONE', opsNote: 'Fixed in 0.9.1' })
        .expect(200);
      const mine = await http().get('/feedback/mine').set(as(bob)).expect(200);
      expect(mine.body[0]).toMatchObject({
        id: reportId,
        status: 'DONE',
        opsNote: 'Fixed in 0.9.1',
      });
    });
  });

  describe('beta metrics', () => {
    it('counts real usage and fills in the trip checklist', async () => {
      // Use the trip: app open (socket), chat, itinerary + PDF, status, expense, offline bundle.
      const socket = io(baseUrl, {
        auth: { token: bob.token },
        transports: ['websocket'],
        reconnection: false,
      });
      sockets.push(socket);
      await new Promise((r) => socket.once('ready', r));
      const ack = await socket
        .timeout(3000)
        .emitWithAck('chat:send', { groupId, body: 'Reached Kaza' });
      expect(ack.ok).toBe(true);
      const draft = `/groups/${groupId}/itinerary/draft`;
      await http().post(draft).set(as(alice)).expect(201);
      await http()
        .post(`${draft}/waypoints`)
        .set(as(alice))
        .send({ name: 'Manali', lat: 32.24, lng: 77.19 })
        .expect(201);
      await http()
        .post(`${draft}/waypoints`)
        .set(as(alice))
        .send({ name: 'Kaza', lat: 32.22, lng: 78.07 })
        .expect(201);
      await http().post(`${draft}/finalize`).set(as(alice)).expect(201);
      await http()
        .get(`/groups/${groupId}/itinerary/pdf`)
        .set(as(bob))
        .expect(200);
      await http()
        .post(`/groups/${groupId}/status`)
        .set(as(bob))
        .send({ status: 'ARRIVED' })
        .expect(201);
      await http()
        .post(`/groups/${groupId}/expenses`)
        .set(as(alice))
        .send({
          amount: 500,
          category: 'FUEL',
          date: '2026-09-02',
          splitType: 'EQUAL',
        })
        .expect(201);
      await http()
        .get(`/groups/${groupId}/offline-bundle`)
        .set(as(bob))
        .expect(200);

      await eventually(async () => (await usage.countBy({ groupId })) >= 2);
      const counted = await usage.find({
        where: { userId: In([alice.id, bob.id]) },
      });
      expect(counted.map((u) => u.metric).sort()).toEqual([
        'APP_CONNECTED',
        'ITINERARY_PDF_EXPORTED',
        'OFFLINE_BUNDLE_FETCHED',
      ]);

      const trips = await http().get('/ops/trips').set(ops()).expect(200);
      const trip = trips.body.find(
        (t: { groupId: string }) => t.groupId === groupId,
      );
      expect(trip).toMatchObject({
        members: 2,
        itineraryVersion: 1,
        chatMessages: 1,
        statusUpdates: 1,
        expenses: 1,
        pdfExports: 1,
        offlineFetches: 1,
        locationSharers: 0,
        endToEnd: false,
      });
      expect(trip.checklist).toEqual({
        groupOfTwoOrMore: true,
        finalizedItinerary: true,
        chatUsed: true,
        locationShared: false, // the one thing this test didn't do
        statusUsed: true,
        expensesLogged: true,
        tripEnded: true,
      });
    });

    it('reports the KPIs', async () => {
      const { body } = await http()
        .get('/ops/stats?since=2026-01-01')
        .set(ops())
        .expect(200);
      expect(body.users.total).toBeGreaterThanOrEqual(2);
      expect(body.users.active.today).toBeGreaterThanOrEqual(1);
      expect(body.groups.withTwoOrMoreMembers).toBeGreaterThanOrEqual(1);
      expect(body.chat.messages).toBeGreaterThanOrEqual(1);
      expect(body.itinerary.pdfExports).toBeGreaterThanOrEqual(1);
      expect(body.expenses.expenses).toBeGreaterThanOrEqual(1);
      expect(body.feedback).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ category: 'BUG', status: 'DONE' }),
        ]),
      );
      expect(body.stability.crashFreeSessionsPercent).toBeNull();
      for (const key of [
        'users',
        'groups',
        'invites',
        'chat',
        'location',
        'expenses',
        'itinerary',
        'safety',
        'offline',
      ]) {
        expect(body).toHaveProperty(key);
      }
    });
  });

  describe('privacy of the new data', () => {
    it('exports feedback, and deletes it (with usage counts) with the account', async () => {
      const exported = await http()
        .get('/auth/me/export')
        .set(as(bob))
        .expect(200);
      expect(exported.body.feedback).toEqual([
        expect.objectContaining({ category: 'BUG', status: 'DONE' }),
      ]);

      await http()
        .delete('/auth/me')
        .set(as(bob))
        .send({ password: 'Str0ng!Pass' })
        .expect(200);
      expect(await feedbackRepo.countBy({ userId: bob.id })).toBe(0);
      expect(await usage.countBy({ userId: bob.id })).toBe(0);
    });

    it('purges old usage counts and feedback (scoped to this suite)', async () => {
      await http()
        .get(`/groups/${groupId}/offline-bundle`)
        .set(as(alice))
        .expect(200); // a counted action
      await eventually(
        async () => (await usage.countBy({ userId: alice.id })) > 0,
      );
      await usage.update({ userId: alice.id }, { day: '2025-01-01' });
      expect(
        await retention.purgeOldUsage(new Date(), [alice.id]),
      ).toBeGreaterThanOrEqual(1);
      const fb = await http()
        .post('/feedback')
        .set(as(alice))
        .send({ category: 'IDEA', message: 'Dark mode' })
        .expect(201);
      await feedbackRepo.update(
        { id: fb.body.id },
        { createdAt: new Date(Date.now() - 400 * 86_400_000) },
      );
      expect(await retention.purgeOldFeedback(new Date(), [fb.body.id])).toBe(
        1,
      );
    });
  });

  it('hides the ops routes entirely without OPS_API_KEY', async () => {
    delete process.env.OPS_API_KEY;
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    const plain = moduleFixture.createNestApplication();
    await plain.init();
    await request(plain.getHttpServer())
      .get('/ops/stats')
      .set({ 'X-Ops-Key': 'anything' })
      .expect(404);
    await plain.close();
  });
});
