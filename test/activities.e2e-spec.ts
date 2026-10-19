import { randomUUID } from 'node:crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { io, type Socket } from 'socket.io-client';
import request from 'supertest';
import { In, Repository } from 'typeorm';
import { AppModule } from './../src/app.module.js';
import { Group, User } from './../src/database/entities/index.js';
import { ElevationProvider } from './../src/enrichment/elevation.provider.js';
import { WeatherProvider } from './../src/enrichment/weather.provider.js';
import { OtpDeliveryService } from './../src/notifications/otp-delivery.service.js';

// Change request v1.0, changes 3–4: each stop of the finalized itinerary is an "activity" with a
// status (admins) and a feed of updates (any member), both kept across itinerary versions.
describe('Activities: status + updates (e2e)', () => {
  let app: INestApplication;
  let baseUrl: string;
  let users: Repository<User>;
  let groups: Repository<Group>;
  const otpCodes = new Map<string, string>();
  const sockets: Socket[] = [];

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
  let bobSocket: Socket;
  let manali: string; // activityIds
  let keylong: string;
  let leh: string;
  let bobsUpdate: string;

  const http = () => request(app.getHttpServer());
  const as = (u: TestUser) => ({ Authorization: `Bearer ${u.token}` });
  const g = (path: string) => `/groups/${groupId}${path}`;
  const next = (socket: Socket, event: string) =>
    new Promise<Record<string, any>>((r) => socket.once(event, r));

  async function registerUser(label: string): Promise<TestUser> {
    const email = `activities-e2e.${label}.${suffix}@example.com`;
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
      .useValue({ configured: false, getElevation: async () => null })
      .overrideProvider(WeatherProvider)
      .useValue({
        configured: false,
        name: 'fake',
        attribution: 'Weather: fake',
        forecastDays: 8,
        getDailyForecast: async () => [],
      })
      .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.listen(0, '127.0.0.1'); // sockets need a real port
    baseUrl = (await app.getUrl()).replace('[::1]', '127.0.0.1');
    users = moduleFixture.get(getRepositoryToken(User));
    groups = moduleFixture.get(getRepositoryToken(Group));

    alice = await registerUser('alice');
    bob = await registerUser('bob');
    carol = await registerUser('carol');

    const group = await http()
      .post('/groups')
      .set(as(alice))
      .send({
        name: 'Spiti Loop',
        description: 'd',
        tripStart: '2026-10-10T00:00:00Z',
        tripEnd: '2026-10-19T00:00:00Z',
      })
      .expect(201);
    groupId = group.body.id;
    await http()
      .post(g('/members'))
      .set(as(alice))
      .send({ username: bob.username })
      .expect(201);

    bobSocket = io(baseUrl, {
      auth: { token: bob.token },
      transports: ['websocket'],
      reconnection: false,
    });
    sockets.push(bobSocket);
    await new Promise((r) => bobSocket.once('ready', r));
  });

  afterAll(async () => {
    sockets.forEach((s) => s.disconnect());
    if (userIds.length) {
      await groups.delete({ createdById: In(userIds) });
      await users.delete({ id: In(userIds) });
    }
    await app.close();
  });

  it('has no activities until the itinerary is finalized', async () => {
    await http().get(g('/activities')).set(as(bob)).expect(404);

    await http().post(g('/itinerary/draft')).set(as(alice)).expect(201);
    for (const [name, lat, lng] of [
      ['Manali', 32.2432, 77.1892],
      ['Keylong', 32.5715, 77.0326],
      ['Leh', 34.1526, 77.5771],
    ] as const) {
      await http()
        .post(g('/itinerary/draft/waypoints'))
        .set(as(alice))
        .send({ name, lat, lng })
        .expect(201);
    }
    const draft = await http()
      .get(g('/itinerary/draft'))
      .set(as(alice))
      .expect(200);
    [manali, keylong, leh] = draft.body.waypoints.map(
      (w: { activityId: string }) => w.activityId,
    );
    expect(draft.body.waypoints[0].activity).toEqual({
      status: 'UPCOMING',
      statusUpdatedAt: null,
      statusUpdatedBy: null,
      updateCount: 0,
    });

    // A stop that's only in the draft isn't an activity yet.
    await http()
      .patch(g(`/activities/${manali}/status`))
      .set(as(alice))
      .send({ status: 'CURRENT' })
      .expect(404);
    await http()
      .post(g('/itinerary/draft/finalize'))
      .set(as(alice))
      .expect(201);

    const list = await http().get(g('/activities')).set(as(bob)).expect(200);
    expect(list.body.itineraryVersion).toBe(1);
    expect(
      list.body.activities.map((a: { name: string; status: string }) => [
        a.name,
        a.status,
      ]),
    ).toEqual([
      ['Manali', 'UPCOMING'],
      ['Keylong', 'UPCOMING'],
      ['Leh', 'UPCOMING'],
    ]);
  });

  it('lets only admins set the status, one CURRENT at a time, live', async () => {
    await http()
      .patch(g(`/activities/${manali}/status`))
      .set(as(bob))
      .send({ status: 'CURRENT' })
      .expect(403);
    await http()
      .patch(g(`/activities/${manali}/status`))
      .set(as(alice))
      .send({ status: 'DONE' })
      .expect(400);
    await http()
      .patch(g(`/activities/${randomUUID()}/status`))
      .set(as(alice))
      .send({ status: 'CURRENT' })
      .expect(404);
    await http()
      .patch(g(`/activities/${manali}/status`))
      .set(as(carol))
      .send({ status: 'CURRENT' })
      .expect(404);

    const event = next(bobSocket, 'activity:status_updated');
    const res = await http()
      .patch(g(`/activities/${manali}/status`))
      .set(as(alice))
      .send({ status: 'CURRENT' })
      .expect(200);
    expect(res.body).toMatchObject({
      activityId: manali,
      name: 'Manali',
      status: 'CURRENT',
      statusUpdatedBy: { userId: alice.id },
    });
    expect(await event).toMatchObject({
      groupId,
      activityId: manali,
      status: 'CURRENT',
      updatedBy: alice.id,
    });

    // Moving on: Keylong becomes CURRENT, Manali is completed automatically.
    const events: Record<string, any>[] = [];
    bobSocket.on('activity:status_updated', (e) => events.push(e));
    await http()
      .patch(g(`/activities/${keylong}/status`))
      .set(as(alice))
      .send({ status: 'CURRENT' })
      .expect(200);
    await new Promise((r) => setTimeout(r, 300));
    bobSocket.off('activity:status_updated');
    expect(events.map((e) => [e.activityId, e.status])).toEqual([
      [manali, 'COMPLETED'],
      [keylong, 'CURRENT'],
    ]);

    const itinerary = await http()
      .get(g('/itinerary'))
      .set(as(bob))
      .expect(200);
    expect(
      itinerary.body.waypoints.map(
        (w: { activity: { status: string } }) => w.activity.status,
      ),
    ).toEqual(['COMPLETED', 'CURRENT', 'UPCOMING']);
  });

  it('lets any member post updates, live, without duplicates on retry', async () => {
    const event = next(bobSocket, 'activity:update_added');
    const clientId = randomUUID();
    const res = await http()
      .post(g(`/activities/${keylong}/updates`))
      .set(as(bob))
      .send({ text: '  Petrol pump at Tandi is open  ', clientId })
      .expect(201);
    bobsUpdate = res.body.id;
    expect(res.body).toMatchObject({
      activityId: keylong,
      text: 'Petrol pump at Tandi is open',
      author: { userId: bob.id },
      canEdit: true,
      canDelete: true,
      editedAt: null,
    });
    const received = await event;
    expect(received).toMatchObject({
      groupId,
      activityId: keylong,
      updateId: bobsUpdate,
      update: { text: 'Petrol pump at Tandi is open' },
    });
    expect(received.update.canEdit).toBeUndefined();

    const retry = await http()
      .post(g(`/activities/${keylong}/updates`))
      .set(as(bob))
      .send({ text: 'again', clientId })
      .expect(201);
    expect(retry.body.id).toBe(bobsUpdate);

    await http()
      .post(g(`/activities/${keylong}/updates`))
      .set(as(alice))
      .send({ text: 'Lunch at the dhaba' })
      .expect(201);
    await http()
      .post(g(`/activities/${keylong}/updates`))
      .set(as(alice))
      .send({ text: '   ' })
      .expect(400);
    await http()
      .post(g(`/activities/${keylong}/updates`))
      .set(as(alice))
      .send({ text: 'x'.repeat(1001) })
      .expect(400);
    await http()
      .post(g(`/activities/${keylong}/updates`))
      .set(as(carol))
      .send({ text: 'hi' })
      .expect(404);

    const page1 = await http()
      .get(g(`/activities/${keylong}/updates?limit=1`))
      .set(as(bob))
      .expect(200);
    expect(page1.body.items.map((u: { text: string }) => u.text)).toEqual([
      'Lunch at the dhaba',
    ]);
    expect(page1.body.items[0]).toMatchObject({
      canEdit: false,
      canDelete: false,
    });
    const page2 = await http()
      .get(
        g(
          `/activities/${keylong}/updates?limit=1&before=${page1.body.nextBefore}`,
        ),
      )
      .set(as(bob))
      .expect(200);
    expect(page2.body.items.map((u: { id: string }) => u.id)).toEqual([
      bobsUpdate,
    ]);
    expect(page2.body.nextBefore).toBeNull();

    const activities = await http()
      .get(g('/activities'))
      .set(as(bob))
      .expect(200);
    expect(activities.body.activities[1].updateCount).toBe(2);
  });

  it('lets the author edit, and the author or an admin delete', async () => {
    await http()
      .patch(g(`/activity-updates/${bobsUpdate}`))
      .set(as(alice))
      .send({ text: 'mine now' })
      .expect(403);
    const edited = next(bobSocket, 'activity:update_edited');
    const res = await http()
      .patch(g(`/activity-updates/${bobsUpdate}`))
      .set(as(bob))
      .send({ text: 'Pump at Tandi closes at 8 pm' })
      .expect(200);
    expect(res.body.editedAt).not.toBeNull();
    expect(await edited).toMatchObject({
      updateId: bobsUpdate,
      update: { text: 'Pump at Tandi closes at 8 pm' },
    });

    const deleted = next(bobSocket, 'activity:update_deleted');
    await http()
      .delete(g(`/activity-updates/${bobsUpdate}`))
      .set(as(alice))
      .expect(200); // admin deletes bob's
    expect(await deleted).toMatchObject({
      groupId,
      activityId: keylong,
      updateId: bobsUpdate,
      deletedBy: alice.id,
    });
    await http()
      .delete(g(`/activity-updates/${bobsUpdate}`))
      .set(as(bob))
      .expect(404);

    const alices = await http()
      .get(g(`/activities/${keylong}/updates`))
      .set(as(bob))
      .expect(200);
    expect(alices.body.items).toHaveLength(1);
    await http()
      .delete(g(`/activity-updates/${alices.body.items[0].id}`))
      .set(as(bob))
      .expect(403); // viewer, not the author
  });

  it('keeps status and updates when the itinerary is edited and re-finalized', async () => {
    const draft = await http()
      .post(g('/itinerary/draft'))
      .set(as(alice))
      .expect(201);
    expect(
      draft.body.waypoints.map((w: { activityId: string }) => w.activityId),
    ).toEqual([manali, keylong, leh]);
    const lehPin = draft.body.waypoints[2].id;
    await http()
      .delete(g(`/itinerary/draft/waypoints/${lehPin}`))
      .set(as(alice))
      .expect(200);
    await http()
      .post(g('/itinerary/draft/waypoints'))
      .set(as(alice))
      .send({ name: 'Kaza', lat: 32.2276, lng: 78.0716 })
      .expect(201);
    await http()
      .post(g('/itinerary/draft/finalize'))
      .set(as(alice))
      .expect(201);

    const list = await http().get(g('/activities')).set(as(bob)).expect(200);
    expect(list.body.itineraryVersion).toBe(2);
    expect(
      list.body.activities.map(
        (a: { activityId: string; status: string; updateCount: number }) => [
          a.activityId,
          a.status,
          a.updateCount,
        ],
      ),
    ).toEqual([
      [manali, 'COMPLETED', 0],
      [keylong, 'CURRENT', 1],
      [expect.any(String), 'UPCOMING', 0],
    ]);
    // Leh was removed: no new status or updates, but its history can still be read.
    await http()
      .patch(g(`/activities/${leh}/status`))
      .set(as(alice))
      .send({ status: 'CURRENT' })
      .expect(404);
    await http()
      .post(g(`/activities/${leh}/updates`))
      .set(as(bob))
      .send({ text: 'hi' })
      .expect(404);
    await http()
      .get(g(`/activities/${leh}/updates`))
      .set(as(bob))
      .expect(200);
  });

  it('puts the updates in the offline bundle and the data export', async () => {
    const bundle = await http()
      .get(g('/offline-bundle'))
      .set(as(bob))
      .expect(200);
    expect(
      bundle.body.activityUpdates.map((u: { text: string }) => u.text),
    ).toEqual(['Lunch at the dhaba']);
    expect(bundle.body.itinerary.waypoints[1].activity.status).toBe('CURRENT');

    const exported = await http()
      .get('/auth/me/export')
      .set(as(alice))
      .expect(200);
    expect(exported.body.activityUpdates).toEqual([
      expect.objectContaining({
        activityId: keylong,
        text: 'Lunch at the dhaba',
      }),
    ]);
  });
});
