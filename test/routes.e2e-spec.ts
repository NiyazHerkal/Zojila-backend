import { randomUUID } from 'node:crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Redis } from 'ioredis';
import request from 'supertest';
import { In, Repository } from 'typeorm';
import { vi } from 'vitest';
import { AppModule } from './../src/app.module.js';
import { Group, User } from './../src/database/entities/index.js';
import { NoRoadRouteError, RoutingProvider, type RoutePoint } from './../src/enrichment/routing.provider.js';
import { LocationService } from './../src/location/location.service.js';
import { OtpDeliveryService } from './../src/notifications/otp-delivery.service.js';
import { REDIS } from './../src/redis/redis.module.js';

// Needs Redis (REDIS_URL, default localhost:6379) for live positions. Without it, only the
// "fails cleanly with 503" check runs.
async function redisIsUp(): Promise<boolean> {
  const probe = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
    lazyConnect: true,
    retryStrategy: () => null,
    connectTimeout: 1500,
    maxRetriesPerRequest: 0,
  });
  probe.on('error', () => undefined);
  try {
    await probe.connect();
    return (await probe.ping()) === 'PONG';
  } catch {
    return false;
  } finally {
    probe.disconnect();
  }
}
const REDIS_UP = await redisIsUp();

// Journey map member routes (backend handover 2026-10-22, P-05) with a fake router.
describe('Member routes (e2e)', () => {
  let app: INestApplication;
  let users: Repository<User>;
  let groups: Repository<Group>;
  let location: LocationService;
  const otpCodes = new Map<string, string>();

  const suffix = randomUUID().slice(0, 8);
  interface TestUser {
    id: string;
    username: string;
    token: string;
  }
  const userIds: string[] = [];
  let alice: TestUser; // admin, shares
  let bob: TestUser; // viewer, shares
  let dave: TestUser; // viewer, not sharing
  let carol: TestUser; // not a member
  let groupId: string;

  // Fake router: straight through a midpoint. "No road" to anything north of 34°.
  let routeCalls = 0;
  let routingDown = false;
  const routing: RoutingProvider = {
    configured: true,
    profile: 'driving',
    attribution: 'Routes: test',
    route: async ([a, b]: RoutePoint[]) => {
      routeCalls++;
      if (routingDown) throw new Error('timeout');
      if (a.lat > 34 || b.lat > 34) throw new NoRoadRouteError('no road');
      return {
        distanceMeters: 12_345.6,
        durationSeconds: 1_234.4,
        coordinates: [[a.lng, a.lat], [(a.lng + b.lng) / 2, (a.lat + b.lat) / 2], [b.lng, b.lat]],
        legs: [{ distanceMeters: 12_345.6, durationSeconds: 1_234.4 }],
      };
    },
  };

  const http = () => request(app.getHttpServer());
  const as = (u: TestUser) => ({ Authorization: `Bearer ${u.token}` });
  const g = (path: string) => `/groups/${groupId}${path}`;

  async function registerUser(label: string): Promise<TestUser> {
    const email = `routes-e2e.${label}.${suffix}@example.com`;
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

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(OtpDeliveryService)
      .useValue({
        sendEmail: async (to: string, code: string) => void otpCodes.set(to, code),
        sendSms: async (to: string, code: string) => void otpCodes.set(to, code),
      })
      .overrideProvider(RoutingProvider)
      .useValue(routing)
      .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    users = moduleFixture.get(getRepositoryToken(User));
    groups = moduleFixture.get(getRepositoryToken(Group));
    location = moduleFixture.get(LocationService);
    // Start from a cold route cache (it lives in Redis and outlives a test run).
    const redis = moduleFixture.get<Redis>(REDIS);
    for (let i = 0; REDIS_UP && redis.status !== 'ready' && i < 20; i++) await new Promise((r) => setTimeout(r, 100));
    if (redis.status === 'ready') {
      const keys = await redis.keys('travelgo:road:*');
      if (keys.length) await redis.del(...keys);
    }

    alice = await registerUser('alice');
    bob = await registerUser('bob');
    dave = await registerUser('dave');
    carol = await registerUser('carol');
    const group = await http()
      .post('/groups')
      .set(as(alice))
      .send({ name: 'Spiti Loop', description: 'd', tripStart: '2026-10-10T00:00:00Z', tripEnd: '2026-10-19T00:00:00Z' })
      .expect(201);
    groupId = group.body.id;
    for (const u of [bob, dave]) {
      await http().post(g('/members')).set(as(alice)).send({ username: u.username }).expect(201);
    }
    for (let i = 0; REDIS_UP && i < 40 && (await http().get(g('/location')).set(as(alice))).status === 503; i++) {
      await new Promise((r) => setTimeout(r, 100));
    }
  });

  afterAll(async () => {
    if (userIds.length) {
      await groups.delete({ createdById: In(userIds) });
      await users.delete({ id: In(userIds) });
    }
    await app.close();
  });

  it('validates the request and is members-only', async () => {
    const ids = (...list: string[]) => `?userIds=${list.join(',')}`;
    await http().get(g(`/routes/members${ids(alice.id)}`)).set(as(alice)).expect(400);
    await http().get(g(`/routes/members${ids(alice.id, alice.id)}`)).set(as(alice)).expect(400);
    await http().get(g(`/routes/members${ids(alice.id, 'nope')}`)).set(as(alice)).expect(400);
    const seven = Array.from({ length: 7 }, () => randomUUID());
    await http().get(g(`/routes/members${ids(...seven)}`)).set(as(alice)).expect(400);
    await http().get(g(`/routes/members${ids(alice.id, bob.id)}`)).set(as(carol)).expect(404);

    const p2p = g('/routes/point-to-point?fromLat=32.2&fromLng=77.1');
    await http().get(p2p).set(as(alice)).expect(400); // no destination
    await http().get(`${p2p}&toLat=32.3`).set(as(alice)).expect(400); // half a point
    await http().get(`${p2p}&toLat=32.3&toLng=77.2&toUserId=${bob.id}`).set(as(alice)).expect(400); // both
    await http().get(g('/routes/point-to-point?fromLat=99&fromLng=77.1&toLat=32.3&toLng=77.2')).set(as(alice)).expect(400);
  });

  it('routes between fixed points, with no line when there is no road or the router is down', async () => {
    const p2p = (from: string, to: string) => g(`/routes/point-to-point?${from}&${to}`);
    const ok = await http().get(p2p('fromLat=32.2&fromLng=77.1', 'toLat=32.3&toLng=77.2')).set(as(bob)).expect(200);
    expect(ok.body).toMatchObject({
      status: 'OK',
      profile: 'driving',
      distanceMeters: 12_346,
      durationSeconds: 1_234,
      attribution: 'Routes: test',
    });
    expect(ok.body.geometry.coordinates).toEqual([[77.1, 32.2], [77.15, 32.25], [77.2, 32.3]]);

    const noRoad = await http().get(p2p('fromLat=32.2&fromLng=77.1', 'toLat=34.2&toLng=77.6')).set(as(bob)).expect(200);
    expect(noRoad.body).toMatchObject({ status: 'NO_ROUTE', geometry: null, distanceMeters: null, durationSeconds: null });

    routingDown = true;
    const down = await http().get(p2p('fromLat=31.2&fromLng=77.1', 'toLat=31.3&toLng=77.2')).set(as(bob)).expect(200);
    expect(down.body).toMatchObject({ status: 'UNAVAILABLE', geometry: null, distanceMeters: null });
    routingDown = false;
    // A failure isn't cached: the next ask routes for real.
    const back = await http().get(p2p('fromLat=31.2&fromLng=77.1', 'toLat=31.3&toLng=77.2')).set(as(bob)).expect(200);
    expect(back.body.status).toBe('OK');
  });

  it.runIf(!REDIS_UP)('fails cleanly with 503 when Redis is down', async () => {
    await http().get(g(`/routes/members?userIds=${alice.id},${bob.id}`)).set(as(alice)).expect(503);
  });

  describe.runIf(REDIS_UP)('with Redis', () => {
    beforeAll(async () => {
      for (const [u, lat, lng] of [
        [alice, 32.2432, 77.1892],
        [bob, 32.5715, 77.0326],
      ] as const) {
        await http().put(g('/location/share')).set(as(u)).send({ duration: 'ONE_HOUR' }).expect(200);
        await http().post(g('/location')).set(as(u)).send({ points: [{ lat, lng, accuracy: 10 }] }).expect(201);
      }
    });

    afterAll(async () => {
      for (const u of [alice, bob]) await http().delete(g('/location/share')).set(as(u));
    });

    it('routes every pair of sharing members, and leaves out anyone without a live position', async () => {
      const before = routeCalls;
      const res = await http()
        .get(g(`/routes/members?userIds=${alice.id},${bob.id},${dave.id}`))
        .set(as(dave))
        .expect(200);
      expect(res.body.members).toEqual([
        { userId: alice.id, locationAvailable: true, recordedAt: expect.any(String) },
        { userId: bob.id, locationAvailable: true, recordedAt: expect.any(String) },
        { userId: dave.id, locationAvailable: false, recordedAt: null },
      ]);
      const pairs = res.body.routes.map((r: { fromUserId: string; toUserId: string; status: string }) => [
        r.fromUserId,
        r.toUserId,
        r.status,
      ]);
      expect(pairs).toEqual([
        [alice.id, bob.id, 'OK'],
        [alice.id, dave.id, 'LOCATION_UNAVAILABLE'],
        [bob.id, dave.id, 'LOCATION_UNAVAILABLE'],
      ]);
      expect(res.body.routes[0].geometry.coordinates[0]).toEqual([77.1892, 32.2432]);
      expect(res.body.routes[1]).toMatchObject({ geometry: null, distanceMeters: null });
      expect(routeCalls - before).toBe(1);

      // Same positions again: served from the cache.
      await http().get(g(`/routes/members?userIds=${alice.id},${bob.id}`)).set(as(alice)).expect(200);
      expect(routeCalls - before).toBe(1);
    });

    it("never routes to a non-member, or to a member's position that is too old", async () => {
      const toCarol = await http()
        .get(g(`/routes/point-to-point?fromLat=32.2&fromLng=77.1&toUserId=${carol.id}`))
        .set(as(alice))
        .expect(200);
      expect(toCarol.body).toMatchObject({ status: 'LOCATION_UNAVAILABLE', geometry: null });

      const toBob = await http()
        .get(g(`/routes/point-to-point?fromLat=32.2&fromLng=77.1&toUserId=${bob.id}`))
        .set(as(alice))
        .expect(200);
      expect(toBob.body.status).toBe('OK');

      const old = new Date(Date.now() - 16 * 60_000).toISOString();
      const spy = vi
        .spyOn(location, 'livePosition')
        .mockResolvedValue({ lat: 32.5, lng: 77.0, accuracy: 5, heading: null, speed: null, recordedAt: old });
      try {
        const stale = await http()
          .get(g(`/routes/point-to-point?fromLat=32.2&fromLng=77.1&toUserId=${bob.id}`))
          .set(as(alice))
          .expect(200);
        expect(stale.body.status).toBe('LOCATION_UNAVAILABLE');
      } finally {
        spy.mockRestore();
      }
    });
  });
});
