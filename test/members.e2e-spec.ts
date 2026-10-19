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

// Change request v1.0, change 5: any number of admins in one group, and member changes
// (joined / removed / role changed) reach the group live.
describe('Members: multiple admins + live member events (e2e)', () => {
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
  let alice: TestUser; // creator
  let bob: TestUser;
  let carol: TestUser;
  let dave: TestUser; // joins by link
  let groupId: string;
  let bobSocket: Socket;
  let carolSocket: Socket;

  const http = () => request(app.getHttpServer());
  const as = (u: TestUser) => ({ Authorization: `Bearer ${u.token}` });
  const next = (socket: Socket, event: string) => new Promise<Record<string, any>>((r) => socket.once(event, r));

  async function registerUser(label: string): Promise<TestUser> {
    const email = `members-e2e.${label}.${suffix}@example.com`;
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
    dave = await registerUser('dave');

    const group = await http()
      .post('/groups')
      .set(as(alice))
      .send({ name: 'Admins Trip', description: 'd', tripStart: '2026-10-10T00:00:00Z', tripEnd: '2026-10-19T00:00:00Z' })
      .expect(201);
    groupId = group.body.id;
  });

  afterAll(async () => {
    sockets.forEach((s) => s.disconnect());
    if (userIds.length) {
      await groups.delete({ createdById: In(userIds) });
      await users.delete({ id: In(userIds) });
    }
    await app.close();
  });

  it('announces a member added directly (member:joined)', async () => {
    await http().post(`/groups/${groupId}/members`).set(as(alice)).send({ username: bob.username }).expect(201);
    bobSocket = await connect(bob);

    const joined = next(bobSocket, 'member:joined');
    await http().post(`/groups/${groupId}/members`).set(as(alice)).send({ username: carol.username }).expect(201);
    expect(await joined).toMatchObject({
      groupId,
      via: 'DIRECT',
      addedBy: alice.id,
      member: { userId: carol.id, username: carol.username, role: 'VIEWER' },
    });
    carolSocket = await connect(carol);
  });

  it('announces someone joining by share link, but not a repeat accept', async () => {
    const link = await http().post(`/groups/${groupId}/invites`).set(as(alice)).send({ channel: 'LINK' }).expect(201);
    const { token } = link.body;

    const joined = next(bobSocket, 'member:joined');
    await http().post(`/invites/link/${token}/accept`).set(as(dave)).expect(201);
    expect(await joined).toMatchObject({ via: 'LINK', member: { userId: dave.id }, addedBy: alice.id });

    let repeated = false;
    bobSocket.once('member:joined', () => (repeated = true));
    await http().post(`/invites/link/${token}/accept`).set(as(dave)).expect(201);
    await new Promise((r) => setTimeout(r, 300));
    expect(repeated).toBe(false);
    bobSocket.off('member:joined');
  });

  it('lets every member be an admin at once, with live member:role_changed', async () => {
    const changed = next(carolSocket, 'member:role_changed');
    await http().patch(`/groups/${groupId}/members/${bob.id}`).set(as(alice)).send({ role: 'ADMIN' }).expect(200);
    expect(await changed).toMatchObject({ groupId, userId: bob.id, newRole: 'ADMIN', changedBy: alice.id });

    // A second admin (bob) promotes the rest: 4 admins in one group.
    for (const u of [carol, dave]) {
      await http().patch(`/groups/${groupId}/members/${u.id}`).set(as(bob)).send({ role: 'ADMIN' }).expect(200);
    }
    const members = await http().get(`/groups/${groupId}/members`).set(as(dave)).expect(200);
    expect(members.body.map((m: { role: string }) => m.role)).toEqual(['ADMIN', 'ADMIN', 'ADMIN', 'ADMIN']);

    // Setting the role it already has changes nothing and announces nothing.
    let announced = false;
    carolSocket.once('member:role_changed', () => (announced = true));
    await http().patch(`/groups/${groupId}/members/${bob.id}`).set(as(dave)).send({ role: 'ADMIN' }).expect(200);
    await new Promise((r) => setTimeout(r, 300));
    expect(announced).toBe(false);
    carolSocket.off('member:role_changed');

    // Admins can still step down while another admin remains.
    await http().patch(`/groups/${groupId}/members/${dave.id}`).set(as(dave)).send({ role: 'VIEWER' }).expect(200);
  });

  it('tells the group and the removed person (member:removed)', async () => {
    const toGroup = next(bobSocket, 'member:removed');
    const toCarol = next(carolSocket, 'member:removed');
    await http().delete(`/groups/${groupId}/members/${carol.id}`).set(as(alice)).expect(200);
    const expected = { groupId, userId: carol.id, removedBy: alice.id, left: false };
    expect(await toGroup).toMatchObject(expected);
    expect(await toCarol).toMatchObject(expected);

    const left = next(bobSocket, 'member:removed');
    await http().delete(`/groups/${groupId}/members/${dave.id}`).set(as(dave)).expect(200);
    expect(await left).toMatchObject({ userId: dave.id, removedBy: dave.id, left: true });
  });
});
