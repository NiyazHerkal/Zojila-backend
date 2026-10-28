import { randomUUID } from 'node:crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import { In, Repository } from 'typeorm';
import { AppModule } from './../src/app.module.js';
import { Group, Notification, User } from './../src/database/entities/index.js';
import { ElevationProvider } from './../src/enrichment/elevation.provider.js';
import { WeatherProvider } from './../src/enrichment/weather.provider.js';
import { OtpDeliveryService } from './../src/notifications/otp-delivery.service.js';
import { RetentionService } from './../src/privacy/retention.service.js';

// Notifications feed (backend handover 2026-10-22, Q2): alerts & SOS, trip/member changes and
// expenses land in each user's feed, with or without a phone registered for push.
describe('Notifications feed (e2e)', () => {
  let app: INestApplication;
  let users: Repository<User>;
  let groups: Repository<Group>;
  let notifications: Repository<Notification>;
  let retention: RetentionService;
  const otpCodes = new Map<string, string>();
  const suffix = randomUUID().slice(0, 8);
  interface TestUser {
    id: string;
    username: string;
    email: string;
    token: string;
  }
  const userIds: string[] = [];
  let alice: TestUser; // admin
  let bob: TestUser; // added directly
  let carol: TestUser; // invited by email
  let groupId: string;

  const http = () => request(app.getHttpServer());
  const as = (u: TestUser) => ({ Authorization: `Bearer ${u.token}` });
  const g = (path: string) => `/groups/${groupId}${path}`;
  const feedOf = async (u: TestUser, query = '') => (await http().get(`/notifications${query}`).set(as(u)).expect(200)).body;
  const types = (body: { items: { type: string }[] }) => body.items.map((n) => n.type);

  async function registerUser(label: string): Promise<TestUser> {
    const email = `notif-e2e.${label}.${suffix}@example.com`;
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
    return { id: signup.body.userId, username, email, token: verified.body.accessToken };
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(OtpDeliveryService)
      .useValue({
        sendEmail: async (to: string, code: string) => void otpCodes.set(to, code),
        sendSms: async (to: string, code: string) => void otpCodes.set(to, code),
      })
      .overrideProvider(ElevationProvider)
      .useValue({ configured: false, getElevation: async () => null })
      .overrideProvider(WeatherProvider)
      .useValue({ configured: false, name: 'off', attribution: '', forecastDays: 8, getDailyForecast: async () => [] })
      .compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    users = moduleFixture.get(getRepositoryToken(User));
    groups = moduleFixture.get(getRepositoryToken(Group));
    notifications = moduleFixture.get(getRepositoryToken(Notification));
    retention = moduleFixture.get(RetentionService);

    alice = await registerUser('alice');
    bob = await registerUser('bob');
    carol = await registerUser('carol');
    const group = await http()
      .post('/groups')
      .set(as(alice))
      .send({ name: 'Spiti Loop', description: 'd', tripStart: '2026-10-10T00:00:00Z', tripEnd: '2026-10-19T00:00:00Z' })
      .expect(201);
    groupId = group.body.id;
  });

  afterAll(async () => {
    if (userIds.length) {
      await groups.delete({ createdById: In(userIds) });
      await users.delete({ id: In(userIds) });
    }
    await app.close();
  });

  it('needs sign-in and starts empty', async () => {
    await http().get('/notifications').expect(401);
    expect(await feedOf(bob)).toEqual({ items: [], nextBefore: null, unreadCount: 0 });
  });

  it('records trip and member events for the person concerned', async () => {
    await http().post(g('/members')).set(as(alice)).send({ username: bob.username }).expect(201);
    await http().patch(g(`/members/${bob.id}`)).set(as(alice)).send({ role: 'ADMIN' }).expect(200);
    await http().patch(g(`/members/${bob.id}`)).set(as(alice)).send({ role: 'VIEWER' }).expect(200);
    await http().post(g('/invites')).set(as(alice)).send({ channel: 'EMAIL', email: carol.email }).expect(201);

    // A finalized itinerary: everyone but the admin who published it.
    await http().post(g('/itinerary/draft')).set(as(alice)).expect(201);
    for (const [name, lat, lng] of [
      ['Manali', 32.2432, 77.1892],
      ['Leh', 34.1526, 77.5771],
    ] as const) {
      await http().post(g('/itinerary/draft/waypoints')).set(as(alice)).send({ name, lat, lng }).expect(201);
    }
    await http().post(g('/itinerary/draft/finalize')).set(as(alice)).expect(201);

    const feed = await feedOf(bob);
    expect(types(feed)).toEqual(['ITINERARY_UPDATED', 'ROLE_CHANGED', 'ROLE_CHANGED', 'MEMBER_ADDED']);
    expect(feed.unreadCount).toBe(4);
    expect(feed.items[3]).toMatchObject({
      type: 'MEMBER_ADDED',
      groupId,
      title: 'Spiti Loop',
      body: 'E2E alice added you to "Spiti Loop"',
      data: { groupId },
      readAt: null,
    });
    expect(feed.items[2].body).toBe('E2E alice made you an admin of "Spiti Loop"');
    expect(feed.items[1].body).toBe('E2E alice made you a viewer of "Spiti Loop"');
    expect(feed.items[0]).toMatchObject({ body: 'The itinerary is ready', data: { version: '1' } });

    expect(types(await feedOf(carol))).toEqual(['TRIP_INVITE']);
    expect((await feedOf(carol)).items[0]).toMatchObject({ body: 'E2E alice invited you to join "Spiti Loop"' });
    expect(types(await feedOf(alice))).toEqual([]); // nothing about her own actions
  });

  it('records alert and expense pushes, even with no phone registered', async () => {
    const sos = await http().post(g('/alerts/sos')).set(as(bob)).send({}).expect(201);
    await http()
      .post(g('/expenses'))
      .set(as(alice))
      .send({ amount: 900, category: 'FUEL', date: '2026-10-11', description: 'Diesel at Tandi', splitType: 'EQUAL' })
      .expect(201);

    const aliceFeed = await feedOf(alice);
    expect(types(aliceFeed)).toEqual(['SOS']);
    expect(aliceFeed.items[0]).toMatchObject({ groupId, data: { type: 'SOS', groupId, alertId: sos.body.id } });
    expect(types(await feedOf(bob))[0]).toBe('EXPENSE_ADDED');

    await http().post(g(`/alerts/${sos.body.id}/ack`)).set(as(alice)).expect(200);
    expect(types(await feedOf(bob)).slice(0, 2)).toEqual(['SOS_ACKNOWLEDGED', 'EXPENSE_ADDED']);
  });

  it('pages newest first and marks entries read', async () => {
    const page1 = await feedOf(bob, '?limit=2');
    expect(page1.items).toHaveLength(2);
    expect(page1.nextBefore).toBe(page1.items[1].id);
    const page2 = await feedOf(bob, `?limit=2&before=${page1.nextBefore}`);
    expect(page2.items.map((n: { id: string }) => n.id)).not.toContain(page1.items[0].id);
    await http().get(`/notifications?before=${randomUUID()}`).set(as(bob)).expect(400);

    const before = (await http().get('/notifications/unread-count').set(as(bob)).expect(200)).body.unreadCount;
    expect(before).toBe(6);
    const one = await http().post('/notifications/read').set(as(bob)).send({ ids: [page1.items[0].id] }).expect(200);
    expect(one.body).toEqual({ unreadCount: 5 });
    expect((await feedOf(bob, '?limit=1')).items[0].readAt).toBeTruthy();

    // Someone else's ids do nothing.
    await http().post('/notifications/read').set(as(alice)).send({ ids: [page1.items[1].id] }).expect(200);
    expect((await http().get('/notifications/unread-count').set(as(bob))).body.unreadCount).toBe(5);

    await http().post('/notifications/read').set(as(bob)).send({ ids: ['nope'] }).expect(400);
    expect((await http().post('/notifications/read').set(as(bob)).send({}).expect(200)).body).toEqual({ unreadCount: 0 });
  });

  it('tells a removed member, and deletes entries after 90 days', async () => {
    await http().delete(g(`/members/${bob.id}`)).set(as(alice)).expect(200);
    const feed = await feedOf(bob);
    expect(feed.items[0]).toMatchObject({ type: 'MEMBER_REMOVED', body: 'E2E alice removed you from "Spiti Loop"' });

    await notifications.update({ userId: carol.id }, { createdAt: new Date(Date.now() - 91 * 86_400_000) });
    expect(await retention.purgeOldNotifications(new Date(), [carol.id])).toBe(1);
    expect((await feedOf(carol)).items).toEqual([]);
  });
});
