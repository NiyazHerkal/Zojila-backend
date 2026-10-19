import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { io, type Socket } from 'socket.io-client';
import request from 'supertest';
import { In, Repository } from 'typeorm';
import { AppModule } from './../../src/app.module.js';
import { Feedback, Group, User } from './../../src/database/entities/index.js';
import { EmailService } from './../../src/notifications/email.service.js';
import { InviteDeliveryService } from './../../src/notifications/invite-delivery.service.js';
import { OtpDeliveryService } from './../../src/notifications/otp-delivery.service.js';
import { PushService, type PushMessage } from './../../src/notifications/push.service.js';
import { StorageService } from './../../src/storage/storage.service.js';

/**
 * Regenerates API_RESPONSES.md: walks the whole API in a realistic order (two demo users, Alice
 * the admin and Bob the member, plus Carol and Dave for invites, permissions and account
 * deletion) against the dev Postgres + Redis, and writes every request, response, socket ack,
 * socket event and push exactly as they happened.
 *
 * Run: `npm run capture:api-responses` (Redis must be running). Email/SMS delivery and push
 * sending are swapped for recorders, so nothing reaches real inboxes or phones; the OTP codes
 * and push payloads are captured instead. Nearby places call the real OpenStreetMap server.
 * The demo users and their data are deleted at the end.
 */

const OUT_FILE = 'API_RESPONSES.md';
const PASSWORD = 'Str0ng!Pass';

interface DemoUser {
  key: string;
  name: string;
  username: string;
  email: string;
  phone: string;
  id: string;
  token: string;
  refreshToken: string;
  socket?: Socket;
}

type Expect = 'ok' | 'fail' | 'any' | number;

interface CallOpts {
  as?: DemoUser;
  params?: Record<string, string>;
  query?: Record<string, string | number | boolean>;
  body?: unknown;
  fields?: Record<string, string>;
  file?: { data: Buffer; filename: string; contentType: string };
  headers?: Record<string, string>;
  binary?: boolean;
  text?: boolean;
  expect?: Expect;
  abbreviate?: boolean;
  note?: string;
}

const STATUS_TEXT: Record<number, string> = {
  200: 'OK',
  201: 'Created',
  204: 'No Content',
  304: 'Not Modified',
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  409: 'Conflict',
  410: 'Gone',
  412: 'Precondition Failed',
  413: 'Payload Too Large',
  415: 'Unsupported Media Type',
  429: 'Too Many Requests',
  503: 'Service Unavailable',
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Real JWTs are 200+ characters; shorten them so the examples stay readable.
function sanitize(value: unknown): unknown {
  if (typeof value === 'string') {
    return /^eyJ[\w-]+\.[\w-]+\.[\w-]+$/.test(value) ? `${value.slice(0, 24)}…(JWT, shortened)` : value;
  }
  if (Array.isArray(value)) return value.map(sanitize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, sanitize(v)]));
  }
  return value;
}

// Long lists (offline bundle, data export) keep their first item and say how many were left out.
function abbreviate(value: unknown, depth = 0): unknown {
  if (Array.isArray(value)) {
    const items = value.slice(0, 1).map((v) => abbreviate(v, depth + 1));
    return value.length > 1 ? [...items, `…${value.length - 1} more`] : items;
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, abbreviate(v, depth + 1)]));
  }
  return value;
}

const json = (value: unknown) => '```json\n' + JSON.stringify(sanitize(value), null, 2) + '\n```\n';

