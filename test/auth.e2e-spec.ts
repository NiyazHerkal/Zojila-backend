import { randomUUID } from 'node:crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import { Repository } from 'typeorm';
import { AppModule } from './../src/app.module.js';
import { User } from './../src/database/entities/index.js';
import { OtpDeliveryService } from './../src/notifications/otp-delivery.service.js';

// Full Phase 3 auth flow against the real dev Postgres (see context/01_Architecture.md §6).
// OTP delivery is swapped for a stub that records codes, so no console-reading is needed.
describe('Auth (e2e)', () => {
  let app: INestApplication;
  let users: Repository<User>;
  const sentCodes = new Map<string, string>();
  let sendCount = 0;

  const suffix = randomUUID().slice(0, 8);
  const email = `E2E.${suffix}@Example.com`;
  const phone = `+9198${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
  const username = `E2E_${suffix}`; // mixed case on purpose — stored lowercase
  const password = 'Str0ng!Pass';

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(OtpDeliveryService)
      .useValue({
        sendEmail: async (to: string, code: string) => void (sendCount++, sentCodes.set(to, code)),
        sendSms: async (to: string, code: string) => void (sendCount++, sentCodes.set(to, code)),
      })
      .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    users = moduleFixture.get(getRepositoryToken(User));
  });

  afterAll(async () => {
    await users
      .createQueryBuilder()
      .delete()
      .where('phone = :phone OR email ILIKE :e2e OR email ILIKE :weak', {
        phone,
        e2e: 'e2e.%@example.com',
        weak: 'weak.%@example.com',
      })
      .execute();
    await app.close();
  });

  const http = () => request(app.getHttpServer());

  it('rejects weak passwords on signup', async () => {
    const res = await http()
      .post('/auth/signup')
      .send({ email: `weak.${suffix}@example.com`, username: `weak_${suffix}`, password: 'password1', name: 'Weak' })
      .expect(400);
    expect(JSON.stringify(res.body.message)).toMatch(/uppercase|symbol/i);
  });

  let userId: string;
  let refreshToken: string;
  let accessToken: string;

  it('signs up, blocks login until verified, then verifies', async () => {
    const res = await http()
      .post('/auth/signup')
      .send({ email, phone, username, password, name: 'E2E User' })
      .expect(201);
    userId = res.body.userId;

    await http().post('/auth/login').send({ identifier: email, password }).expect(401);

    const code = sentCodes.get(email.toLowerCase())!;
    expect(code).toMatch(/^\d{6}$/);
    await http().post('/auth/verify').send({ userId, code: '000000' }).expect(400);
    const verified = await http().post('/auth/verify').send({ userId, code }).expect(201);
    expect(verified.body.accessToken).toBeTruthy();
  });

  it('rejects a malformed userId on verify with 400, not 500', async () => {
    await http().post('/auth/verify').send({ userId: 'not-a-uuid', code: '123456' }).expect(400);
  });

  it('treats email case-insensitively (no duplicate signup, login works)', async () => {
    await http()
      .post('/auth/signup')
      .send({ email: email.toLowerCase(), username: `dup_${suffix}`, password, name: 'Dup' })
      .expect(409);
    const res = await http()
      .post('/auth/login')
      .send({ identifier: email.toUpperCase(), password })
      .expect(201);
    accessToken = res.body.accessToken;
    refreshToken = res.body.refreshToken;
  });

  it('enforces username rules and uniqueness (case-insensitive)', async () => {
    for (const bad of ['ab', 'has space', '_leading', 'trailing.', 'at@sign', 'x'.repeat(31)]) {
      await http()
        .post('/auth/signup')
        .send({ email: `bad.${suffix}@example.com`, username: bad, password, name: 'Bad' })
        .expect(400);
    }
    const taken = await http()
      .post('/auth/signup')
      .send({ email: `taken.${suffix}@example.com`, username: username.toUpperCase(), password, name: 'Taken' })
      .expect(409);
    expect(taken.body.message).toMatch(/username/i);

    const check = await http().get('/auth/username-available').query({ username }).expect(200);
    expect(check.body).toEqual({ username: username.toLowerCase(), available: false });
    const free = await http().get('/auth/username-available').query({ username: `free_${suffix}` }).expect(200);
    expect(free.body.available).toBe(true);
    await http().get('/auth/username-available').query({ username: 'a' }).expect(400);
  });

  it('logs in with username, in any case', async () => {
    await http().post('/auth/login').send({ identifier: username.toUpperCase(), password }).expect(201);
  });

  it('gets and updates the profile', async () => {
    await http().get('/auth/me').expect(401);
    const me = await http().get('/auth/me').set('Authorization', `Bearer ${accessToken}`).expect(200);
    expect(me.body).toMatchObject({
      id: userId,
      username: username.toLowerCase(),
      email: email.toLowerCase(),
      emailVerified: true,
    });
    expect(me.body.passwordHash).toBeUndefined();

    const updated = await http()
      .patch('/auth/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name: 'Renamed', username: `Renamed_${suffix}` })
      .expect(200);
    expect(updated.body).toMatchObject({ name: 'Renamed', username: `renamed_${suffix}` });
    // Each login replaces the stored refresh token, so carry on with this session's tokens.
    const relogin = await http()
      .post('/auth/login')
      .send({ identifier: `renamed_${suffix}`, password })
      .expect(201);
    accessToken = relogin.body.accessToken;
    refreshToken = relogin.body.refreshToken;

    await http().patch('/auth/me').set('Authorization', `Bearer ${accessToken}`).send({}).expect(200);
  });

  it('rotates refresh tokens and rejects the old one', async () => {
    const res = await http().post('/auth/refresh').send({ refreshToken }).expect(201);
    expect(res.body.refreshToken).not.toBe(refreshToken);
    await http().post('/auth/refresh').send({ refreshToken }).expect(401);
    refreshToken = res.body.refreshToken;
  });

  it('keeps "remember me" lifetime across refresh', async () => {
    const login = await http()
      .post('/auth/login')
      .send({ identifier: phone, password, rememberMe: true })
      .expect(201);
    const refreshed = await http()
      .post('/auth/refresh')
      .send({ refreshToken: login.body.refreshToken })
      .expect(201);
    const ttlDays = (token: string) => {
      const { iat, exp } = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
      return (exp - iat) / 86400;
    };
    expect(ttlDays(refreshed.body.refreshToken)).toBe(90);
    refreshToken = refreshed.body.refreshToken;
    accessToken = refreshed.body.accessToken;
  });

  it('logs out and revokes the refresh token', async () => {
    await http().post('/auth/logout').set('Authorization', `Bearer ${accessToken}`).expect(201);
    await http().post('/auth/refresh').send({ refreshToken }).expect(401);
  });

  it('logs in with phone OTP', async () => {
    await http().post('/auth/otp/request').send({ phone }).expect(201);
    const code = sentCodes.get(phone)!;
    await http().post('/auth/otp/login').send({ phone, code: '000000' }).expect(400);
    await http().post('/auth/otp/login').send({ phone, code }).expect(201);
  });

  // Pretend the current code was sent over a minute ago, so the 60 s resend cooldown has passed.
  const skipCooldown = (id: string, ttlMinutes = 10) =>
    users.update(id, { otpExpiresAt: new Date(Date.now() + ttlMinutes * 60_000 - 61_000) });

  it('resends a lost signup code (60 s cooldown) and verifies by email instead of userId', async () => {
    const resendEmail = `e2e.resend.${suffix}@example.com`;
    const signup = await http()
      .post('/auth/signup')
      .send({ email: resendEmail, username: `resend_${suffix}`, password, name: 'Resend' })
      .expect(201);
    const firstCode = sentCodes.get(resendEmail)!;

    const before = sendCount;
    const res = await http().post('/auth/resend-verification').send({ email: resendEmail }).expect(201);
    expect(res.body.message).toMatch(/new code has been sent/);
    expect(sendCount).toBe(before); // within the cooldown: nothing sent

    await skipCooldown(signup.body.userId);
    await http().post('/auth/resend-verification').send({ email: resendEmail }).expect(201);
    expect(sendCount).toBe(before + 1);
    const newCode = sentCodes.get(resendEmail)!;

    if (newCode !== firstCode) {
      await http().post('/auth/verify').send({ email: resendEmail, code: firstCode }).expect(400); // replaced
    }
    await http().post('/auth/verify').send({ email: resendEmail.toUpperCase(), code: newCode }).expect(201);

    // Verified accounts and unknown accounts get the same answer, and nothing is sent.
    const count = sendCount;
    await http().post('/auth/resend-verification').send({ email: resendEmail }).expect(201);
    await http().post('/auth/resend-verification').send({ email: `e2e.nobody.${suffix}@example.com` }).expect(201);
    expect(sendCount).toBe(count);
  });

  it('cancels a signup code after 5 wrong attempts', async () => {
    const lockEmail = `e2e.lock.${suffix}@example.com`;
    await http()
      .post('/auth/signup')
      .send({ email: lockEmail, username: `lock_${suffix}`, password, name: 'Lock' })
      .expect(201);
    const code = sentCodes.get(lockEmail)!;
    const wrong = code === '111111' ? '222222' : '111111';

    for (let i = 0; i < 4; i++) {
      await http().post('/auth/verify').send({ email: lockEmail, code: wrong }).expect(400);
    }
    const locked = await http().post('/auth/verify').send({ email: lockEmail, code: wrong }).expect(429);
    expect(locked.body.message).toMatch(/too many/i);
    await http().post('/auth/verify').send({ email: lockEmail, code }).expect(400); // the right code no longer works

    await http().post('/auth/resend-verification').send({ email: lockEmail }).expect(201);
    await http().post('/auth/verify').send({ email: lockEmail, code: sentCodes.get(lockEmail) }).expect(201);
  });

  it('cancels a password reset code after 5 wrong attempts', async () => {
    await http().post('/auth/forgot-password').send({ email }).expect(201);
    const code = sentCodes.get(email.toLowerCase())!;
    const wrong = code === '111111' ? '222222' : '111111';
    const newPassword = 'N3w!Stronger';
    for (let i = 0; i < 4; i++) {
      await http().post('/auth/reset-password').send({ email, code: wrong, newPassword }).expect(400);
    }
    await http().post('/auth/reset-password').send({ email, code: wrong, newPassword }).expect(429);
    await http().post('/auth/reset-password').send({ email, code, newPassword }).expect(400);
  });

  it('resets a forgotten password, enforcing strength on the new one', async () => {
    await http().post('/auth/forgot-password').send({ email }).expect(201);
    const code = sentCodes.get(email.toLowerCase())!;
    await http()
      .post('/auth/reset-password')
      .send({ email, code, newPassword: 'weakpass' })
      .expect(400);
    const newPassword = 'N3w!Stronger';
    await http().post('/auth/reset-password').send({ email, code, newPassword }).expect(201);
    await http().post('/auth/login').send({ identifier: email, password }).expect(401);
    await http().post('/auth/login').send({ identifier: email, password: newPassword }).expect(201);
  });
});
