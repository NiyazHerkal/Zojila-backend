import { randomUUID } from 'node:crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import { In, Repository } from 'typeorm';
import { AppModule } from './../src/app.module.js';
import { Group, User } from './../src/database/entities/index.js';
import { ElevationProvider } from './../src/enrichment/elevation.provider.js';
import { WeatherProvider } from './../src/enrichment/weather.provider.js';
import { OtpDeliveryService } from './../src/notifications/otp-delivery.service.js';

// Phase 11 against the real dev Postgres: the offline trip bundle (with ETag/304), safe retries of writes queued offline, and the itinerary draft conflict rule.
describe('Offline support (e2e)', () => {
  let app: INestApplication;
  let users: Repository<User>;
  let groups: Repository<Group>;
  const otpCodes = new Map<string, string>();

  const suffix = randomUUID().slice(0, 8);
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
  const bundleUrl = () => `/groups/${groupId}/offline-bundle`;
  const draftUrl = (path = '') => `/groups/${groupId}/itinerary/draft${path}`;

  async function registerUser(label: string): Promise<TestUser> {
    const email = `offline-e2e.${label}.${suffix}@example.com`;
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
      .useValue({ configured: true, getElevation: async () => 3000 })
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
        name: 'Ladakh Ride',
        description: 'd',
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

    // A finalized itinerary (Manali → Leh) and some trip data.
    await http().post(draftUrl()).set(as(alice)).expect(201);
    await http()
      .post(draftUrl('/waypoints'))
      .set(as(alice))
      .send({ name: 'Manali', lat: 32.2432, lng: 77.1892 })
      .expect(201);
    await http()
      .post(draftUrl('/waypoints'))
      .set(as(alice))
      .send({ name: 'Leh', lat: 34.1526, lng: 77.5771 })
      .expect(201);
    await http().post(draftUrl('/finalize')).set(as(alice)).expect(201);
    await http()
      .post(`/groups/${groupId}/status`)
      .set(as(bob))
      .send({ status: 'IN_TRANSIT' })
      .expect(201);
    await http()
      .post(`/groups/${groupId}/expenses`)
      .set(as(alice))
      .send({
        amount: 600,
        category: 'FUEL',
        date: '2026-10-11',
        splitType: 'EQUAL',
      })
      .expect(201);
    await http()
      .post(`/groups/${groupId}/alerts/sos`)
      .set(as(bob))
      .send({ body: 'Puncture' })
      .expect(201);
  });

  afterAll(async () => {
    if (userIds.length) {
      await groups.delete({ createdById: In(userIds) });
      await users.delete({ id: In(userIds) });
    }
    await app.close();
  });

  describe('trip bundle', () => {
    let etag: string;

    it('has everything a viewer needs offline, and no draft', async () => {
      const res = await http().get(bundleUrl()).set(as(bob)).expect(200);
      etag = res.headers.etag;
      expect(etag).toMatch(/^".+"$/);
      expect(res.headers['cache-control']).toBe('private, no-cache');

      const b = res.body;
      expect(b.group).toMatchObject({
        id: groupId,
        currency: 'INR',
        myRole: 'VIEWER',
      });
      expect(b.members).toHaveLength(2);
      expect(b.itinerary).toMatchObject({ status: 'LOCKED', version: 1 });
      expect(
        b.itinerary.waypoints.map((w: { name: string }) => w.name),
      ).toEqual(['Manali', 'Leh']);
      expect(b.draft).toBeNull();
      expect(
        b.statuses.find((s: { userId: string }) => s.userId === bob.id).status
          .status,
      ).toBe('IN_TRANSIT');
      expect(b.expenses.items).toHaveLength(1);
      expect(b.expenses.summary).toMatchObject({
        totalSpent: 600,
        myBalance: -300,
      });
      expect(b.chat.messages.map((m: { type: string }) => m.type)).toEqual([
        'SOS',
      ]);
      expect(b.chat.olderMessages).toBe(false);
      expect(b.activeAlerts).toHaveLength(1);

      expect(b.map).toBeUndefined(); // offline map downloads were dropped
    });

    it('answers 304 when nothing changed, and a new ETag after a change', async () => {
      await http()
        .get(bundleUrl())
        .set(as(bob))
        .set('If-None-Match', etag)
        .expect(304);
      await http()
        .get(bundleUrl())
        .set(as(bob))
        .set('If-None-Match', '"something-else"')
        .expect(200);

      await http()
        .post(`/groups/${groupId}/status`)
        .set(as(bob))
        .send({ status: 'ARRIVED' })
        .expect(201);
      const res = await http()
        .get(bundleUrl())
        .set(as(bob))
        .set('If-None-Match', etag)
        .expect(200);
      expect(res.headers.etag).not.toBe(etag);
    });

    it('includes the draft for admins, and hides the group from non-members', async () => {
      await http().post(draftUrl()).set(as(alice)).expect(201);
      const res = await http().get(bundleUrl()).set(as(alice)).expect(200);
      expect(res.body.draft).toMatchObject({
        status: 'DRAFT',
        basedOnVersion: 1,
        revision: 0,
      });
      await http().get(bundleUrl()).set(as(carol)).expect(404);
    });
  });

  describe('draft conflicts (If-Match)', () => {
    it('applies edits based on the current revision and refuses stale ones with 412', async () => {
      const draft = await http().get(draftUrl()).set(as(alice)).expect(200);
      const rev = draft.body.revision;

      const added = await http()
        .post(draftUrl('/waypoints'))
        .set(as(alice))
        .set('If-Match', `"${rev}"`)
        .send({ name: 'Keylong', lat: 32.5717, lng: 77.0339, position: 2 })
        .expect(201);
      expect(added.body.revision).toBe(rev + 1);

      // Another admin's copy (still at `rev`) is now stale.
      const stale = await http()
        .put(draftUrl('/waypoints/order'))
        .set(as(alice))
        .set('If-Match', String(rev))
        .send({
          waypointIds: [...added.body.waypoints]
            .reverse()
            .map((w: { id: string }) => w.id),
        })
        .expect(412);
      expect(stale.body.message).toMatch(`now revision ${rev + 1}`);
      await http()
        .post(draftUrl('/finalize'))
        .set(as(alice))
        .set('If-Match', String(rev))
        .expect(412);
      await http()
        .post(draftUrl('/finalize'))
        .set(as(alice))
        .set('If-Match', 'latest')
        .expect(400);

      // Without If-Match the edit just applies (last write wins).
      const pin = added.body.waypoints[1].id;
      const edited = await http()
        .patch(draftUrl(`/waypoints/${pin}`))
        .set(as(alice))
        .send({ notes: 'Overnight' })
        .expect(200);
      expect(edited.body.revision).toBe(rev + 2);
      const finalized = await http()
        .post(draftUrl('/finalize'))
        .set(as(alice))
        .set('If-Match', `W/"${rev + 2}"`)
        .expect(201);
      expect(finalized.body.version).toBe(2);
    });
  });

  describe('writes queued offline', () => {
    it('creates an expense once, however many times the same clientId is sent', async () => {
      const clientId = randomUUID();
      const body = {
        amount: 250,
        category: 'FOOD',
        date: '2026-10-12',
        splitType: 'EQUAL',
        clientId,
      };
      const first = await http()
        .post(`/groups/${groupId}/expenses`)
        .set(as(bob))
        .send(body)
        .expect(201);
      const again = await http()
        .post(`/groups/${groupId}/expenses`)
        .set(as(bob))
        .send(body)
        .expect(201);
      expect(again.body.id).toBe(first.body.id);
      const list = await http()
        .get(`/groups/${groupId}/expenses?category=FOOD`)
        .set(as(bob))
        .expect(200);
      expect(list.body.items).toHaveLength(1);
      // Another person may use the same clientId: it's scoped to whoever recorded it.
      const alices = await http()
        .post(`/groups/${groupId}/expenses`)
        .set(as(alice))
        .send(body)
        .expect(201);
      expect(alices.body.id).not.toBe(first.body.id);
    });

    it('keeps the time a status was set offline, and de-duplicates retries', async () => {
      const recordedAt = new Date(Date.now() - 2 * 3600_000).toISOString();
      const clientId = randomUUID();
      const first = await http()
        .post(`/groups/${groupId}/status`)
        .set(as(bob))
        .send({
          status: 'STOPPED',
          note: 'No signal at Sarchu',
          recordedAt,
          clientId,
        })
        .expect(201);
      expect(first.body.createdAt).toBe(recordedAt);
      const again = await http()
        .post(`/groups/${groupId}/status`)
        .set(as(bob))
        .send({
          status: 'STOPPED',
          note: 'No signal at Sarchu',
          recordedAt,
          clientId,
        })
        .expect(201);
      expect(again.body.id).toBe(first.body.id);

      // The older offline status lands in history but doesn't replace the newer current one.
      const current = await http()
        .get(`/groups/${groupId}/status`)
        .set(as(alice))
        .expect(200);
      expect(
        current.body.find((s: { userId: string }) => s.userId === bob.id).status
          .status,
      ).toBe('ARRIVED');

      const future = new Date(Date.now() + 3600_000).toISOString();
      await http()
        .post(`/groups/${groupId}/status`)
        .set(as(bob))
        .send({ status: 'ARRIVED', recordedAt: future })
        .expect(400);
      const tooOld = new Date(Date.now() - 8 * 24 * 3600_000).toISOString();
      await http()
        .post(`/groups/${groupId}/status`)
        .set(as(bob))
        .send({ status: 'ARRIVED', recordedAt: tooOld })
        .expect(400);
    });
  });
});