describe('API_RESPONSES.md capture', () => {
  let app: INestApplication;
  let baseUrl: string;
  let users: Repository<User>;
  let groups: Repository<Group>;
  let feedbackRepo: Repository<Feedback>;
  let storage: StorageService;

  const codes = new Map<string, string>(); // email/phone → latest code
  const pushes: { userId: string; message: PushMessage }[] = [];
  const delivered: string[] = []; // invite emails/SMS
  const sockets: Socket[] = [];
  const out: string[] = [];
  const toc: string[] = [];
  let step = 0;
  const createdUserIds: string[] = [];
  const nameOf = new Map<string, string>();

  const http = () => request(app.getHttpServer());

  // ---------------------------------------------------------------- recorder

  function section(title: string) {
    out.push(`## ${title}\n`);
    toc.push(`- [${title}](#${title.toLowerCase().replace(/[^a-z0-9 -]/g, '').replace(/ /g, '-')})`);
  }

  function heading(title: string) {
    step++;
    out.push(`### ${step}. ${title}\n`);
  }

  function block(label: string, value: unknown) {
    out.push(`**${label}**\n\n${json(value)}`);
  }

  async function recordPushes(before: number) {
    await sleep(150); // pushes are fire-and-forget
    for (const p of pushes.slice(before)) {
      block(`Push sent to ${nameOf.get(p.userId) ?? p.userId}`, p.message);
    }
  }

  async function call(title: string, method: 'get' | 'post' | 'put' | 'patch' | 'delete', template: string, opts: CallOpts = {}) {
    heading(title);
    let path = template;
    for (const [k, v] of Object.entries(opts.params ?? {})) path = path.replace(`:${k}`, encodeURIComponent(v));
    const qs = opts.query ? `?${new URLSearchParams(Object.entries(opts.query).map(([k, v]) => [k, String(v)])).toString()}` : '';
    out.push(`\`${method.toUpperCase()} ${template}${qs}\`${opts.as ? ' 🔒' : ''}\n`);
    if (opts.note) out.push(`${opts.note}\n`);

    let req = http()[method](path + qs);
    if (opts.as) req = req.set('Authorization', `Bearer ${opts.as.token}`);
    for (const [k, v] of Object.entries(opts.headers ?? {})) {
      req = req.set(k, v);
      out.push(`**Header** \`${k}: ${v}\`\n`);
    }
    if (opts.fields || opts.file) {
      const lines = Object.entries(opts.fields ?? {}).map(([k, v]) => `- \`${k}\`: \`${v}\``);
      if (opts.file) lines.push(`- \`file\`: ${opts.file.filename} (${opts.file.contentType}, ${opts.file.data.length} bytes)`);
      out.push(`**Request** (multipart/form-data)\n\n${lines.join('\n')}\n`);
      for (const [k, v] of Object.entries(opts.fields ?? {})) req = req.field(k, v);
      if (opts.file) req = req.attach('file', opts.file.data, { filename: opts.file.filename, contentType: opts.file.contentType });
    } else if (opts.body !== undefined) {
      out.push(`**Request**\n${json(opts.body)}`);
      req = req.send(opts.body as object);
    }
    if (opts.binary) req = req.buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });

    const before = pushes.length;
    const res = await req;
    const expected = opts.expect ?? 'ok';
    const ok = res.status < 400;
    if (expected === 'any') {
      // recorded as it came
    } else if ((expected === 'ok' && !ok) || (expected === 'fail' && ok) || (typeof expected === 'number' && res.status !== expected)) {
      throw new Error(`Step ${step} "${title}": expected ${expected}, got ${res.status} ${JSON.stringify(res.body)}`);
    }

    out.push(`**Response ${res.status} ${STATUS_TEXT[res.status] ?? ''}**\n`);
    const etag = res.headers.etag as string | undefined;
    // Only the API's own ETags (offline bundle), not the weak ones Express adds to every response.
    if (etag && !etag.startsWith('W/')) out.push(`Header \`ETag: ${etag}\`\n`);
    if (opts.binary) {
      const size = (res.body as Buffer).length;
      const disposition = res.headers['content-disposition'] ? `; Content-Disposition: ${res.headers['content-disposition']}` : '';
      out.push(`\`(binary, ${size} bytes) Content-Type: ${res.headers['content-type']}${disposition}\`\n`);
    } else if (opts.text) {
      out.push(`Header \`Content-Type: ${res.headers['content-type']}\`\n\n\`\`\`csv\n${res.text.replace(/^﻿/, '')}\`\`\`\n`);
    } else if (res.status === 304 || res.text === '' || res.text === undefined) {
      out.push('_(empty body)_\n');
    } else {
      out.push(json(opts.abbreviate ? abbreviate(res.body) : res.body));
    }
    await recordPushes(before);
    return res;
  }

  /** Waits for the next `event` on a socket (listener registered now, before the action). */
  function on(socket: Socket, event: string, match: (p: any) => boolean = () => true, timeoutMs = 4000) {
    return new Promise<any>((resolve, reject) => {
      const timer = setTimeout(() => {
        socket.off(event, handler);
        reject(new Error(`no "${event}" within ${timeoutMs} ms (step ${step})`));
      }, timeoutMs);
      const handler = (payload: unknown) => {
        if (!match(payload)) return;
        clearTimeout(timer);
        socket.off(event, handler);
        resolve(payload);
      };
      socket.on(event, handler);
    });
  }

  async function shown(promise: Promise<unknown>, event: string, receiver: string) {
    block(`Event \`${event}\` received by ${receiver}`, await promise);
  }

  async function emitStep(title: string, user: DemoUser, event: string, payload: unknown, expectOk = true) {
    heading(title);
    out.push(`\`emit ${event}\` 🔌 (sent by ${user.name.split(' ')[0]})\n`);
    out.push(`**Payload**\n${json(payload)}`);
    const before = pushes.length;
    const ack = (await user.socket!.timeout(5000).emitWithAck(event, payload)) as { ok: boolean; data?: any };
    if (ack.ok !== expectOk) throw new Error(`Step ${step} "${title}": ack ${JSON.stringify(ack)}`);
    block('Ack (reply)', ack);
    await recordPushes(before);
    return ack;
  }

  async function eventStep(title: string, event: string, receiver: string, promise: Promise<unknown>) {
    heading(title);
    out.push(`\`on ${event}\` 🔌 (received by ${receiver})\n`);
    out.push(json(await promise));
  }

  async function connect(user: DemoUser): Promise<unknown> {
    const socket = io(baseUrl, { auth: { token: user.token }, transports: ['websocket'], reconnection: false });
    sockets.push(socket);
    user.socket = socket;
    socket.on('disconnect', (reason) => console.log(`[capture] ${user.key}'s socket disconnected at step ${step}: ${reason}`));
    socket.on('session:expired', () => console.log(`[capture] ${user.key}'s session expired at step ${step}`));
    return new Promise((resolve) => socket.once('ready', resolve));
  }

  // ---------------------------------------------------------------- app

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(OtpDeliveryService)
      .useValue({
        sendEmail: async (to: string, code: string) => void codes.set(to, code),
        sendSms: async (to: string, code: string) => void codes.set(to, code),
      })
      .overrideProvider(InviteDeliveryService)
      .useValue({
        sendEmail: async (to: string, subject: string) => void delivered.push(`Email to ${to}: "${subject}"`),
        sendSms: async (to: string, text: string) => void delivered.push(`SMS to ${to}: "${text}"`),
      })
      .overrideProvider(EmailService)
      .useValue({ configured: false, send: async () => true, onModuleInit: () => undefined })
      .overrideProvider(PushService)
      .useValue({
        configured: false,
        sendToUser: async (userId: string, message: PushMessage) => void pushes.push({ userId, message }),
        sendToUsers: async (ids: string[], message: PushMessage) => void ids.forEach((userId) => pushes.push({ userId, message })),
      })
      .compile();

    app = moduleFixture.createNestApplication();
    app.enableCors();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.listen(0, '127.0.0.1');
    baseUrl = (await app.getUrl()).replace('[::1]', '127.0.0.1');
    users = moduleFixture.get(getRepositoryToken(User));
    groups = moduleFixture.get(getRepositoryToken(Group));
    feedbackRepo = moduleFixture.get(getRepositoryToken(Feedback));
    storage = moduleFixture.get(StorageService);

    const taken = await users.find({
      where: [
        { username: In(['demo_alice', 'demo_bob', 'demo_carol', 'demo_dave']) },
        { email: In(['demo.alice@example.com', 'demo.bob@example.com', 'demo.carol@example.com', 'demo.dave@example.com']) },
      ],
    });
    if (taken.length) throw new Error(`Demo accounts already exist (${taken.map((u) => u.username).join(', ')}); delete them first`);
    // Wait for the app's Redis client (live location needs it).
    for (let i = 0; i < 50 && (await http().get('/health')).body.redis !== 'connected'; i++) await sleep(100);
  });

  afterAll(async () => {
    sockets.forEach((s) => s.disconnect());
    if (createdUserIds.length) {
      const reports = await feedbackRepo.find({ where: { userId: In(createdUserIds) }, select: { id: true } });
      for (const r of reports) await storage.deletePrefix(`feedback/${r.id}`);
      await groups.delete({ createdById: In(createdUserIds) });
      await users.delete({ id: In(createdUserIds) });
    }
    await app?.close();
  });

  // ---------------------------------------------------------------- the walk

  it('walks the API and writes API_RESPONSES.md', async () => {
    const mk = (key: string, name: string, n: number): DemoUser => ({
      key,
      name,
      username: `demo_${key}`,
      email: `demo.${key}@example.com`,
      phone: `+9198123456${n}`,
      id: '',
      token: '',
      refreshToken: '',
    });
    const alice = mk('alice', 'Alice Rider', 11);
    const bob = mk('bob', 'Bob Kumar', 12);
    const carol = mk('carol', 'Carol Singh', 13);
    const dave = mk('dave', 'Dave Outsider', 14);

    async function signupAndVerify(u: DemoUser, record: boolean) {
      const body = { email: u.email, phone: u.phone, username: u.username, password: PASSWORD, name: u.name };
      const signup = record
        ? await call(`Signup (${u.name.split(' ')[0]})`, 'post', '/auth/signup', { body })
        : await http().post('/auth/signup').send(body).expect(201);
      u.id = signup.body.userId;
      createdUserIds.push(u.id);
      nameOf.set(u.id, u.name.split(' ')[0]);
      const verifyBody = { userId: u.id, code: codes.get(u.email) };
      const verified = record
        ? await call(`Verify (${u.name.split(' ')[0]})`, 'post', '/auth/verify', { body: verifyBody })
        : await http().post('/auth/verify').send(verifyBody).expect(201);
      u.token = verified.body.accessToken;
      u.refreshToken = verified.body.refreshToken;
    }

    // ============================================================ health
    section('Health');
    await call('Health check', 'get', '/health');

    // ============================================================ auth
    section('Auth — signup & verify');
    await call('Username available', 'get', '/auth/username-available', { query: { username: 'demo_alice' } });
    await call('Username breaks the rules', 'get', '/auth/username-available', { query: { username: 'x!' }, expect: 'fail' });
    await call('Signup with a weak password', 'post', '/auth/signup', {
      body: { email: alice.email, username: alice.username, password: 'password', name: alice.name },
      expect: 400,
    });
    const aliceSignup = await call('Signup (Alice)', 'post', '/auth/signup', {
      body: { email: alice.email, phone: alice.phone, username: alice.username, password: PASSWORD, name: alice.name },
    });
    alice.id = aliceSignup.body.userId;
    createdUserIds.push(alice.id);
    nameOf.set(alice.id, 'Alice');
    await call('Login before verifying', 'post', '/auth/login', { body: { identifier: alice.email, password: PASSWORD }, expect: 401 });
    await call('Verify with a wrong code', 'post', '/auth/verify', { body: { userId: alice.id, code: '000000' }, expect: 'fail' });
    const aliceVerified = await call('Verify (Alice)', 'post', '/auth/verify', { body: { userId: alice.id, code: codes.get(alice.email) } });
    alice.token = aliceVerified.body.accessToken;
    alice.refreshToken = aliceVerified.body.refreshToken;

    const bobSignup = await call('Signup (Bob)', 'post', '/auth/signup', {
      body: { email: bob.email, phone: bob.phone, username: bob.username, password: PASSWORD, name: bob.name },
    });
    bob.id = bobSignup.body.userId;
    createdUserIds.push(bob.id);
    nameOf.set(bob.id, 'Bob');
    const bobVerified = await call('Verify by email instead of userId (Bob)', 'post', '/auth/verify', {
      body: { email: bob.email, code: codes.get(bob.email) },
    });
    bob.token = bobVerified.body.accessToken;
    bob.refreshToken = bobVerified.body.refreshToken;
    await signupAndVerify(carol, false);
    await signupAndVerify(dave, false);
    await call('Resend the signup code (already verified: same generic answer, nothing sent)', 'post', '/auth/resend-verification', {
      body: { email: alice.email },
    });
    await call('Signup with a taken username', 'post', '/auth/signup', {
      body: { email: 'someone.else@example.com', username: alice.username, password: PASSWORD, name: 'Someone' },
      expect: 409,
    });

    section('Auth — login, profile, tokens');
    const login = await call('Login by username ("remember me")', 'post', '/auth/login', {
      body: { identifier: alice.username, password: PASSWORD, rememberMe: true },
    });
    alice.token = login.body.accessToken;
    alice.refreshToken = login.body.refreshToken;
    await call('Login with a wrong password', 'post', '/auth/login', { body: { identifier: alice.email, password: 'Wr0ng!Pass' }, expect: 401 });
    await call('Get my profile', 'get', '/auth/me', { as: alice });
    await call('Get my profile without a token', 'get', '/auth/me', { expect: 401 });
    await call('Update my profile', 'patch', '/auth/me', {
      as: alice,
      body: { name: 'Alice Rider', avatarUrl: 'https://example.com/avatars/alice.jpg' },
    });
    await call('Update to a taken username', 'patch', '/auth/me', { as: alice, body: { username: bob.username }, expect: 409 });
    const oldRefresh = alice.refreshToken;
    const refreshed = await call('Refresh tokens', 'post', '/auth/refresh', { body: { refreshToken: alice.refreshToken } });
    alice.token = refreshed.body.accessToken;
    alice.refreshToken = refreshed.body.refreshToken;
    await call('Refresh with an old (already used) token', 'post', '/auth/refresh', { body: { refreshToken: oldRefresh }, expect: 401 });

    section('Push notification devices');
    await call('Register a device', 'post', '/devices', { as: alice, body: { token: 'fcm-token-alice-pixel-7', platform: 'ANDROID' } });
    await call('Register the same device again (safe)', 'post', '/devices', { as: alice, body: { token: 'fcm-token-alice-pixel-7', platform: 'ANDROID' } });
    await call('Unknown platform', 'post', '/devices', { as: bob, body: { token: 'fcm-token-bob', platform: 'BLACKBERRY' }, expect: 400 });

    // ============================================================ socket
    section('Realtime socket — connect');
    heading('Alice connects');
    out.push("`io(baseUrl, { auth: { token: accessToken } })` → `on ready` 🔌\n");
    out.push(json(await connect(alice)));
    heading('Bob connects');
    out.push(json(await connect(bob)));
    await connect(carol);
    await connect(dave);
    out.push('_(Carol and Dave connect the same way.)_\n');

    // ============================================================ groups
    section('Groups');
    const group = await call('Create a group', 'post', '/groups', {
      as: alice,
      body: { name: 'Ladakh Ride 2026', description: 'Manali to Leh on bikes', tripStart: '2026-10-10T00:00:00.000Z', tripEnd: '2026-10-19T00:00:00.000Z' },
    });
    const groupId = group.body.id as string;
    const g = { groupId };
    await call('Create with a missing description', 'post', '/groups', {
      as: alice,
      body: { name: 'No description', tripStart: '2026-10-10T00:00:00.000Z', tripEnd: '2026-10-19T00:00:00.000Z' },
      expect: 400,
    });
    await call('Trip end before start', 'post', '/groups', {
      as: alice,
      body: { name: 'Backwards', description: 'd', tripStart: '2026-10-19T00:00:00.000Z', tripEnd: '2026-10-10T00:00:00.000Z' },
      expect: 400,
    });
    await call('List my groups', 'get', '/groups', { as: alice });
    await call('Get group details', 'get', '/groups/:groupId', { as: alice, params: g });
    await call('Get group details as a non-member', 'get', '/groups/:groupId', { as: dave, params: g, expect: 404 });
    const groupUpdated = on(alice.socket!, 'group:updated');
    await call('Edit group (admin)', 'patch', '/groups/:groupId', { as: alice, params: g, body: { description: 'Manali → Leh, 9 days', currency: 'INR' } });
    await shown(groupUpdated, 'group:updated', 'Alice (every member gets it)');

    section('Members');
    let ev = on(alice.socket!, 'member:joined');
    await call('Add a member by username', 'post', '/groups/:groupId/members', { as: alice, params: g, body: { username: bob.username } });
    await shown(ev, 'member:joined', 'Alice (and Bob)');
    await call('Add someone who is already a member', 'post', '/groups/:groupId/members', { as: alice, params: g, body: { username: bob.username }, expect: 409 });
    await call('Add an unknown user', 'post', '/groups/:groupId/members', { as: alice, params: g, body: { username: 'nobody_here' }, expect: 404 });
    await call('Send two identifiers', 'post', '/groups/:groupId/members', { as: alice, params: g, body: { username: bob.username, email: bob.email }, expect: 400 });
    await call('List members', 'get', '/groups/:groupId/members', { as: bob, params: g });
    await call('Edit group as a Viewer', 'patch', '/groups/:groupId', { as: bob, params: g, body: { name: 'Mine now' }, expect: 403 });
    await call('Demote the only admin', 'patch', '/groups/:groupId/members/:userId', {
      as: alice,
      params: { ...g, userId: alice.id },
      body: { role: 'VIEWER' },
      expect: 409,
    });
    ev = on(bob.socket!, 'member:role_changed');
    await call('Promote to ADMIN (several admins are fine)', 'patch', '/groups/:groupId/members/:userId', {
      as: alice,
      params: { ...g, userId: bob.id },
      body: { role: 'ADMIN' },
    });
    await shown(ev, 'member:role_changed', 'Bob');
    await call('Demote back to VIEWER', 'patch', '/groups/:groupId/members/:userId', { as: alice, params: { ...g, userId: bob.id }, body: { role: 'VIEWER' } });

    section('Trip cover image');
    const coverPng = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(120, 1)]);
    const coverJpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(120, 2)]);
    await call('Upload a cover image (admin)', 'post', '/groups/:groupId/cover-image', {
      as: alice,
      params: g,
      file: { data: coverPng, filename: 'cover.png', contentType: 'image/png' },
    });
    await call('Members see coverImageUrl on the group', 'get', '/groups/:groupId', { as: bob, params: g });
    await call('Download the cover image (send the Bearer header)', 'get', '/groups/:groupId/cover-image', { as: bob, params: g, binary: true });
    await call('Replace the cover image (new ?v= in the URL)', 'post', '/groups/:groupId/cover-image', {
      as: alice,
      params: g,
      file: { data: coverJpeg, filename: 'cover.jpg', contentType: 'image/jpeg' },
    });
    await call('Upload a cover as a Viewer', 'post', '/groups/:groupId/cover-image', {
      as: bob,
      params: g,
      file: { data: coverPng, filename: 'cover.png', contentType: 'image/png' },
      expect: 403,
    });
    await call('Cover that is not a JPEG/PNG/WebP', 'post', '/groups/:groupId/cover-image', {
      as: alice,
      params: g,
      file: { data: Buffer.from('%PDF-1.7\njust a document'), filename: 'cover.jpg', contentType: 'image/jpeg' },
      expect: 415,
    });
    await call('Upload without the file field', 'post', '/groups/:groupId/cover-image', { as: alice, params: g, expect: 400 });
    await call('Remove the cover image (admin)', 'delete', '/groups/:groupId/cover-image', { as: alice, params: g });
    await call('Download when there is no cover', 'get', '/groups/:groupId/cover-image', { as: bob, params: g, expect: 404 });
    await call('Upload it again (kept for the rest of the walkthrough)', 'post', '/groups/:groupId/cover-image', {
      as: alice,
      params: g,
      file: { data: coverPng, filename: 'cover.png', contentType: 'image/png' },
    });

    section('Profile picture');
    ev = on(bob.socket!, 'user:profile_updated');
    const avatar = await call('Upload my profile picture', 'post', '/auth/me/avatar', {
      as: alice,
      file: { data: coverJpeg, filename: 'me.jpg', contentType: 'image/jpeg' },
    });
    await shown(ev, 'user:profile_updated', 'Bob (shares a trip with Alice)');
    await call('Members see avatarUrl', 'get', '/groups/:groupId/members', { as: bob, params: g });
    await call('Download the picture (no token needed)', 'get', '/users/:userId/avatar', {
      params: { userId: alice.id },
      query: { v: new URL(avatar.body.avatarUrl).searchParams.get('v')! },
      binary: true,
    });
    await call('Upload a picture that is not a JPEG/PNG/WebP', 'post', '/auth/me/avatar', {
      as: bob,
      file: { data: Buffer.from('%PDF-1.7\njust a document'), filename: 'me.jpg', contentType: 'image/jpeg' },
      expect: 415,
    });
    await call('Upload a picture (Bob)', 'post', '/auth/me/avatar', {
      as: bob,
      file: { data: coverPng, filename: 'me.png', contentType: 'image/png' },
    });
    await call('Remove my profile picture (back to initials)', 'delete', '/auth/me/avatar', { as: bob });
    await call('Picture of someone without one', 'get', '/users/:userId/avatar', { params: { userId: bob.id }, expect: 404 });

    section('Invites — email / SMS');
    const invite = await call('Invite by email', 'post', '/groups/:groupId/invites', { as: alice, params: g, body: { channel: 'EMAIL', email: carol.email } });
    out.push(`_Delivered: ${delivered.at(-1)}_\n`);
    await call('Invite the same person again', 'post', '/groups/:groupId/invites', { as: alice, params: g, body: { channel: 'EMAIL', email: carol.email }, expect: 409 });
    await call('Email invite without an email', 'post', '/groups/:groupId/invites', { as: alice, params: g, body: { channel: 'EMAIL' }, expect: 400 });
    await call('List pending invites (admin)', 'get', '/groups/:groupId/invites', { as: alice, params: g });
    await call('My pending invitations (Carol)', 'get', '/invites', { as: carol });
    await call('Reject an invitation', 'post', '/invites/:inviteId/reject', { as: carol, params: { inviteId: invite.body.id } });
    await call('Accept an already-rejected invitation', 'post', '/invites/:inviteId/accept', { as: carol, params: { inviteId: invite.body.id }, expect: 409 });
    const sms = await call('Invite by SMS (someone not on TravelGo yet)', 'post', '/groups/:groupId/invites', {
      as: alice,
      params: g,
      body: { channel: 'SMS', phone: '+919800000099' },
    });
    out.push(`_Delivered: ${delivered.at(-1)}_\n`);
    await call('Revoke an invite (admin)', 'delete', '/groups/:groupId/invites/:inviteId', { as: alice, params: { ...g, inviteId: sms.body.id } });
    const invite2 = await call('Invite by email again', 'post', '/groups/:groupId/invites', { as: alice, params: g, body: { channel: 'EMAIL', email: carol.email } });
    ev = on(alice.socket!, 'member:joined', (p) => p.member.userId === carol.id);
    await call('Accept an invitation', 'post', '/invites/:inviteId/accept', { as: carol, params: { inviteId: invite2.body.id } });
    await shown(ev, 'member:joined', 'Alice');
    ev = on(alice.socket!, 'member:removed');
    await call('Leave the group (own userId)', 'delete', '/groups/:groupId/members/:userId', { as: carol, params: { ...g, userId: carol.id } });
    await shown(ev, 'member:removed', 'Alice (Carol gets it too)');

    section('Invites — share link');
    const link = await call('Create a share link', 'post', '/groups/:groupId/invites', { as: alice, params: g, body: { channel: 'LINK', expiresInDays: 7 } });
    await call('Preview a share link', 'get', '/invites/link/:token', { as: carol, params: { token: link.body.token } });
    ev = on(alice.socket!, 'member:joined', (p) => p.member.userId === carol.id);
    await call('Join via share link', 'post', '/invites/link/:token/accept', { as: carol, params: { token: link.body.token } });
    await shown(ev, 'member:joined', 'Alice');
    await call('Viewer tries to remove another member', 'delete', '/groups/:groupId/members/:userId', { as: carol, params: { ...g, userId: bob.id }, expect: 403 });
    await call('Revoke the link (admin)', 'delete', '/groups/:groupId/invites/:inviteId', { as: alice, params: { ...g, inviteId: link.body.id } });
    await call('Preview a revoked link', 'get', '/invites/link/:token', { as: dave, params: { token: link.body.token }, expect: 404 });

    // ============================================================ itinerary
    section('Itinerary — draft & pins (admin)');
    await call('No finalized itinerary yet', 'get', '/groups/:groupId/itinerary', { as: bob, params: g, expect: 404 });
    await call('Viewer tries to start a draft', 'post', '/groups/:groupId/itinerary/draft', { as: bob, params: g, expect: 403 });
    await call('Start a draft', 'post', '/groups/:groupId/itinerary/draft', { as: alice, params: g });
    await call('Start a second draft', 'post', '/groups/:groupId/itinerary/draft', { as: alice, params: g, expect: 409 });
    await call('Drop a pin (first pin = START)', 'post', '/groups/:groupId/itinerary/draft/waypoints', {
      as: alice,
      params: g,
      body: { name: 'Manali', lat: 32.2432, lng: 77.1892, date: '2026-10-10', notes: 'Meet at the bus stand, 6 am' },
    });
    await call('Finalize with only 1 pin', 'post', '/groups/:groupId/itinerary/draft/finalize', { as: alice, params: g, expect: 400 });
    await call('Drop a second pin (appended = END)', 'post', '/groups/:groupId/itinerary/draft/waypoints', {
      as: alice,
      params: g,
      body: { name: 'Leh', lat: 34.1526, lng: 77.5771, date: '2026-10-13' },
    });
    const withKeylong = await call('Insert a pin in the middle (position 2)', 'post', '/groups/:groupId/itinerary/draft/waypoints', {
      as: alice,
      params: g,
      body: { name: 'Keylong', lat: 32.5715, lng: 77.0326, date: '2026-10-11', position: 2 },
    });
    const pins = withKeylong.body.waypoints as { id: string; name: string; activityId: string }[];
    await call('Invalid pin (lat out of range, bad date)', 'post', '/groups/:groupId/itinerary/draft/waypoints', {
      as: alice,
      params: g,
      body: { name: 'Nowhere', lat: 123, lng: 77, date: '13/10/2026' },
      expect: 400,
    });
    const edited = await call('Edit a pin (add notes)', 'patch', '/groups/:groupId/itinerary/draft/waypoints/:waypointId', {
      as: alice,
      params: { ...g, waypointId: pins[1].id },
      body: { notes: 'Fuel up: last pump for 365 km' },
    });
    await call('Edit with an outdated revision (If-Match)', 'patch', '/groups/:groupId/itinerary/draft/waypoints/:waypointId', {
      as: alice,
      params: { ...g, waypointId: pins[1].id },
      headers: { 'If-Match': String(edited.body.revision - 1) },
      body: { notes: 'stale edit' },
      expect: 412,
    });
    await call('Reorder with a missing pin', 'put', '/groups/:groupId/itinerary/draft/waypoints/order', {
      as: alice,
      params: g,
      body: { waypointIds: [pins[0].id, pins[1].id] },
      expect: 400,
    });
    await call('Viewer tries to see the draft', 'get', '/groups/:groupId/itinerary/draft', { as: bob, params: g, expect: 403 });
    await call('Get the draft', 'get', '/groups/:groupId/itinerary/draft', { as: alice, params: g });

    section('Itinerary — finalize, versions, PDF');
    ev = on(bob.socket!, 'itinerary:updated');
    await call('Finalize (becomes version 1)', 'post', '/groups/:groupId/itinerary/draft/finalize', { as: alice, params: g });
    await shown(ev, 'itinerary:updated', 'Bob');
    await call('Latest finalized itinerary (viewer)', 'get', '/groups/:groupId/itinerary', { as: bob, params: g });
    await call('Route map: the stops joined along roads', 'get', '/groups/:groupId/itinerary/route', {
      as: bob,
      params: g,
      abbreviate: true,
      note: '_Arrays are shortened here: `geometry.coordinates` has every point of the road line, `legs` one entry per pair of stops._\n',
    });
    await call('Download as PDF', 'get', '/groups/:groupId/itinerary/pdf', { as: bob, params: g, binary: true });
    const draft2 = await call('Start a new draft (copy of version 1, same activityIds)', 'post', '/groups/:groupId/itinerary/draft', { as: alice, params: g });
    await call('Add a stop', 'post', '/groups/:groupId/itinerary/draft/waypoints', {
      as: alice,
      params: g,
      body: { name: 'Jispa', lat: 32.6403, lng: 77.1887, date: '2026-10-12', position: 3 },
      note: `_The draft's waypoints keep the activityIds of version 1 (e.g. Manali = \`${draft2.body.waypoints[0].activityId}\`)._\n`,
    });
    await call('Preview the draft route (admin)', 'get', '/groups/:groupId/itinerary/draft/route', { as: alice, params: g, abbreviate: true });
    await call('Finalize again (version 2)', 'post', '/groups/:groupId/itinerary/draft/finalize', { as: alice, params: g });
    await call('List versions', 'get', '/groups/:groupId/itinerary/versions', { as: bob, params: g });
    await call('Get version 1 (unchanged)', 'get', '/groups/:groupId/itinerary/versions/:version', { as: bob, params: { ...g, version: '1' } });
    await call('Version that does not exist', 'get', '/groups/:groupId/itinerary/versions/:version', { as: bob, params: { ...g, version: '99' }, expect: 404 });
    await call('Refresh elevation/weather on the latest version (admin)', 'post', '/groups/:groupId/itinerary/refresh', { as: alice, params: g });
    await call('Start a draft to discard', 'post', '/groups/:groupId/itinerary/draft', { as: alice, params: g });
    await call('Discard the draft', 'delete', '/groups/:groupId/itinerary/draft', { as: alice, params: g });
    await call('Discard when there is no draft', 'delete', '/groups/:groupId/itinerary/draft', { as: alice, params: g, expect: 404 });

    // ============================================================ activities
    section('Activities — status & updates');
    const acts = await call('List activities (stops of the latest version)', 'get', '/groups/:groupId/activities', { as: bob, params: g });
    const [manali, keylong] = acts.body.activities as { activityId: string }[];
    await call('Viewer tries to set a status', 'patch', '/groups/:groupId/activities/:activityId/status', {
      as: bob,
      params: { ...g, activityId: manali.activityId },
      body: { status: 'CURRENT' },
      expect: 403,
    });
    ev = on(bob.socket!, 'activity:status_updated');
    await call('Set Manali CURRENT (admin)', 'patch', '/groups/:groupId/activities/:activityId/status', {
      as: alice,
      params: { ...g, activityId: manali.activityId },
      body: { status: 'CURRENT' },
    });
    await shown(ev, 'activity:status_updated', 'Bob');
    const evDone = on(bob.socket!, 'activity:status_updated', (p) => p.status === 'COMPLETED');
    const evNow = on(bob.socket!, 'activity:status_updated', (p) => p.status === 'CURRENT');
    await call('Move on: Keylong CURRENT (Manali is completed automatically)', 'patch', '/groups/:groupId/activities/:activityId/status', {
      as: alice,
      params: { ...g, activityId: keylong.activityId },
      body: { status: 'CURRENT' },
    });
    await shown(evDone, 'activity:status_updated', 'Bob (1 of 2)');
    await shown(evNow, 'activity:status_updated', 'Bob (2 of 2)');
    await call('Unknown status', 'patch', '/groups/:groupId/activities/:activityId/status', {
      as: alice,
      params: { ...g, activityId: keylong.activityId },
      body: { status: 'DONE' },
      expect: 400,
    });
    ev = on(alice.socket!, 'activity:update_added');
    const upd = await call('Post an update (any member)', 'post', '/groups/:groupId/activities/:activityId/updates', {
      as: bob,
      params: { ...g, activityId: keylong.activityId },
      body: { text: 'Petrol pump at Tandi is open till 8 pm', clientId: randomUUID() },
    });
    await shown(ev, 'activity:update_added', 'Alice');
    await call('Another update', 'post', '/groups/:groupId/activities/:activityId/updates', {
      as: alice,
      params: { ...g, activityId: keylong.activityId },
      body: { text: 'Lunch at the dhaba near the bridge' },
    });
    const page = await call("An activity's updates (newest first, paged)", 'get', '/groups/:groupId/activities/:activityId/updates', {
      as: bob,
      params: { ...g, activityId: keylong.activityId },
      query: { limit: 1 },
    });
    await call('Next page', 'get', '/groups/:groupId/activities/:activityId/updates', {
      as: bob,
      params: { ...g, activityId: keylong.activityId },
      query: { limit: 1, before: page.body.nextBefore },
    });
    await call("Edit someone else's update", 'patch', '/groups/:groupId/activity-updates/:updateId', {
      as: alice,
      params: { ...g, updateId: upd.body.id },
      body: { text: 'changed' },
      expect: 403,
    });
    ev = on(alice.socket!, 'activity:update_edited');
    await call('Edit my own update', 'patch', '/groups/:groupId/activity-updates/:updateId', {
      as: bob,
      params: { ...g, updateId: upd.body.id },
      body: { text: 'Petrol pump at Tandi closes at 8 pm sharp' },
    });
    await shown(ev, 'activity:update_edited', 'Alice');
    ev = on(bob.socket!, 'activity:update_deleted');
    await call("Admin deletes someone's update", 'delete', '/groups/:groupId/activity-updates/:updateId', { as: alice, params: { ...g, updateId: upd.body.id } });
    await shown(ev, 'activity:update_deleted', 'Bob');
    await call('Post to a stop that is not in the itinerary', 'post', '/groups/:groupId/activities/:activityId/updates', {
      as: bob,
      params: { ...g, activityId: randomUUID() },
      body: { text: 'hi' },
      expect: 404,
    });
    await call('Activities with status and update counts', 'get', '/groups/:groupId/activities', { as: bob, params: g });

    // ============================================================ status
    section('Trip status');
    await call('Current status (nobody has set one)', 'get', '/groups/:groupId/status', { as: bob, params: g });
    ev = on(alice.socket!, 'status:updated');
    await call('Set my status', 'post', '/groups/:groupId/status', { as: bob, params: g, body: { status: 'IN_TRANSIT' } });
    await shown(ev, 'status:updated', 'Alice');
    await call('Set my status with a note', 'post', '/groups/:groupId/status', { as: alice, params: g, body: { status: 'STOPPED', note: 'Tea break at Marhi' } });
    await call('Unknown status', 'post', '/groups/:groupId/status', { as: bob, params: g, body: { status: 'LOST' }, expect: 400 });
    await call('Current status per member', 'get', '/groups/:groupId/status', { as: bob, params: g });
    await call('History (newest first)', 'get', '/groups/:groupId/status/history', { as: bob, params: g });
    await call("One member's history", 'get', '/groups/:groupId/status/history', { as: bob, params: g, query: { userId: alice.id, limit: 1 } });

    // ============================================================ location
    section('Live location (with the group)');
    await call('My sharing state', 'get', '/groups/:groupId/location/share', { as: bob, params: g });
    await call('Send a position while not sharing', 'post', '/groups/:groupId/location', { as: bob, params: g, body: { points: [{ lat: 32.24, lng: 77.18 }] }, expect: 409 });
    await call('Invalid duration', 'put', '/groups/:groupId/location/share', { as: bob, params: g, body: { duration: 'TWO_DAYS' }, expect: 400 });
    ev = on(alice.socket!, 'location:sharing-started');
    await call('Start sharing for 1 hour', 'put', '/groups/:groupId/location/share', { as: bob, params: g, body: { duration: 'ONE_HOUR' } });
    await shown(ev, 'location:sharing-started', 'Alice');
    ev = on(alice.socket!, 'location:updated');
    await call('Send a position (this group only)', 'post', '/groups/:groupId/location', {
      as: bob,
      params: g,
      body: { points: [{ lat: 32.2441, lng: 77.1903, accuracy: 6, heading: 30, speed: 11.5 }] },
    });
    await shown(ev, 'location:updated', 'Alice');
    const now = Date.now();
    await call('Send a background batch to every group I share with (POST /location)', 'post', '/location', {
      as: bob,
      body: {
        points: [
          { lat: 32.3101, lng: 77.1702, recordedAt: new Date(now - 20_000).toISOString() },
          { lat: 32.3155, lng: 77.1698, accuracy: 9, recordedAt: new Date(now - 10_000).toISOString() },
        ],
      },
    });
    await call('Invalid coordinates', 'post', '/location', { as: bob, body: { points: [{ lat: 100, lng: 77 }] }, expect: 400 });
    await call('The groups I share with', 'get', '/location/sharing', { as: bob });
    await call('Group map feed', 'get', '/groups/:groupId/location', { as: alice, params: g });
    await call('Switch to ALWAYS (no timer)', 'put', '/groups/:groupId/location/share', { as: bob, params: g, body: { duration: 'ALWAYS' } });
    ev = on(alice.socket!, 'location:sharing-stopped');
    await call('Stop sharing', 'delete', '/groups/:groupId/location/share', { as: bob, params: g });
    await shown(ev, 'location:sharing-stopped', 'Alice');

    section('Live location for loved ones (people outside the app)');
    ev = on(alice.socket!, 'location_share:started');
    const live = await call('Share my live location with someone (link shown once)', 'post', '/location-share/sessions', {
      as: alice,
      body: { duration: 'ONE_HOUR', recipientLabel: 'Mom' },
    });
    await shown(ev, 'location_share:started', "Alice's own devices");
    await call('Invalid duration', 'post', '/location-share/sessions', { as: alice, body: { duration: 'FOREVER' }, expect: 400 });
    await call('My active links', 'get', '/location-share/sessions', { as: alice });
    await call('Recipient opens the link (no login): no position yet', 'get', '/public/live/:token', { params: { token: live.body.token } });
    heading('Recipient page connects to the `/live` socket (no login)');
    out.push("`io(baseUrl + '/live', { auth: { token } })` → `on ready` 🔌\n");
    // forceNew: a recipient's page is its own client, not multiplexed on Alice's connection.
    const viewer = io(`${baseUrl}/live`, { auth: { token: live.body.token }, transports: ['websocket'], reconnection: false, forceNew: true });
    sockets.push(viewer);
    out.push(json(await new Promise((r) => viewer.once('ready', r))));
    ev = on(viewer, 'location:update');
    await call('Alice keeps sending positions (POST /location reaches her links)', 'post', '/location', {
      as: alice,
      body: { points: [{ lat: 32.2432, lng: 77.1892, accuracy: 5 }] },
    });
    await shown(ev, 'location:update', "the recipient's page");
    await call('Recipient polls the link', 'get', '/public/live/:token', { params: { token: live.body.token } });
    await call('Unknown link', 'get', '/public/live/:token', { params: { token: 'x'.repeat(43) }, expect: 404 });
    ev = on(viewer, 'location_share:stopped');
    await call('Stop sharing with Mom', 'delete', '/location-share/sessions/:sessionId', { as: alice, params: { sessionId: live.body.id } });
    await shown(ev, 'location_share:stopped', "the recipient's page (then disconnected)");
    await call('Recipient after it ended', 'get', '/public/live/:token', { params: { token: live.body.token }, expect: 410 });
    heading('Recipient socket after it ended');
    const gone = io(`${baseUrl}/live`, { auth: { token: live.body.token }, transports: ['websocket'], reconnection: false, forceNew: true });
    sockets.push(gone);
    const err = await new Promise<Error>((r) => gone.once('connect_error', r));
    out.push(`\`on connect_error\` 🔌\n\n${json({ message: err.message })}`);
    await call('Send a position while sharing with nobody', 'post', '/location', { as: alice, body: { points: [{ lat: 1, lng: 1 }] }, expect: 409 });

    // ============================================================ places
    section('Nearby places (homepage)');
    out.push('_Real OpenStreetMap data around Manali. The public data server is rate-limited, so a `503` here would mean it was busy._\n');
    for (const [title, path] of [
      ['Fuel stations', '/location/fuel-stations'],
      ['Restaurants', '/location/restaurants'],
      ['Garages', '/location/garages'],
    ] as const) {
      const query = { lat: 32.2432, lng: 77.1892, radius: 3000, limit: 3 };
      // The public server is often busy: try a few times first (a success is cached for the recorded call).
      for (let i = 0; i < 4; i++) {
        const probe = await http().get(path).query(query).set('Authorization', `Bearer ${bob.token}`);
        if (probe.status === 200) break;
        await sleep(15_000);
      }
      await call(title, 'get', path, { as: bob, query, expect: 'any' });
    }
    await call('Missing coordinates', 'get', '/location/garages', { as: bob, query: { radius: 3000 }, expect: 400 });

    // ============================================================ presence + chat
    section('Presence');
    await call("Who's online", 'get', '/groups/:groupId/presence', { as: alice, params: g });

    section('Chat (socket + HTTP)');
    await call('Chat history before any message', 'get', '/groups/:groupId/messages', { as: alice, params: g });
    ev = on(bob.socket!, 'chat:message');
    const clientMsgId = randomUUID();
    const first = await emitStep('Send a message', alice, 'chat:send', { groupId, body: 'Morning all! Leaving Manali at 6 sharp 🏍️', clientMsgId });
    await shown(ev, 'chat:message', 'Bob');
    await emitStep('Resend with the same clientMsgId (no duplicate, no broadcast)', alice, 'chat:send', {
      groupId,
      body: 'Morning all! Leaving Manali at 6 sharp 🏍️',
      clientMsgId,
    });
    await emitStep('Send an empty message', alice, 'chat:send', { groupId, body: '   ' }, false);
    await emitStep('Send to a group you are not in', dave, 'chat:send', { groupId, body: 'hello?' }, false);
    ev = on(bob.socket!, 'chat:typing');
    await emitStep('Typing indicator', alice, 'chat:typing', { groupId, isTyping: true });
    await shown(ev, 'chat:typing', 'Bob');
    await call('Unread count before reading', 'get', '/groups/:groupId/messages/unread', { as: bob, params: g });
    await emitStep('Reply', bob, 'chat:send', { groupId, body: 'On my way 👍', clientMsgId: randomUUID() });
    ev = on(alice.socket!, 'chat:read', (p) => p.userId === carol.id);
    await emitStep('Mark read over the socket', carol, 'chat:read', { groupId, messageId: first.data.id });
    await shown(ev, 'chat:read', 'Alice');
    ev = on(bob.socket!, 'chat:message', (p) => p.kind === 'LOCATION');
    await emitStep('Share a location', alice, 'chat:send', {
      groupId,
      kind: 'LOCATION',
      location: { lat: 32.5715, lng: 77.0326, accuracy: 10, label: 'Keylong petrol pump' },
      body: 'Meet here',
    });
    await shown(ev, 'chat:message', 'Bob');
    await emitStep('Location message without a location', alice, 'chat:send', { groupId, kind: 'LOCATION' }, false);
    const box = (type: string, body: Buffer) => {
      const head = Buffer.alloc(8);
      head.writeUInt32BE(8 + body.length, 0);
      head.write(type, 4, 'latin1');
      return Buffer.concat([head, body]);
    };
    const hdlr = (handler: string) => box('hdlr', Buffer.concat([Buffer.alloc(8), Buffer.from(handler, 'latin1'), Buffer.alloc(12)]));
    const m4a = Buffer.concat([box('ftyp', Buffer.from('M4A \0\0\0\0M4A isom', 'latin1')), box('moov', hdlr('soun')), Buffer.alloc(400, 7)]);
    ev = on(alice.socket!, 'chat:message', (p) => p.kind === 'VOICE');
    const voice = await call('Send a voice message (HTTP upload)', 'post', '/groups/:groupId/messages/voice', {
      as: bob,
      params: g,
      fields: { durationMs: '14500', clientMsgId: randomUUID() },
      file: { data: m4a, filename: 'voice-note.m4a', contentType: 'audio/mp4' },
    });
    await shown(ev, 'chat:message', 'Alice');
    await call('Play a voice message', 'get', '/groups/:groupId/messages/:messageId/voice', { as: alice, params: { ...g, messageId: voice.body.id }, binary: true });
    await call('Upload something that is not audio (a PNG)', 'post', '/groups/:groupId/messages/voice', {
      as: bob,
      params: g,
      fields: { durationMs: '1000' },
      file: { data: Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)]), filename: 'photo.png', contentType: 'image/png' },
      expect: 415,
    });
    await call('Voice message longer than 2 minutes', 'post', '/groups/:groupId/messages/voice', {
      as: bob,
      params: g,
      fields: { durationMs: '130000' },
      file: { data: m4a, filename: 'long.m4a', contentType: 'audio/mp4' },
      expect: 400,
    });
    const history = await call('Chat history (newest page, oldest first)', 'get', '/groups/:groupId/messages', { as: alice, params: g });
    await call('History, paged (1 per page)', 'get', '/groups/:groupId/messages', { as: alice, params: g, query: { limit: 1 } });
    await call('Search the chat', 'get', '/groups/:groupId/messages', { as: alice, params: g, query: { search: 'manali' } });
    await call('Search text too short', 'get', '/groups/:groupId/messages', { as: alice, params: g, query: { search: 'm' }, expect: 400 });
    await call('Read receipts for a message', 'get', '/groups/:groupId/messages/:messageId/reads', { as: alice, params: { ...g, messageId: history.body.items[0].id } });

    section('Alerts & SOS');
    const evAlert = on(bob.socket!, 'alert:raised');
    const critical = await call('Send a CRITICAL alert (admin)', 'post', '/groups/:groupId/alerts', {
      as: alice,
      params: g,
      body: { type: 'CRITICAL', category: 'ROAD_CLOSURE', body: 'Rohtang Pass closed after a landslide. Take the Atal Tunnel.' },
    });
    await shown(evAlert, 'alert:raised', 'Bob');
    await call('Viewer tries a CRITICAL alert', 'post', '/groups/:groupId/alerts', { as: bob, params: g, body: { type: 'CRITICAL', category: 'SAFETY', body: 'x' }, expect: 403 });
    await call('CRITICAL without a category', 'post', '/groups/:groupId/alerts', { as: alice, params: g, body: { type: 'CRITICAL', body: 'x' }, expect: 400 });
    await call('Send a GENERAL announcement', 'post', '/groups/:groupId/alerts', { as: alice, params: g, body: { type: 'GENERAL', body: 'Dinner at 8 at the camp' } });
    const sos = await call('Raise an SOS with the phone coordinates', 'post', '/groups/:groupId/alerts/sos', {
      as: bob,
      params: g,
      body: { body: 'Bike skidded near Gata Loops, ankle injured', lat: 32.9, lng: 77.6, accuracy: 12 },
    });
    await call('Tap SOS again (returns the same active SOS)', 'post', '/groups/:groupId/alerts/sos', { as: bob, params: g, body: {} });
    await call('SOS with lat but no lng', 'post', '/groups/:groupId/alerts/sos', { as: bob, params: g, body: { lat: 32.9 }, expect: 400 });
    await call('Active banners', 'get', '/groups/:groupId/alerts', { as: alice, params: g, query: { active: true } });
    ev = on(bob.socket!, 'alert:acknowledged');
    await call("Acknowledge Bob's SOS", 'post', '/groups/:groupId/alerts/:alertId/ack', { as: alice, params: { ...g, alertId: sos.body.id } });
    await shown(ev, 'alert:acknowledged', 'Bob');
    await call('Acknowledge your own SOS', 'post', '/groups/:groupId/alerts/:alertId/ack', { as: bob, params: { ...g, alertId: sos.body.id }, expect: 'fail' });
    await call('Who has seen the SOS', 'get', '/groups/:groupId/alerts/:alertId', { as: bob, params: { ...g, alertId: sos.body.id } });
    ev = on(alice.socket!, 'alert:resolved');
    await call('Resolve your SOS ("I\'m safe")', 'post', '/groups/:groupId/alerts/:alertId/resolve', { as: bob, params: { ...g, alertId: sos.body.id } });
    await shown(ev, 'alert:resolved', 'Alice');
    await call('Viewer tries to resolve the CRITICAL alert', 'post', '/groups/:groupId/alerts/:alertId/resolve', { as: bob, params: { ...g, alertId: critical.body.id }, expect: 403 });
    await call('Resolve the CRITICAL alert (admin)', 'post', '/groups/:groupId/alerts/:alertId/resolve', { as: alice, params: { ...g, alertId: critical.body.id } });
    await call('All alerts, newest first', 'get', '/groups/:groupId/alerts', { as: carol, params: g, abbreviate: true });
    await call('Only SOS alerts, paged', 'get', '/groups/:groupId/alerts', { as: carol, params: g, query: { type: 'SOS', limit: 1 } });

    section('Chat — read state after the alerts');
    await call('Unread count', 'get', '/groups/:groupId/messages/unread', { as: carol, params: g });
    await call('Mark read over HTTP', 'post', '/groups/:groupId/messages/read', { as: carol, params: g, body: { messageId: critical.body.id } });
    await call('Read receipts for an unknown message', 'get', '/groups/:groupId/messages/:messageId/reads', { as: carol, params: { ...g, messageId: randomUUID() }, expect: 404 });

    // ============================================================ expenses
    section('Expenses');
    ev = on(bob.socket!, 'expense:created');
    const fuel = await call('Add an expense split equally between everyone', 'post', '/groups/:groupId/expenses', {
      as: alice,
      params: g,
      body: { amount: 900, category: 'FUEL', date: '2026-10-11', description: 'Diesel at Tandi', splitType: 'EQUAL', clientId: randomUUID() },
    });
    await shown(ev, 'expense:created', 'Bob');
    await call('Split equally between chosen members only', 'post', '/groups/:groupId/expenses', {
      as: bob,
      params: g,
      body: { amount: 100.01, category: 'FOOD', date: '2026-10-12', description: 'Maggi + chai', splitType: 'EQUAL', splitBetween: [bob.id, carol.id] },
    });
    await call('Custom split, paid by someone else', 'post', '/groups/:groupId/expenses', {
      as: alice,
      params: g,
      body: {
        amount: 3000,
        category: 'ACCOMMODATION',
        date: '2026-10-12',
        description: 'Homestay in Jispa',
        paidBy: carol.id,
        splitType: 'CUSTOM',
        shares: [
          { userId: alice.id, amount: 1200 },
          { userId: bob.id, amount: 900 },
          { userId: carol.id, amount: 900 },
        ],
      },
    });
    const dinner = await call('Several people paid one expense', 'post', '/groups/:groupId/expenses', {
      as: alice,
      params: g,
      body: {
        amount: 1200,
        category: 'FOOD',
        date: '2026-10-13',
        description: 'Dinner in Leh',
        splitType: 'EQUAL',
        splitBetween: [alice.id, bob.id, carol.id],
        payments: [
          { userId: alice.id, amount: 800 },
          { userId: bob.id, amount: 400 },
        ],
      },
    });
    await call('Custom shares that do not add up', 'post', '/groups/:groupId/expenses', {
      as: alice,
      params: g,
      body: { amount: 100, category: 'OTHER', date: '2026-10-13', splitType: 'CUSTOM', shares: [{ userId: alice.id, amount: 60 }] },
      expect: 400,
    });
    await call('Both paidBy and payments', 'post', '/groups/:groupId/expenses', {
      as: alice,
      params: g,
      body: { amount: 100, category: 'OTHER', date: '2026-10-13', splitType: 'EQUAL', paidBy: alice.id, payments: [{ userId: alice.id, amount: 100 }] },
      expect: 400,
    });
    await call('List expenses (newest day first)', 'get', '/groups/:groupId/expenses', { as: bob, params: g, abbreviate: true });
    await call('Expenses Bob paid (all or part of)', 'get', '/groups/:groupId/expenses', { as: bob, params: g, query: { paidBy: bob.id }, abbreviate: true });
    await call('One expense', 'get', '/groups/:groupId/expenses/:expenseId', { as: bob, params: { ...g, expenseId: fuel.body.id } });
    await call("Viewer edits someone else's expense", 'patch', '/groups/:groupId/expenses/:expenseId', { as: bob, params: { ...g, expenseId: fuel.body.id }, body: { description: 'mine' }, expect: 403 });
    ev = on(bob.socket!, 'expense:updated');
    await call('Change the amount (EQUAL re-splits)', 'patch', '/groups/:groupId/expenses/:expenseId', { as: alice, params: { ...g, expenseId: fuel.body.id }, body: { amount: 1200 } });
    await shown(ev, 'expense:updated', 'Bob');
    await call('Change the amount of a several-payer expense without new payments', 'patch', '/groups/:groupId/expenses/:expenseId', {
      as: alice,
      params: { ...g, expenseId: dinner.body.id },
      body: { amount: 1500 },
      expect: 400,
    });
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(120, 1)]);
    await call('Attach a receipt', 'put', '/groups/:groupId/expenses/:expenseId/receipt', {
      as: alice,
      params: { ...g, expenseId: fuel.body.id },
      file: { data: png, filename: 'bill.png', contentType: 'image/png' },
    });
    await call('Download the receipt', 'get', '/groups/:groupId/expenses/:expenseId/receipt', { as: bob, params: { ...g, expenseId: fuel.body.id }, binary: true });
    await call('Receipt that is not an image or PDF', 'put', '/groups/:groupId/expenses/:expenseId/receipt', {
      as: alice,
      params: { ...g, expenseId: fuel.body.id },
      file: { data: Buffer.from('just some text, not a receipt'), filename: 'bill.png', contentType: 'image/png' },
      expect: 415,
    });
    await call('Summary: totals, balances, who owes whom', 'get', '/groups/:groupId/expenses/summary', { as: bob, params: g });
    ev = on(alice.socket!, 'expense:settlement_recorded');
    const repay = await call('Record a repayment', 'post', '/groups/:groupId/expenses/settlements', {
      as: bob,
      params: g,
      body: { toUserId: carol.id, amount: 500, date: '2026-10-14', note: 'UPI' },
    });
    await shown(ev, 'expense:settlement_recorded', 'Alice');
    await call('Repayments', 'get', '/groups/:groupId/expenses/settlements', { as: carol, params: g });
    await call("Record someone else's repayment (not admin)", 'post', '/groups/:groupId/expenses/settlements', {
      as: carol,
      params: g,
      body: { fromUserId: alice.id, toUserId: bob.id, amount: 10 },
      expect: 403,
    });
    await call('Report as PDF', 'get', '/groups/:groupId/expenses/report', { as: bob, params: g, binary: true });
    await call('Report as CSV', 'get', '/groups/:groupId/expenses/report', { as: bob, params: g, query: { format: 'csv' }, text: true });
    ev = on(alice.socket!, 'expense:settlement_deleted');
    await call('Delete a repayment', 'delete', '/groups/:groupId/expenses/settlements/:settlementId', { as: bob, params: { ...g, settlementId: repay.body.id } });
    await shown(ev, 'expense:settlement_deleted', 'Alice');
    ev = on(bob.socket!, 'expense:deleted');
    await call('Delete an expense', 'delete', '/groups/:groupId/expenses/:expenseId', { as: alice, params: { ...g, expenseId: dinner.body.id } });
    await shown(ev, 'expense:deleted', 'Bob');
    await call('Change the currency once there are expenses', 'patch', '/groups/:groupId', { as: alice, params: g, body: { currency: 'USD' }, expect: 409 });

    // ============================================================ offline
    section('Offline bundle');
    const bundle = await call('Everything to keep the trip usable offline (lists shortened here)', 'get', '/groups/:groupId/offline-bundle', {
      as: bob,
      params: g,
      abbreviate: true,
    });
    await call('Nothing changed since (If-None-Match)', 'get', '/groups/:groupId/offline-bundle', {
      as: bob,
      params: g,
      headers: { 'If-None-Match': bundle.headers.etag as string },
      expect: 304,
    });

    // ============================================================ feedback
    section('Feedback (beta)');
    const fb = await call('Send feedback', 'post', '/feedback', {
      as: bob,
      body: {
        category: 'BUG',
        message: 'The map froze when I opened the chat while sharing.',
        rating: 3,
        screen: 'GroupMap',
        groupId,
        appVersion: '0.9.0 (42)',
        platform: 'ANDROID',
        osVersion: '14',
        deviceModel: 'Pixel 7',
      },
    });
    await call('Attach a screenshot', 'put', '/feedback/:feedbackId/screenshot', {
      as: bob,
      params: { feedbackId: fb.body.id },
      file: { data: png, filename: 'screen.png', contentType: 'image/png' },
    });
    await call('My feedback', 'get', '/feedback/mine', { as: bob });

    // ============================================================ closing
    section('Closing a trip');
    await call('Close the trip (admin)', 'post', '/groups/:groupId/close', { as: alice, params: g });
    await call('Write to a closed trip', 'post', '/groups/:groupId/status', { as: bob, params: g, body: { status: 'ARRIVED' }, expect: 409 });
    await emitStep('Chat in a closed trip', bob, 'chat:send', { groupId, body: 'hello?' }, false);
    await call('Reopen the trip (admin)', 'post', '/groups/:groupId/reopen', { as: alice, params: g });

    // ============================================================ privacy
    section('Privacy — my data, delete my account');
    await call('Download my data (lists shortened here)', 'get', '/auth/me/export', { as: bob, abbreviate: true });
    await call('Delete my account with a wrong password', 'delete', '/auth/me', { as: carol, body: { password: 'Wr0ng!Pass' }, expect: 401 });
    ev = on(alice.socket!, 'member:removed', (p) => p.userId === carol.id);
    await call('Delete my account', 'delete', '/auth/me', { as: carol, body: { password: PASSWORD } });
    await shown(ev, 'member:removed', 'Alice');
    await call('Log in after deleting the account', 'post', '/auth/login', { body: { identifier: carol.email, password: PASSWORD }, expect: 401 });

    // ============================================================ auth tail
    section('Auth — OTP login, password reset, logout');
    await call('Request a login OTP (SMS)', 'post', '/auth/otp/request', { body: { phone: bob.phone } });
    await call('Log in with a wrong OTP', 'post', '/auth/otp/login', { body: { phone: bob.phone, code: '000000' }, expect: 'fail' });
    await call('Log in with OTP', 'post', '/auth/otp/login', { body: { phone: bob.phone, code: codes.get(bob.phone) } });
    await call('Forgot password', 'post', '/auth/forgot-password', { body: { email: alice.email } });
    await call('Reset with a weak new password', 'post', '/auth/reset-password', { body: { email: alice.email, code: codes.get(alice.email), newPassword: 'weak' }, expect: 400 });
    await call('Reset password', 'post', '/auth/reset-password', { body: { email: alice.email, code: codes.get(alice.email), newPassword: 'N3w!Passw0rd' } });
    const relog = await call('Log in with the new password', 'post', '/auth/login', { body: { identifier: alice.email, password: 'N3w!Passw0rd' } });
    alice.token = relog.body.accessToken;
    await call('Unregister the device (before logout)', 'delete', '/devices', { as: alice, body: { token: 'fcm-token-alice-pixel-7' } });
    await call('Log out', 'post', '/auth/logout', { as: alice });

    // ============================================================ presence offline
    section('Presence — going offline');
    const offline = on(alice.socket!, 'presence:updated', (p) => p.userId === bob.id && p.online === false, 8000);
    bob.socket!.disconnect();
    await eventStep('Bob closes the app (5 s later)', 'presence:updated', 'Alice', offline);
    await call("Who's online after Bob left", 'get', '/groups/:groupId/presence', { as: alice, params: g });

    // ============================================================ cleanup
    section('Cleanup — delete the group');
    const bobLogin = await http().post('/auth/login').send({ identifier: bob.username, password: PASSWORD }).expect(201);
    bob.token = bobLogin.body.accessToken;
    await call('Viewer tries to delete the group', 'delete', '/groups/:groupId', { as: bob, params: g, expect: 403 });
    await call('Delete the group (admin)', 'delete', '/groups/:groupId', { as: alice, params: g });
    await call('Get a deleted group', 'get', '/groups/:groupId', { as: alice, params: g, expect: 404 });

    // ============================================================ write
    const today = new Date().toISOString().slice(0, 10);
    const header = `# TravelGo API — Real Request & Response Examples

**For:** the mobile app developer. It sits alongside \`API_DOCUMENTATION.md\`, which explains each endpoint and its rules.

Captured on ${today} by calling every endpoint, in order, against the backend with Postgres and Redis running (\`npm run capture:api-responses\`). Every **request**, **response**, socket **ack**, socket **event** and **push** below is real, not hand-written. ${step} steps.

**How to read it**
- Demo users: **Alice** (\`demo_alice\`) creates the group, so she's Admin. **Bob** (\`demo_bob\`) is a member. **Carol** joins by invite and link and later deletes her account. **Dave** is never a member (for "not allowed" examples).
- 🔒 = sent with \`Authorization: Bearer <accessToken>\`.
- 🔌 = over the socket.io connection (§13 of the docs). \`emit …\` = the app sends an event and gets the **Ack (reply)**; \`on …\` = an event the server pushes to the app. The event other members' apps received at the same moment is shown under the response.
- **Push sent to …** = the push notification the server sent because of that request (\`title\`, \`body\`, \`data\`).
- Paths show placeholders (\`:groupId\`, \`:token\`…) where real ids were used; bodies and socket payloads show the real ids.
- Tokens (JWTs) are shortened. Real ones are 200+ characters.
- Long lists (offline bundle, data export, some lists) keep their first item and say how many more there were.
- Success **and** error cases are included, so you can see exactly what the app will receive.

**New since the last capture (2026-10-05)**
- No endpoint, request or response changes. Re-captured to confirm the examples still match the backend.

**What reflects the current dev setup**
- **Itinerary:** elevation (Open-Meteo) and weather (MET Norway) are real. Where examples show \`weather.status\` \`UNAVAILABLE\`, the capture machine couldn't reach MET Norway; see \`API_DOCUMENTATION.md\` §9 for the filled-in shape.
- **Email/SMS:** codes and invites were captured instead of sent. In the dev server, email is real (Brevo); SMS isn't connected (not needed for now), so SMS codes and invites only appear in the server log.
- **Push notifications:** shown as captured. The dev server sends them for real through Firebase (FCM) to registered devices.
- **Live location:** needs Redis. If it's down, location endpoints return \`503\` "Live location is temporarily unavailable (Redis is down)".
- **Nearby places:** real OpenStreetMap data (public server, rate-limited).

## Contents

${toc.join('\n')}

`;
    writeFileSync(OUT_FILE, header + out.join('\n'));
  });
});
