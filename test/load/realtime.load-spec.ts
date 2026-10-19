import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Redis } from 'ioredis';
import { io, type Socket } from 'socket.io-client';
import request from 'supertest';
import { In, Repository } from 'typeorm';
import { AppModule } from '../../src/app.module.js';
import { Group, User } from '../../src/database/entities/index.js';
import { OtpDeliveryService } from '../../src/notifications/otp-delivery.service.js';
import { PushService } from '../../src/notifications/push.service.js';

/**
 * Load test for the realtime paths against the PDF §4 targets: chat delivered in < 2 s, and
 * location updates every 5–30 s (the app sends every 10 s; this sends faster to add load).
 *
 *   npm run test:load                       10 groups × 10 members, 30 s
 *   LOAD_GROUPS=30 LOAD_MEMBERS=10 LOAD_SECONDS=60 npm run test:load
 *
 * Runs against the real dev Postgres + Redis, in one process (server and simulated phones share
 * the machine, so the numbers are pessimistic). Cleans up its users and groups afterwards.
 * Results are printed and written to LOAD_RESULTS_FILE if set.
 */
const GROUPS = Number(process.env.LOAD_GROUPS) || 10;
const MEMBERS = Number(process.env.LOAD_MEMBERS) || 10;
const SECONDS = Number(process.env.LOAD_SECONDS) || 30;
const LOCATION_EVERY_MS = Number(process.env.LOAD_LOCATION_MS) || 2000;
const CHAT_EVERY_MS = Number(process.env.LOAD_CHAT_MS) || 5000;
const CHAT_TARGET_MS = 2000;

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

