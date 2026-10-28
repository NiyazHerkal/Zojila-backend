import { randomUUID } from 'node:crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import type { Redis } from 'ioredis';
import request from 'supertest';
import { In, Repository } from 'typeorm';
import { AppModule } from './../src/app.module.js';
import { User } from './../src/database/entities/index.js';
import { OtpDeliveryService } from './../src/notifications/otp-delivery.service.js';
import { GeocodingProvider, type FoundPlace, type PlaceDetails } from './../src/places/geocoding.provider.js';
import { REDIS } from './../src/redis/redis.module.js';

// Place search by name (backend handover 2026-10-22, P-06). The provider is faked; the real
// Nominatim is a public server with a strict usage policy, so it is checked by hand only.
describe('Place search (e2e)', () => {
  let app: INestApplication;
  let users: Repository<User>;
  const otpCodes = new Map<string, string>();
  const calls: { query: string; near: { lat: number; lng: number } | null; limit: number }[] = [];
  let fail: string | null = null;
  let configured = true;
  let redisReady = false;
  let token: string;
  let userId: string;
  const suffix = randomUUID().slice(0, 8);

  const airport: FoundPlace = {
    providerPlaceId: 'osm:way/26976402',
    name: 'Dabolim Airport',
    address: 'Dabolim Airport, Dabolim, South Goa, Goa, India',
    lat: 15.3808,
    lng: 73.8314,
    category: 'aeroway',
    type: 'aerodrome',
  };
  const details: PlaceDetails = {
    ...airport,
    openingHours: '24/7',
    phone: '+91 832 254 0806',
    website: null,
    email: null,
    cuisine: null,
    brand: null,
  };
  const detailCalls: string[] = [];
  const fake: GeocodingProvider = {
    name: 'fake-nominatim',
    attribution: '© OpenStreetMap contributors',
    get configured() {
      return configured;
    },
    search: async (query, near, limit) => {
      calls.push({ query, near, limit });
      if (fail) throw new Error(fail);
      return query.includes('nowhere') ? [] : [airport];
    },
    details: async (id) => {
      detailCalls.push(id);
      if (fail) throw new Error(fail);
      return id === airport.providerPlaceId ? details : null;
    },
  };

  const http = () => request(app.getHttpServer());
  const get = (path: string) => http().get(path).set({ Authorization: `Bearer ${token}` });

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(OtpDeliveryService)
      .useValue({
        sendEmail: async (to: string, code: string) => void otpCodes.set(to, code),
        sendSms: async (to: string, code: string) => void otpCodes.set(to, code),
      })
      .overrideProvider(GeocodingProvider)
      .useValue(fake)
      .compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    users = moduleFixture.get(getRepositoryToken(User));
    const redis = moduleFixture.get<Redis>(REDIS);
    for (let i = 0; redis.status !== 'ready' && i < 20; i++) await new Promise((r) => setTimeout(r, 100));
    redisReady = redis.status === 'ready';
    if (redisReady) {
      const keys = [
        ...(await redis.keys('travelgo:place-search:fake-nominatim:*')),
        ...(await redis.keys('travelgo:place-details:fake-nominatim:*')),
      ];
      if (keys.length) await redis.del(...keys);
    }

    const email = `search-e2e.${suffix}@example.com`;
    const signup = await http()
      .post('/auth/signup')
      .send({ email, username: `search_${suffix}`, password: 'Str0ng!Pass', name: 'E2E search' })
      .expect(201);
    userId = signup.body.userId;
    token = (await http().post('/auth/verify').send({ userId, code: otpCodes.get(email) }).expect(201)).body.accessToken;
  });

  afterAll(async () => {
    if (userId) await users.delete({ id: In([userId]) });
    await app.close();
  });

  it('validates the query and needs sign-in', async () => {
    await http().get('/places/search?q=goa').expect(401);
    await get('/places/search').expect(400);
    await get('/places/search?q=%20a%20').expect(400); // one letter after trimming
    await get('/places/search?q=goa&lat=15.3').expect(400); // half a point
    await get('/places/search?q=goa&limit=21').expect(400);
  });

  it('returns real places with ids that can be saved, and distances when near a point', async () => {
    const res = await get('/places/search?q=Goa%20%20airport&lat=15.312&lng=73.94&limit=5').expect(200);
    expect(res.body).toMatchObject({ query: 'Goa airport', source: 'fake-nominatim', attribution: '© OpenStreetMap contributors' });
    expect(res.body.results).toEqual([{ ...airport, distanceMeters: expect.any(Number) }]);
    expect(res.body.results[0].distanceMeters).toBeGreaterThan(10_000);
    expect(calls.at(-1)).toEqual({ query: 'Goa airport', near: { lat: 15.3, lng: 73.9 }, limit: 5 });

    // The saved-places endpoint takes a result as it is.
    const saved = await http()
      .post('/me/saved-places')
      .set({ Authorization: `Bearer ${token}` })
      .send({ providerPlaceId: airport.providerPlaceId, name: airport.name, lat: airport.lat, lng: airport.lng, address: airport.address })
      .expect(201);
    expect(saved.body.source).toBe('PROVIDER');

    const plain = await get('/places/search?q=goa%20airport').expect(200);
    expect(plain.body.results[0].distanceMeters).toBeNull();
  });

  it('returns an empty list for no match, and 429 / 503 when the provider is busy or down', async () => {
    expect((await get(`/places/search?q=nowhere-${suffix}`).expect(200)).body.results).toEqual([]);

    fail = 'HTTP 429 from nominatim.openstreetmap.org';
    await get(`/places/search?q=busy-${suffix}`).expect(429);
    fail = 'timeout';
    const down = await get(`/places/search?q=down-${suffix}`).expect(503);
    expect(down.body.message).toMatch('temporarily unavailable');
    fail = null;

    configured = false;
    await get(`/places/search?q=off-${suffix}`).expect(503);
    configured = true;
  });

  it('gives one place’s details by its providerPlaceId, cached', async () => {
    await http().get(`/places/details?providerPlaceId=${airport.providerPlaceId}`).expect(401);
    await get('/places/details').expect(400);
    await get('/places/details?providerPlaceId=ola:abc').expect(400);
    await get('/places/details?providerPlaceId=osm:node/1x').expect(400);

    const id = encodeURIComponent(airport.providerPlaceId);
    const res = await get(`/places/details?providerPlaceId=${id}`).expect(200);
    expect(res.body).toEqual({ ...details, source: 'fake-nominatim', attribution: '© OpenStreetMap contributors' });
    const before = detailCalls.length;
    await get(`/places/details?providerPlaceId=${id}`).expect(200);
    if (redisReady) expect(detailCalls.length).toBe(before); // second time from the cache

    await get('/places/details?providerPlaceId=osm:node/1').expect(404);
    fail = 'HTTP 429 from nominatim.openstreetmap.org';
    await get('/places/details?providerPlaceId=osm:node/2').expect(429);
    fail = 'timeout';
    await get('/places/details?providerPlaceId=osm:node/3').expect(503);
    fail = null;
  });
});
