import { randomUUID } from 'node:crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { io, type Socket } from 'socket.io-client';
import request from 'supertest';
import { In, Repository } from 'typeorm';
import { AppModule } from './../src/app.module.js';
import { Group, User } from './../src/database/entities/index.js';
import { OtpDeliveryService } from './../src/notifications/otp-delivery.service.js';

// Phase 9 DoD against the real dev Postgres: every member's current and historical status is
// visible to the group, and changes arrive live over the socket (members only).
describe('Trip status + realtime (e2e)', () => {
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

  const http = () => request(app.getHttpServer());
  const as = (u: TestUser) => ({ Authorization: `Bearer ${u.token}` });
  const statusUrl = () => `/groups/${groupId}/status`;

  async function registerUser(label: string): Promise<TestUser> {
    const email = `status-e2e.${label}.${suffix}@example.com`; // not `e2e.%`, which the auth suite's cleanup matches
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

  function connect(token: string | null): Socket {
    const socket = io(baseUrl, { auth: token ? { token } : {}, transports: ['websocket'], reconnection: false });
    sockets.push(socket);
    return socket;
  }

  const nextEvent = <T>(socket: Socket, event: string, timeoutMs = 2000) =>
    new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`no "${event}" within ${timeoutMs} ms`)), timeoutMs);
      socket.once(event, (payload: T) => {
        clearTimeout(timer);
        resolve(payload);
      });
    });

  // Resolves true if the event arrives within the window, false otherwise.
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
      .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
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
      .send({ name: 'Ladakh Ride 2026', description: 'd', tripStart: '2026-10-10T00:00:00Z', tripEnd: '2026-10-19T00:00:00Z' })
      .expect(201);
    groupId = group.body.id;
    await http().post(`/groups/${groupId}/members`).set(as(alice)).send({ username: bob.username }).expect(201);
  });

  afterAll(async () => {
    sockets.forEach((s) => s.disconnect());
    if (userIds.length) {
      await groups.delete({ createdById: In(userIds) });
      await users.delete({ id: In(userIds) });
    }
    await app.close();
  });

  let bobSocket: Socket;
  let carolSocket: Socket;

  it('refuses sockets without a valid access token', async () => {
    const noToken = connect(null);
    expect((await nextEvent<Error>(noToken, 'connect_error')).message).toBe('Unauthorized');
    const badToken = connect('not-a-jwt');
    expect((await nextEvent<Error>(badToken, 'connect_error')).message).toBe('Unauthorized');
  });

  it('accepts sockets with an access token', async () => {
    bobSocket = connect(bob.token);
    carolSocket = connect(carol.token);
    expect(await nextEvent(bobSocket, 'ready')).toEqual({ userId: bob.id });
    await nextEvent(carolSocket, 'ready');
  });

  it('starts with every member and no status', async () => {
    await http().get(statusUrl()).set(as(carol)).expect(404);
    const res = await http().get(statusUrl()).set(as(bob)).expect(200);
    expect(res.body).toHaveLength(2);
    expect(res.body.every((m: { status: unknown }) => m.status === null)).toBe(true);
  });

  it('validates input and hides the group from non-members', async () => {
    await http().post(statusUrl()).set(as(bob)).send({ status: 'LOST' }).expect(400);
    await http().post(statusUrl()).set(as(bob)).send({ status: 'ARRIVED', note: 'x'.repeat(281) }).expect(400);
    await http().post(statusUrl()).set(as(carol)).send({ status: 'ARRIVED' }).expect(404);
  });

  it('broadcasts a status change live to members only', async () => {
    const bobHears = nextEvent<{ userId: string; status: string }>(bobSocket, 'status:updated');
    const carolHears = receives(carolSocket, 'status:updated');

    const res = await http().post(statusUrl()).set(as(bob)).send({ status: 'IN_TRANSIT' }).expect(201);
    expect(res.body).toMatchObject({ userId: bob.id, username: bob.username, status: 'IN_TRANSIT', note: null });

    expect(await bobHears).toMatchObject({ userId: bob.id, status: 'IN_TRANSIT', groupId });
    expect(await carolHears).toBe(false);
  });

  it("shows each member's latest status and keeps the full history", async () => {
    await http().post(statusUrl()).set(as(alice)).send({ status: 'STOPPED', note: 'Tea break at Sarchu' }).expect(201);
    await http().post(statusUrl()).set(as(alice)).send({ status: 'NEED_HELP', note: '  Flat tyre 5 km after Keylong  ' }).expect(201);

    const current = await http().get(statusUrl()).set(as(bob)).expect(200);
    const byUser = Object.fromEntries(current.body.map((m: { userId: string }) => [m.userId, m]));
    expect(byUser[alice.id]).toMatchObject({ role: 'ADMIN', status: { status: 'NEED_HELP', note: 'Flat tyre 5 km after Keylong' } });
    expect(byUser[bob.id]).toMatchObject({ role: 'VIEWER', status: { status: 'IN_TRANSIT' } });

    const all = await http().get(`${statusUrl()}/history`).set(as(bob)).expect(200);
    expect(all.body.items.map((s: { status: string }) => s.status)).toEqual(['NEED_HELP', 'STOPPED', 'IN_TRANSIT']);
    expect(all.body.nextBefore).toBeNull();

    const alicesOnly = await http().get(`${statusUrl()}/history`).query({ userId: alice.id }).set(as(bob)).expect(200);
    expect(alicesOnly.body.items).toHaveLength(2);

    const page1 = await http().get(`${statusUrl()}/history`).query({ limit: 2 }).set(as(bob)).expect(200);
    expect(page1.body.items.map((s: { status: string }) => s.status)).toEqual(['NEED_HELP', 'STOPPED']);
    expect(page1.body.nextBefore).toBeTruthy();
    const page2 = await http()
      .get(`${statusUrl()}/history`)
      .query({ limit: 2, before: page1.body.nextBefore })
      .set(as(bob))
      .expect(200);
    expect(page2.body.items.map((s: { status: string }) => s.status)).toEqual(['IN_TRANSIT']);
    expect(page2.body.nextBefore).toBeNull();

    await http().get(`${statusUrl()}/history`).query({ limit: 0 }).set(as(bob)).expect(400);
  });

  it('stops sending to a member as soon as they are removed', async () => {
    await http().delete(`/groups/${groupId}/members/${bob.id}`).set(as(alice)).expect(200);
    const bobHears = receives(bobSocket, 'status:updated');
    await http().post(statusUrl()).set(as(alice)).send({ status: 'ARRIVED' }).expect(201);
    expect(await bobHears).toBe(false);
    await http().get(statusUrl()).set(as(bob)).expect(404);

    // History is kept for trip review, including the removed member's entries.
    const history = await http().get(`${statusUrl()}/history`).set(as(alice)).expect(200);
    expect(history.body.items.some((s: { userId: string }) => s.userId === bob.id)).toBe(true);
  });
});
