import { randomUUID } from 'node:crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import { In, Repository } from 'typeorm';
import { AppModule } from './../src/app.module.js';
import { User } from './../src/database/entities/index.js';
import { OtpDeliveryService } from './../src/notifications/otp-delivery.service.js';

// Server-side saved places (backend handover 2026-10-22, P-07).
describe('Saved places (e2e)', () => {
  let app: INestApplication;
  let users: Repository<User>;
  const otpCodes = new Map<string, string>();
  const suffix = randomUUID().slice(0, 8);
  const userIds: string[] = [];
  let alice: string; // tokens
  let bob: string;

  const http = () => request(app.getHttpServer());
  const as = (token: string) => ({ Authorization: `Bearer ${token}` });
  const cafe = { providerPlaceId: 'osm:node/795826239', name: 'Café 1947', lat: 32.2481, lng: 77.1836, category: 'cafe' };
  const pin = { name: 'Our campsite', lat: 32.123456, lng: 77.654321 };

  async function registerUser(label: string): Promise<string> {
    const email = `saved-e2e.${label}.${suffix}@example.com`;
    const signup = await http()
      .post('/auth/signup')
      .send({ email, username: `${label}_${suffix}`, password: 'Str0ng!Pass', name: `E2E ${label}` })
      .expect(201);
    const verified = await http()
      .post('/auth/verify')
      .send({ userId: signup.body.userId, code: otpCodes.get(email) })
      .expect(201);
    userIds.push(signup.body.userId);
    return verified.body.accessToken;
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
    await app.init();
    users = moduleFixture.get(getRepositoryToken(User));
    alice = await registerUser('alice');
    bob = await registerUser('bob');
  });

  afterAll(async () => {
    if (userIds.length) await users.delete({ id: In(userIds) });
    await app.close();
  });

  it('needs sign-in and valid input', async () => {
    await http().get('/me/saved-places').expect(401);
    await http().post('/me/saved-places').set(as(alice)).send({ ...pin, lat: 91 }).expect(400);
    await http().post('/me/saved-places').set(as(alice)).send({ ...pin, name: '  ' }).expect(400);
    await http().post('/me/saved-places').set(as(alice)).send({ name: 'x' }).expect(400);
  });

  it('saves provider places and pins once each, newest first', async () => {
    const first = await http().post('/me/saved-places').set(as(alice)).send(cafe).expect(201);
    expect(first.body).toMatchObject({ source: 'PROVIDER', providerPlaceId: cafe.providerPlaceId, name: 'Café 1947' });
    const again = await http().post('/me/saved-places').set(as(alice)).send({ ...cafe, name: 'Renamed' }).expect(200);
    expect(again.body.id).toBe(first.body.id);

    const dropped = await http().post('/me/saved-places').set(as(alice)).send(pin).expect(201);
    expect(dropped.body).toMatchObject({ source: 'PIN', providerPlaceId: null, address: null });
    // Within ~1 m of the same pin: the same place.
    await http()
      .post('/me/saved-places')
      .set(as(alice))
      .send({ ...pin, lat: 32.1234561 })
      .expect(200);

    const list = await http().get('/me/saved-places').set(as(alice)).expect(200);
    expect(list.body.items.map((p: { name: string }) => p.name)).toEqual(['Our campsite', 'Café 1947']);
  });

  it("keeps each user's places private", async () => {
    expect((await http().get('/me/saved-places').set(as(bob)).expect(200)).body.items).toEqual([]);
    const mine = (await http().get('/me/saved-places').set(as(alice)).expect(200)).body.items[0];
    await http().delete(`/me/saved-places/${mine.id}`).set(as(bob)).expect(404);

    // Bob can save the same place for himself.
    await http().post('/me/saved-places').set(as(bob)).send(cafe).expect(201);
  });

  it('removes a place for good, and includes saves in the data export', async () => {
    const [latest] = (await http().get('/me/saved-places').set(as(alice)).expect(200)).body.items;
    await http().delete(`/me/saved-places/${latest.id}`).set(as(alice)).expect(200);
    await http().delete(`/me/saved-places/${latest.id}`).set(as(alice)).expect(404);
    const after = await http().get('/me/saved-places').set(as(alice)).expect(200);
    expect(after.body.items.map((p: { name: string }) => p.name)).toEqual(['Café 1947']);

    const exported = await http().get('/auth/me/export').set(as(alice)).expect(200);
    expect(exported.body.savedPlaces).toEqual([expect.objectContaining({ name: 'Café 1947', source: 'PROVIDER' })]);
  });
});
