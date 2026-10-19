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

// Phase 12 security hardening: rate limits (HTTP per IP, chat per user) and the fixes for
// issues found in the 2026-09-30 docs audit.
describe('Security hardening (e2e)', () => {
  let app: INestApplication;
  let baseUrl: string;
  let users: Repository<User>;
  let groups: Repository<Group>;
  const otpCodes = new Map<string, string>();
  const sockets: Socket[] = [];

  const suffix = randomUUID().slice(0, 8);
  const userIds: string[] = [];
  const http = () => request(app.getHttpServer());

  async function registerUser(label: string) {
    const email = `security-e2e.${label}.${suffix}@example.com`;
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
    return { id: signup.body.userId as string, username, email, token: verified.body.accessToken as string };
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
    await app.listen(0, '127.0.0.1');
    baseUrl = (await app.getUrl()).replace('[::1]', '127.0.0.1');
    users = moduleFixture.get(getRepositoryToken(User));
    groups = moduleFixture.get(getRepositoryToken(Group));
  });

  afterAll(async () => {
    process.env.RATE_LIMIT_DISABLED = 'true';
    sockets.forEach((s) => s.disconnect());
    if (userIds.length) {
      await groups.delete({ createdById: In(userIds) });
      await users.delete({ id: In(userIds) });
    }
    await app.close();
  });

  describe('audit fixes', () => {
    it('rejects a malformed userId on verify even when an email is sent too (400, not 500)', async () => {
      const res = await http()
        .post('/auth/verify')
        .send({ userId: 'junk', email: `nobody.${suffix}@example.com`, code: '123456' })
        .expect(400);
      expect(JSON.stringify(res.body.message)).toMatch(/userId must be a UUID/);
    });

    it('needs exactly one of username/email/phone to add a member', async () => {
      const owner = await registerUser('owner');
      const friend = await registerUser('friend');
      const group = await http()
        .post('/groups')
        .set({ Authorization: `Bearer ${owner.token}` })
        .send({ name: 'g', description: 'd', tripStart: '2026-10-10T00:00:00Z', tripEnd: '2026-10-19T00:00:00Z' })
        .expect(201);
      const res = await http()
        .post(`/groups/${group.body.id}/members`)
        .set({ Authorization: `Bearer ${owner.token}` })
        .send({ username: friend.username, email: friend.email })
        .expect(400);
      expect(res.body.message).toBe('Send exactly one of username, email or phone');
    });

    it('treats a successful OTP login as verifying the phone', async () => {
      const phone = `+9197${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
      const signup = await http()
        .post('/auth/signup')
        .send({ phone, username: `phone_${suffix}`, password: 'Str0ng!Pass', name: 'Phone only' })
        .expect(201);
      userIds.push(signup.body.userId);
      await http().post('/auth/login').send({ identifier: phone, password: 'Str0ng!Pass' }).expect(401); // not verified yet

      await users.update({ id: signup.body.userId }, { otpExpiresAt: new Date(Date.now() - 60_000) }); // skip the resend cooldown
      await http().post('/auth/otp/request').send({ phone }).expect(201);
      await http().post('/auth/otp/login').send({ phone, code: otpCodes.get(phone) }).expect(201);
      expect((await users.findOneByOrFail({ id: signup.body.userId })).phoneVerified).toBe(true);
      await http().post('/auth/login').send({ identifier: phone, password: 'Str0ng!Pass' }).expect(201);
    });
  });

  describe('rate limits', () => {
    beforeAll(() => {
      process.env.RATE_LIMIT_DISABLED = 'false';
    });

    it('limits code-sending endpoints to 5 per minute per IP', async () => {
      for (let i = 0; i < 5; i++) {
        await http().post('/auth/forgot-password').send({ email: `nobody.${suffix}@example.com` }).expect(201);
      }
      const res = await http().post('/auth/forgot-password').send({ email: `nobody.${suffix}@example.com` }).expect(429);
      expect(res.body.message).toBe('Too many requests. Please wait a minute and try again.');
      expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
      // Other routes have their own budget.
      await http().get(`/auth/username-available?username=free_${suffix}`).expect(200);
    });

    it('never limits SOS', async () => {
      const u = await registerUser('sos');
      const group = await http()
        .post('/groups')
        .set({ Authorization: `Bearer ${u.token}` })
        .send({ name: 'g', description: 'd', tripStart: '2026-10-10T00:00:00Z', tripEnd: '2026-10-19T00:00:00Z' })
        .expect(201);
      for (let i = 0; i < 25; i++) {
        await http().post(`/groups/${group.body.id}/alerts/sos`).set({ Authorization: `Bearer ${u.token}` }).send({}).expect(201);
      }
    });

    it('limits chat to 20 messages per 10 s per user', async () => {
      const u = await registerUser('chatty');
      const group = await http()
        .post('/groups')
        .set({ Authorization: `Bearer ${u.token}` })
        .send({ name: 'g', description: 'd', tripStart: '2026-10-10T00:00:00Z', tripEnd: '2026-10-19T00:00:00Z' })
        .expect(201);
      const socket = io(baseUrl, { auth: { token: u.token }, transports: ['websocket'], reconnection: false });
      sockets.push(socket);
      await new Promise((r) => socket.once('ready', r));
      const acks: { ok: boolean; error?: { status: number } }[] = [];
      for (let i = 0; i < 21; i++) {
        acks.push(await socket.timeout(2000).emitWithAck('chat:send', { groupId: group.body.id, body: `msg ${i}` }));
      }
      expect(acks.slice(0, 20).every((a) => a.ok)).toBe(true);
      expect(acks[20]).toMatchObject({ ok: false, error: { status: 429 } });
    });
  });
});