function stats(values: number[]) {
  if (!values.length) return { count: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const at = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
  return {
    count: sorted.length,
    p50: at(50),
    p95: at(95),
    p99: at(99),
    max: sorted[sorted.length - 1],
    mean: Math.round(sorted.reduce((s, v) => s + v, 0) / sorted.length),
  };
}

describe(`Realtime load: ${GROUPS} groups × ${MEMBERS} members, ${SECONDS} s`, () => {
  let app: INestApplication;
  let baseUrl: string;
  let users: Repository<User>;
  let groups: Repository<Group>;
  const otpCodes = new Map<string, string>();
  const userIds: string[] = [];
  const sockets: Socket[] = [];
  const suffix = randomUUID().slice(0, 6);
  let redisUp = false;

  const http = () => request(app.getHttpServer());
  // During the run, requests go through fetch (keep-alive connections, like a phone's HTTP client)
  // rather than supertest, which opens a new connection per request.
  const api = (path: string, token: string, method: string, body: unknown) =>
    fetch(`${baseUrl}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

  beforeAll(async () => {
    redisUp = await redisIsUp();
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(OtpDeliveryService)
      .useValue({
        sendEmail: async (to: string, code: string) => void otpCodes.set(to, code),
        sendSms: async (to: string, code: string) => void otpCodes.set(to, code),
      })
      .overrideProvider(PushService) // no FCM / [DEV PUSH] log noise
      .useValue({ sendToUsers: async () => undefined, sendToUser: async () => undefined })
      .compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.listen(0, '127.0.0.1');
    baseUrl = (await app.getUrl()).replace('[::1]', '127.0.0.1');
    users = moduleFixture.get(getRepositoryToken(User));
    groups = moduleFixture.get(getRepositoryToken(Group));
  }, 60_000);

  afterAll(async () => {
    sockets.forEach((s) => s.disconnect());
    if (userIds.length) {
      await groups.delete({ createdById: In(userIds) });
      await users.delete({ id: In(userIds) });
    }
    await app.close();
  });

  it('meets the chat target with every member sharing location', async () => {
    // --- set up groups, members and sockets ---
    const setupStart = Date.now();
    type Member = { id: string; token: string; socket: Socket; groupId: string };
    const all: Member[] = [];
    for (let g = 0; g < GROUPS; g++) {
      const members: { id: string; token: string; username: string }[] = [];
      for (let m = 0; m < MEMBERS; m++) {
        const label = `ld${suffix}g${g}m${m}`;
        const email = `load.${label}@example.com`;
        const signup = await http().post('/auth/signup').send({ email, username: label, password: 'Str0ng!Pass', name: label }).expect(201);
        const verified = await http().post('/auth/verify').send({ userId: signup.body.userId, code: otpCodes.get(email) }).expect(201);
        userIds.push(signup.body.userId);
        members.push({ id: signup.body.userId, token: verified.body.accessToken, username: label });
      }
      const auth = { Authorization: `Bearer ${members[0].token}` };
      const group = await http()
        .post('/groups')
        .set(auth)
        .send({ name: `Load ${g}`, description: 'load test', tripStart: '2026-10-10T00:00:00Z', tripEnd: '2026-10-19T00:00:00Z' })
        .expect(201);
      for (const m of members.slice(1)) {
        await http().post(`/groups/${group.body.id}/members`).set(auth).send({ username: m.username }).expect(201);
      }
      for (const m of members) {
        const socket = io(baseUrl, { auth: { token: m.token }, transports: ['websocket'], reconnection: false });
        sockets.push(socket);
        await new Promise((r) => socket.once('ready', r));
        all.push({ id: m.id, token: m.token, socket, groupId: group.body.id });
      }
    }
    if (redisUp) {
      for (let i = 0; i < all.length; i += 25) {
        const batch = all.slice(i, i + 25);
        const results = await Promise.all(batch.map((m) => api(`/groups/${m.groupId}/location/share`, m.token, 'PUT', { duration: 'ONE_HOUR' })));
        expect(results.map((r) => r.status)).toEqual(batch.map(() => 200));
      }
    }
    const setupSeconds = (Date.now() - setupStart) / 1000;

    // --- measure ---
    const chatLatency: number[] = [];
    const chatAck: number[] = [];
    const locationLatency: number[] = [];
    const locationPost: number[] = [];
    const errors: string[] = [];
    for (const m of all) {
      m.socket.on('chat:message', (msg: { body: string; sender: { userId: string } }) => {
        if (msg.sender.userId === m.id) return; // own echo
        const sentAt = Number(msg.body.split('|')[1]);
        if (sentAt) chatLatency.push(Date.now() - sentAt);
      });
      m.socket.on('location:updated', (loc: { userId: string; recordedAt: string }) => {
        if (loc.userId !== m.id) locationLatency.push(Date.now() - new Date(loc.recordedAt).getTime());
      });
    }

    const timers: NodeJS.Timeout[] = [];
    const deadline = Date.now() + SECONDS * 1000;
    for (const m of all) {
      const chat = async () => {
        const start = Date.now();
        const ack = await m.socket.timeout(10_000).emitWithAck('chat:send', { groupId: m.groupId, body: `load|${start}` }).catch((e: Error) => ({ ok: false, error: e.message }));
        if (ack.ok) chatAck.push(Date.now() - start);
        else errors.push(`chat: ${JSON.stringify(ack.error)}`);
      };
      const move = async () => {
        const start = Date.now();
        const res = await api(`/groups/${m.groupId}/location`, m.token, 'POST', {
          points: [{ lat: 32 + Math.random(), lng: 77 + Math.random(), recordedAt: new Date(start).toISOString() }],
        }).catch((e: Error) => ({ status: e.message }));
        if (res.status === 201) locationPost.push(Date.now() - start);
        else errors.push(`location: ${res.status}`);
      };
      // Spread the members out so they don't all fire on the same millisecond.
      timers.push(setTimeout(() => timers.push(setInterval(() => Date.now() < deadline && void chat(), CHAT_EVERY_MS)), Math.random() * CHAT_EVERY_MS));
      if (redisUp) {
        timers.push(setTimeout(() => timers.push(setInterval(() => Date.now() < deadline && void move(), LOCATION_EVERY_MS)), Math.random() * LOCATION_EVERY_MS));
      }
    }
    await new Promise((r) => setTimeout(r, SECONDS * 1000 + 3000)); // + time to drain
    timers.forEach((t) => clearInterval(t));

    const result = {
      scenario: {
        groups: GROUPS,
        membersPerGroup: MEMBERS,
        sockets: all.length,
        seconds: SECONDS,
        chatEveryMs: CHAT_EVERY_MS,
        locationEveryMs: redisUp ? LOCATION_EVERY_MS : 'skipped (Redis down)',
        setupSeconds,
      },
      chatDeliveryMs: stats(chatLatency),
      chatAckMs: stats(chatAck),
      locationDeliveryMs: stats(locationLatency),
      locationPostMs: stats(locationPost),
      errors: errors.length,
      sampleErrors: errors.slice(0, 5),
    };
    console.log(`LOAD RESULT ${JSON.stringify(result, null, 2)}`);
    if (process.env.LOAD_RESULTS_FILE) writeFileSync(process.env.LOAD_RESULTS_FILE, JSON.stringify(result, null, 2));

    expect(errors).toEqual([]);
    expect(chatLatency.length).toBeGreaterThan(0);
    expect(result.chatDeliveryMs.p95).toBeLessThan(CHAT_TARGET_MS);
  }, (SECONDS + 600) * 1000);
});
