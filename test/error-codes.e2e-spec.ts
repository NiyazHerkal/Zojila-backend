import { randomUUID } from 'node:crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import { In, Repository } from 'typeorm';
import { AppModule } from './../src/app.module.js';
import { User } from './../src/database/entities/index.js';
import { OtpDeliveryService } from './../src/notifications/otp-delivery.service.js';

// Stable error codes (backend handover 2026-10-22, P-10): every error body has a `code`, and the
// rest of the body is unchanged.
describe('Error codes (e2e)', () => {
  let app: INestApplication;
  let users: Repository<User>;
  const otpCodes = new Map<string, string>();
  const suffix = randomUUID().slice(0, 8);
  const userIds: string[] = [];
  const password = 'Str0ng!Pass';
  const email = `codes-e2e.${suffix}@example.com`;
  let token: string;
  let refreshToken: string;

  const http = () => request(app.getHttpServer());

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
    await app.init();
    users = moduleFixture.get(getRepositoryToken(User));
  });

  afterAll(async () => {
    if (userIds.length) await users.delete({ id: In(userIds) });
    await app.close();
  });

  it('marks validation errors, keeping the usual body', async () => {
    const res = await http().post('/auth/signup').send({ email: 'not-an-email' }).expect(400);
    expect(res.body).toMatchObject({ statusCode: 400, error: 'Bad Request', code: 'VALIDATION_FAILED' });
    expect(Array.isArray(res.body.message)).toBe(true);
  });

  it('gives auth failures their own codes', async () => {
    const signup = await http()
      .post('/auth/signup')
      .send({ email, username: `codes_${suffix}`, password, name: 'E2E codes' })
      .expect(201);
    userIds.push(signup.body.userId);

    const unverified = await http().post('/auth/login').send({ identifier: email, password }).expect(401);
    expect(unverified.body).toEqual({
      statusCode: 401,
      message: 'Account not verified',
      error: 'Unauthorized',
      code: 'ACCOUNT_NOT_VERIFIED',
    });
    const wrongCode = await http().post('/auth/verify').send({ userId: signup.body.userId, code: '000000' }).expect(400);
    expect(wrongCode.body.code).toBe('INVALID_CODE');

    const verified = await http()
      .post('/auth/verify')
      .send({ userId: signup.body.userId, code: otpCodes.get(email) })
      .expect(201);
    token = verified.body.accessToken;
    refreshToken = verified.body.refreshToken;

    const wrong = await http().post('/auth/login').send({ identifier: email, password: 'Wr0ng!Pass' }).expect(401);
    expect(wrong.body.code).toBe('INVALID_CREDENTIALS');
    const taken = await http()
      .post('/auth/signup')
      .send({ email: `other.${email}`, username: `codes_${suffix}`, password, name: 'x' })
      .expect(409);
    expect(taken.body.code).toBe('USERNAME_TAKEN');

    await http().post('/auth/refresh').send({ refreshToken }).expect(201);
    const reused = await http().post('/auth/refresh').send({ refreshToken }).expect(401);
    expect(reused.body.code).toMatch(/^REFRESH_TOKEN_(REVOKED|INVALID)$/);
    const garbage = await http().post('/auth/refresh').send({ refreshToken: 'not-a-token' }).expect(401);
    expect(garbage.body.code).toBe('REFRESH_TOKEN_INVALID');
  });

  it('falls back to a code per status (guards and plain string errors too)', async () => {
    const noToken = await http().get('/auth/me').expect(401);
    expect(noToken.body).toMatchObject({ statusCode: 401, code: 'UNAUTHORIZED' });

    const auth = { Authorization: `Bearer ${token}` };
    const missing = await http().get(`/groups/${randomUUID()}`).set(auth).expect(404);
    expect(missing.body.code).toBe('NOT_FOUND');
    const notFoundRoute = await http().get('/no-such-route').expect(404);
    expect(notFoundRoute.body.code).toBe('NOT_FOUND');
  });

  it('marks a stale itinerary draft', async () => {
    const auth = { Authorization: `Bearer ${token}` };
    const group = await http()
      .post('/groups')
      .set(auth)
      .send({ name: 'Codes trip', description: 'd', tripStart: '2026-10-10T00:00:00Z', tripEnd: '2026-10-19T00:00:00Z' })
      .expect(201);
    await http().post(`/groups/${group.body.id}/itinerary/draft`).set(auth).expect(201);
    const stale = await http()
      .post(`/groups/${group.body.id}/itinerary/draft/finalize`)
      .set({ ...auth, 'If-Match': '99' })
      .expect(412);
    expect(stale.body.code).toBe('DRAFT_CHANGED');
    expect(stale.body.message).toMatch('The draft has changed');
    await http().delete(`/groups/${group.body.id}`).set(auth).expect(200);
  });
});
