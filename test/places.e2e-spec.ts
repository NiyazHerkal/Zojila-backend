import { randomUUID } from 'node:crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import { In, Repository } from 'typeorm';
import { AppModule } from './../src/app.module.js';
import { User } from './../src/database/entities/index.js';
import { OtpDeliveryService } from './../src/notifications/otp-delivery.service.js';
import { REDIS } from './../src/redis/redis.module.js';
import type { Redis } from 'ioredis';
import { PlaceCategory, PlacesProvider, type RawPlace } from './../src/places/places.provider.js';

// Change request v1.0, change 1: homepage quick actions (fuel stations, restaurants, garages).
// The OpenStreetMap source is faked; the real one is checked by hand (it's a public server).
describe('Nearby places (e2e)', () => {
  let app: INestApplication;
  let users: Repository<User>;
  const otpCodes = new Map<string, string>();
  const calls: { category: PlaceCategory; radius: number }[] = [];
  let failNext = false;
  let token: string;
  let userId: string;
  const suffix = randomUUID().slice(0, 8);

  const place = (id: string, kind: string, lat: number, lng: number, name: string | null = id): RawPlace => ({
    id,
    name,
    kind,
    lat,
    lng,
    address: null,
    openingHours: id === 'far' ? null : 'Mo-Su 06:00-22:00',
    phone: null,
    website: null,
    brand: null,
  });
  const fake: PlacesProvider = {
    name: 'fake-osm',
    attribution: '© OpenStreetMap contributors',
    nearby: async (category, _lat, _lng, radius) => {
      calls.push({ category, radius });
      if (failNext) {
        failNext = false;
        throw new Error('HTTP 429');
      }
      // Manali bus stand ≈ (32.2432, 77.1892). ~1.1 km, ~0.3 km, and ~8 km away.
      return [place('mid', 'fuel', 32.2532, 77.1892), place('near', 'fuel', 32.2459, 77.1892), place('far', 'fuel', 32.3152, 77.1892)];
    },
  };

  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(OtpDeliveryService)
      .useValue({
        sendEmail: async (to: string, code: string) => void otpCodes.set(to, code),
        sendSms: async (to: string, code: string) => void otpCodes.set(to, code),
      })
      .overrideProvider(PlacesProvider)
      .useValue(fake)
      .compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    users = moduleFixture.get(getRepositoryToken(User));
    // Start from a cold cache so the provider calls below are predictable (best-effort: Redis is optional).
    const redis = moduleFixture.get<Redis>(REDIS);
    for (let i = 0; redis.status !== 'ready' && i < 20; i++) await new Promise((r) => setTimeout(r, 100));
    if (redis.status === 'ready') {
      const keys = await redis.keys('travelgo:places:fake-osm:*');
      if (keys.length) await redis.del(...keys);
    }

    const email = `places-e2e.${suffix}@example.com`;
    const signup = await http()
      .post('/auth/signup')
      .send({ email, username: `places_${suffix}`, password: 'Str0ng!Pass', name: 'E2E places' })
      .expect(201);
    userId = signup.body.userId;
    token = (await http().post('/auth/verify').send({ userId, code: otpCodes.get(email) }).expect(201)).body.accessToken;
  });

  afterAll(async () => {
    if (userId) await users.delete({ id: In([userId]) });
    await app.close();
  });

  const get = (path: string) => http().get(path).set({ Authorization: `Bearer ${token}` });

  it('returns places within the radius, nearest first, with distances', async () => {
    // A position nobody else uses, so the cache is cold.
    const lat = 32.2432;
    const lng = 77.1892;
    const res = await get(`/location/fuel-stations?lat=${lat}&lng=${lng}`).expect(200);
    expect(res.body).toMatchObject({ category: 'FUEL', radiusMeters: 5000, source: 'fake-osm', attribution: '© OpenStreetMap contributors' });
    expect(res.body.places.map((p: { id: string }) => p.id)).toEqual(['near', 'mid']); // 'far' is outside 5 km
    expect(res.body.places[0]).toMatchObject({ name: 'near', category: 'FUEL', openingHours: 'Mo-Su 06:00-22:00' });
    expect(res.body.places[0].distanceMeters).toBeGreaterThan(250);
    expect(res.body.places[0].distanceMeters).toBeLessThan(350);
    expect(calls.at(-1)).toEqual({ category: 'FUEL', radius: 5200 }); // asks a little wider for the cache

    const wide = await get(`/location/fuel-stations?lat=${lat}&lng=${lng}&radius=10000&limit=1`).expect(200);
    expect(wide.body.places.map((p: { id: string }) => p.id)).toEqual(['near']);
  });

  it('has the restaurants and garages routes, and validates the query', async () => {
    expect((await get('/location/restaurants?lat=10.5&lng=20.5').expect(200)).body.category).toBe('RESTAURANT');
    expect((await get('/location/garages?lat=10.5&lng=20.5').expect(200)).body.category).toBe('GARAGE');
    await get('/location/garages?lat=91&lng=20').expect(400);
    await get('/location/garages?lng=20').expect(400);
    await get('/location/garages?lat=10&lng=20&radius=50000').expect(400);
    await http().get('/location/garages?lat=10&lng=20').expect(401);
  });

  it('answers 503 when the source fails', async () => {
    failNext = true;
    const res = await get(`/location/garages?lat=${-33 - Math.random()}&lng=151.2`).expect(503);
    expect(res.body.message).toMatch('temporarily unavailable');
  });
});
