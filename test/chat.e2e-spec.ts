import { randomUUID } from 'node:crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { io, type Socket } from 'socket.io-client';
import request from 'supertest';
import { In, Repository } from 'typeorm';
import { AppModule } from './../src/app.module.js';
import { Group, User } from './../src/database/entities/index.js';
import type { PushMessage } from './../src/notifications/push.service.js';
import { PushService } from './../src/notifications/push.service.js';
import { OtpDeliveryService } from './../src/notifications/otp-delivery.service.js';
import { StorageService } from './../src/storage/storage.service.js';

// Phase 8 DoD against the real dev Postgres: the group chats in real time (read receipts, typing,
// presence, searchable history) and can trigger / acknowledge / resolve SOS and critical alerts.
// Runs without Redis (SOS falls back to "no location" when live location is unavailable).
const OFFLINE_GRACE_MS = 150;

describe('Chat, alerts & SOS (e2e)', () => {
  let app: INestApplication;
  let baseUrl: string;
  let users: Repository<User>;
  let groups: Repository<Group>;
  let storage: StorageService;
  const otpCodes = new Map<string, string>();
  const pushes: { userId: string; message: PushMessage }[] = [];
  const sockets: Socket[] = [];

  const suffix = randomUUID().slice(0, 8);
  interface TestUser {
    id: string;
    username: string;
    name: string;
    token: string;
    socket?: Socket;
  }
  const userIds: string[] = [];
  let alice: TestUser; // admin
  let bob: TestUser; // viewer
  let dave: TestUser; // viewer
  let carol: TestUser; // not a member
  let groupId: string;

  const http = () => request(app.getHttpServer());
  const as = (u: TestUser) => ({ Authorization: `Bearer ${u.token}` });
  const url = (path = '') => `/groups/${groupId}${path}`;

  interface Ack<T = Record<string, unknown>> {
    ok: boolean;
    data?: T;
    error?: { status: number; message: string };
  }

  async function registerUser(label: string): Promise<TestUser> {
    const email = `chat-e2e.${label}.${suffix}@example.com`; // not `e2e.%`, which the auth suite's cleanup matches
    const username = `${label}_${suffix}`;
    const name = `E2E ${label}`;
    const signup = await http().post('/auth/signup').send({ email, username, password: 'Str0ng!Pass', name }).expect(201);
    const verified = await http()
      .post('/auth/verify')
      .send({ userId: signup.body.userId, code: otpCodes.get(email) })
      .expect(201);
    userIds.push(signup.body.userId);
    return { id: signup.body.userId, username, name, token: verified.body.accessToken };
  }

  async function connect(user: TestUser): Promise<Socket> {
    const socket = io(baseUrl, { auth: { token: user.token }, transports: ['websocket'], reconnection: false });
    sockets.push(socket);
    await waitFor(socket, 'ready');
    user.socket = socket;
    return socket;
  }

  /** Next `event` on the socket whose payload passes `match`. */
  const waitFor = <T = Record<string, unknown>>(socket: Socket, event: string, match: (p: T) => boolean = () => true, timeoutMs = 2000) =>
    new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        socket.off(event, handler);
        reject(new Error(`no matching "${event}" within ${timeoutMs} ms`));
      }, timeoutMs);
      const handler = (payload: T) => {
        if (!match(payload)) return;
        clearTimeout(timer);
        socket.off(event, handler);
        resolve(payload);
      };
      socket.on(event, handler);
    });

  const receives = (socket: Socket, event: string, match?: (p: Record<string, unknown>) => boolean, windowMs = 400) =>
    waitFor(socket, event, match, windowMs).then(
      () => true,
      () => false,
    );

  const emit = <T = Record<string, unknown>>(socket: Socket, event: string, payload: unknown) =>
    socket.timeout(2000).emitWithAck(event, payload) as Promise<Ack<T>>;

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const pushesTo = (userId: string, type: string) => pushes.filter((p) => p.userId === userId && p.message.data?.type === type);

  beforeAll(async () => {
    process.env.PRESENCE_OFFLINE_GRACE_MS = String(OFFLINE_GRACE_MS);
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(OtpDeliveryService)
      .useValue({
        sendEmail: async (to: string, code: string) => void otpCodes.set(to, code),
        sendSms: async (to: string, code: string) => void otpCodes.set(to, code),
      })
      .overrideProvider(PushService)
      .useValue({
        configured: false,
        sendToUser: async (userId: string, message: PushMessage) => void pushes.push({ userId, message }),
        sendToUsers: async (ids: string[], message: PushMessage) => void ids.forEach((userId) => pushes.push({ userId, message })),
      })
      .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.listen(0, '127.0.0.1');
    baseUrl = (await app.getUrl()).replace('[::1]', '127.0.0.1');
    users = moduleFixture.get(getRepositoryToken(User));
    groups = moduleFixture.get(getRepositoryToken(Group));
    storage = moduleFixture.get(StorageService);

    alice = await registerUser('alice');
    bob = await registerUser('bob');
    dave = await registerUser('dave');
    carol = await registerUser('carol');

    const group = await http()
      .post('/groups')
      .set(as(alice))
      .send({ name: 'Spiti Circuit 2026', description: 'd', tripStart: '2026-10-10T00:00:00Z', tripEnd: '2026-10-19T00:00:00Z' })
      .expect(201);
    groupId = group.body.id;
    await http().post(url('/members')).set(as(alice)).send({ username: bob.username }).expect(201);
    await http().post(url('/members')).set(as(alice)).send({ username: dave.username }).expect(201);

    for (const u of [alice, bob, dave, carol]) await connect(u);
  });

  afterAll(async () => {
    sockets.forEach((s) => s.disconnect());
    delete process.env.PRESENCE_OFFLINE_GRACE_MS;
    if (userIds.length) {
      if (groupId) await storage.deletePrefix(`voice/${groupId}`); // deleting rows directly skips the files
      await groups.delete({ createdById: In(userIds) });
      await users.delete({ id: In(userIds) });
    }
    await app.close();
  });

  describe('presence', () => {
    it('shows who is online, members only', async () => {
      await http().get(url('/presence')).set(as(carol)).expect(404);
      const res = await http().get(url('/presence')).set(as(bob)).expect(200);
      expect(res.body).toHaveLength(3);
      expect(res.body.every((p: { online: boolean }) => p.online)).toBe(true);
    });

    it('announces offline (after the grace period) and online again to co-members only', async () => {
      const aliceHearsOffline = waitFor<{ userId: string; online: boolean; lastSeenAt: string }>(
        alice.socket!,
        'presence:updated',
        (p) => p.userId === dave.id && !p.online,
      );
      const carolHears = receives(carol.socket!, 'presence:updated', (p) => p.userId === dave.id, OFFLINE_GRACE_MS + 400);
      dave.socket!.disconnect();

      const offline = await aliceHearsOffline;
      expect(offline.lastSeenAt).toBeTruthy();
      expect(await carolHears).toBe(false);

      const res = await http().get(url('/presence')).set(as(alice)).expect(200);
      const daveNow = res.body.find((p: { userId: string }) => p.userId === dave.id);
      expect(daveNow).toMatchObject({ online: false, username: dave.username });
      expect(daveNow.lastSeenAt).toBeTruthy();
      expect(res.body[res.body.length - 1].userId).toBe(dave.id); // online members first

      const aliceHearsOnline = waitFor(alice.socket!, 'presence:updated', (p) => p.userId === dave.id && p.online === true);
      await connect(dave);
      await aliceHearsOnline;
    });

    it('does not flash offline when a device reconnects within the grace period', async () => {
      const flapped = receives(alice.socket!, 'presence:updated', (p) => p.userId === bob.id, OFFLINE_GRACE_MS + 400);
      bob.socket!.disconnect();
      await connect(bob);
      expect(await flapped).toBe(false);
    });
  });

  describe('chat', () => {
    let firstId: string;

    it('validates socket payloads and hides the group from non-members', async () => {
      expect(await emit(bob.socket!, 'chat:send', 'hello')).toMatchObject({ ok: false, error: { status: 400 } });
      expect(await emit(bob.socket!, 'chat:send', { groupId, body: '   ' })).toMatchObject({
        ok: false,
        error: { status: 400, message: 'body is required' },
      });
      expect(await emit(bob.socket!, 'chat:send', { groupId, body: 'x'.repeat(2001) })).toMatchObject({
        ok: false,
        error: { status: 400, message: 'body must be at most 2000 characters' },
      });
      expect(await emit(bob.socket!, 'chat:send', { groupId: 'nope', body: 'hi' })).toMatchObject({
        ok: false,
        error: { status: 400, message: 'groupId must be a UUID' },
      });
      expect(await emit(carol.socket!, 'chat:send', { groupId, body: 'let me in' })).toMatchObject({
        ok: false,
        error: { status: 404, message: 'Group not found' },
      });
    });

    it('delivers a message live to members only, acked to the sender', async () => {
      const aliceHears = waitFor<{ id: string; body: string }>(alice.socket!, 'chat:message');
      const carolHears = receives(carol.socket!, 'chat:message');

      const ack = await emit<{ id: string; body: string; sender: { userId: string }; clientMsgId: string; type: string }>(
        bob.socket!,
        'chat:send',
        { groupId, body: '  Reached Kaza, fuel up here  ', clientMsgId: 'bob-1' },
      );
      expect(ack.ok).toBe(true);
      expect(ack.data).toMatchObject({ body: 'Reached Kaza, fuel up here', type: 'NORMAL', clientMsgId: 'bob-1', groupId });
      expect(ack.data!.sender.userId).toBe(bob.id);
      firstId = ack.data!.id;

      expect((await aliceHears).id).toBe(firstId);
      expect(await carolHears).toBe(false);
    });

    it('returns the original message when the same clientMsgId is resent, without re-broadcasting', async () => {
      const aliceHears = receives(alice.socket!, 'chat:message');
      const again = await emit<{ id: string }>(bob.socket!, 'chat:send', { groupId, body: 'Reached Kaza, fuel up here', clientMsgId: 'bob-1' });
      expect(again.data!.id).toBe(firstId);
      expect(await aliceHears).toBe(false);
    });

    it('relays typing to the rest of the group, not back to the typist', async () => {
      const aliceHears = waitFor<{ userId: string; isTyping: boolean; name: string }>(alice.socket!, 'chat:typing');
      const bobHears = receives(bob.socket!, 'chat:typing');
      expect(await emit(bob.socket!, 'chat:typing', { groupId, isTyping: true })).toMatchObject({ ok: true });
      expect(await aliceHears).toMatchObject({ userId: bob.id, isTyping: true, name: bob.name });
      expect(await bobHears).toBe(false);
      expect(await emit(carol.socket!, 'chat:typing', { groupId, isTyping: true })).toMatchObject({ ok: false, error: { status: 404 } });
      expect(await emit(bob.socket!, 'chat:typing', { groupId, isTyping: 'yes' })).toMatchObject({ ok: false, error: { status: 400 } });
    });

    it('pushes chat messages only to members who are offline', async () => {
      const daveOffline = waitFor(alice.socket!, 'presence:updated', (p) => p.userId === dave.id && p.online === false);
      dave.socket!.disconnect();
      await daveOffline;

      pushes.length = 0;
      await emit(alice.socket!, 'chat:send', { groupId, body: 'Leaving for Chandratal at 7' });
      await sleep(100);
      expect(pushesTo(dave.id, 'CHAT_MESSAGE')).toHaveLength(1);
      expect(pushesTo(dave.id, 'CHAT_MESSAGE')[0].message).toMatchObject({ title: 'Spiti Circuit 2026' });
      expect(pushesTo(dave.id, 'CHAT_MESSAGE')[0].message.body).toContain('E2E alice: Leaving for Chandratal');
      expect(pushesTo(bob.id, 'CHAT_MESSAGE')).toHaveLength(0);
      expect(pushesTo(alice.id, 'CHAT_MESSAGE')).toHaveLength(0);

      await connect(dave);
    });

    it('tracks read receipts with forward-only read markers', async () => {
      // Sending counts as reading: alice has read everything so far, bob and dave have not read her message.
      const unreadBefore = await http().get(url('/messages/unread')).set(as(dave)).expect(200);
      expect(unreadBefore.body.unreadCount).toBe(2);

      const history = await http().get(url('/messages')).set(as(bob)).expect(200);
      const [bobsMsg, alicesMsg] = history.body.items;
      expect(bobsMsg.readByCount).toBe(1); // alice
      expect(alicesMsg.readByCount).toBe(0);

      const bobHearsRead = waitFor<{ userId: string; lastReadMessageId: string }>(bob.socket!, 'chat:read', (p) => p.userId === dave.id);
      const ack = await emit<{ unreadCount: number }>(dave.socket!, 'chat:read', { groupId, messageId: alicesMsg.id });
      expect(ack).toMatchObject({ ok: true, data: { unreadCount: 0, lastReadMessageId: alicesMsg.id } });
      expect(await bobHearsRead).toMatchObject({ lastReadMessageId: alicesMsg.id });

      // Moving back to an older message changes nothing.
      const nothing = receives(bob.socket!, 'chat:read', (p) => p.userId === dave.id);
      await http().post(url('/messages/read')).set(as(dave)).send({ messageId: bobsMsg.id }).expect(200);
      expect(await nothing).toBe(false);

      const reads = await http().get(url(`/messages/${alicesMsg.id}/reads`)).set(as(alice)).expect(200);
      expect(reads.body.readBy.map((u: { userId: string }) => u.userId)).toEqual([dave.id]);
      expect(reads.body.notReadYet.map((u: { userId: string }) => u.userId)).toEqual([bob.id]);

      await http().post(url('/messages/read')).set(as(dave)).send({ messageId: randomUUID() }).expect(404);
      await http().get(url('/messages/not-a-uuid/reads')).set(as(dave)).expect(400);
      expect(await emit(carol.socket!, 'chat:read', { groupId, messageId: alicesMsg.id })).toMatchObject({ ok: false, error: { status: 404 } });
    });

    it('pages history backwards and searches it', async () => {
      for (const body of ['Tea at Losar', '50% of the road is gravel', 'Photo stop at Key Monastery']) {
        await emit(bob.socket!, 'chat:send', { groupId, body });
      }
      const page1 = await http().get(url('/messages')).query({ limit: 2 }).set(as(alice)).expect(200);
      expect(page1.body.items.map((m: { body: string }) => m.body)).toEqual(['50% of the road is gravel', 'Photo stop at Key Monastery']);
      expect(page1.body.nextBefore).toBe(page1.body.items[0].id);

      const page2 = await http().get(url('/messages')).query({ limit: 2, before: page1.body.nextBefore }).set(as(alice)).expect(200);
      expect(page2.body.items.map((m: { body: string }) => m.body)).toEqual(['Leaving for Chandratal at 7', 'Tea at Losar']);

      const search = await http().get(url('/messages')).query({ search: 'KAZA' }).set(as(alice)).expect(200);
      expect(search.body.items.map((m: { id: string }) => m.id)).toEqual([firstId]);
      const literal = await http().get(url('/messages')).query({ search: '50%' }).set(as(alice)).expect(200);
      expect(literal.body.items).toHaveLength(1); // `%` is matched literally, not as a wildcard

      await http().get(url('/messages')).query({ search: 'x' }).set(as(alice)).expect(400);
      await http().get(url('/messages')).query({ before: randomUUID() }).set(as(alice)).expect(400);
      await http().get(url('/messages')).set(as(carol)).expect(404);
    });
  });

  describe('location and voice messages (change request v1.0, change 8)', () => {
    // A tiny M4A header (ftyp M4A + an audio `hdlr`), and the same with a video track.
    const box = (type: string, body: Buffer) => {
      const head = Buffer.alloc(8);
      head.writeUInt32BE(8 + body.length, 0);
      head.write(type, 4, 'latin1');
      return Buffer.concat([head, body]);
    };
    const hdlr = (handler: string) => box('hdlr', Buffer.concat([Buffer.alloc(8), Buffer.from(handler, 'latin1'), Buffer.alloc(12)]));
    const ftyp = box('ftyp', Buffer.from('M4A \0\0\0\0M4A isom', 'latin1'));
    const m4a = Buffer.concat([ftyp, box('moov', hdlr('soun')), Buffer.alloc(256, 7)]);
    const mp4Video = Buffer.concat([ftyp, box('moov', Buffer.concat([hdlr('vide'), hdlr('soun')]))]);

    it('shares a location in chat, with an optional caption', async () => {
      const bobHears = waitFor<Record<string, any>>(bob.socket!, 'chat:message', (p) => p.kind === 'LOCATION');
      const ack = await emit<Record<string, any>>(alice.socket!, 'chat:send', {
        groupId,
        kind: 'LOCATION',
        location: { lat: 32.2276, lng: 78.0716, accuracy: 8, label: 'Kaza petrol pump' },
      });
      expect(ack).toMatchObject({ ok: true, data: { kind: 'LOCATION', body: '', voice: null } });
      expect(ack.data!.location).toMatchObject({ lat: 32.2276, lng: 78.0716, accuracy: 8, label: 'Kaza petrol pump', source: 'DEVICE' });
      expect((await bobHears).location.label).toBe('Kaza petrol pump');

      expect(await emit(alice.socket!, 'chat:send', { groupId, kind: 'LOCATION' })).toMatchObject({
        ok: false,
        error: { status: 400, message: 'location is required for a LOCATION message' },
      });
      expect(await emit(alice.socket!, 'chat:send', { groupId, kind: 'LOCATION', location: { lat: 95, lng: 1 } })).toMatchObject({
        ok: false,
        error: { status: 400, message: 'location.lat must be a valid latitude' },
      });
      expect(await emit(alice.socket!, 'chat:send', { groupId, kind: 'VOICE', body: 'x' })).toMatchObject({ ok: false, error: { status: 400 } });
      expect(await emit(alice.socket!, 'chat:send', { groupId, body: 'hi', location: { lat: 1, lng: 1 } })).toMatchObject({
        ok: false,
        error: { status: 400, message: 'location is only for LOCATION messages (send kind: "LOCATION")' },
      });
    });

    it('sends a voice message over HTTP and plays it back to members', async () => {
      const bobHears = waitFor<Record<string, any>>(bob.socket!, 'chat:message', (p) => p.kind === 'VOICE');
      pushes.length = 0;
      const clientMsgId = randomUUID();
      const res = await http()
        .post(url('/messages/voice'))
        .set(as(dave))
        .field('durationMs', '14500')
        .field('clientMsgId', clientMsgId)
        .attach('file', m4a, 'note.m4a')
        .expect(201);
      expect(res.body).toMatchObject({ kind: 'VOICE', body: '', voice: { durationMs: 14500, contentType: 'audio/mp4' }, clientMsgId });
      expect((await bobHears).id).toBe(res.body.id);

      const retry = await http().post(url('/messages/voice')).set(as(dave)).field('durationMs', '14500').field('clientMsgId', clientMsgId).attach('file', m4a, 'note.m4a').expect(201);
      expect(retry.body.id).toBe(res.body.id);

      const audio = await http().get(url(`/messages/${res.body.id}/voice`)).set(as(bob)).buffer(true).expect(200);
      expect(audio.headers['content-type']).toBe('audio/mp4');
      expect(Buffer.compare(audio.body as Buffer, m4a)).toBe(0);
      await http().get(url(`/messages/${res.body.id}/voice`)).set(as(carol)).expect(404);
      await http().get(url(`/messages/${randomUUID()}/voice`)).set(as(bob)).expect(404);
    });

    it('refuses anything that is not a short audio recording', async () => {
      const send = (file: Buffer, durationMs = '1000') =>
        http().post(url('/messages/voice')).set(as(bob)).field('durationMs', durationMs).attach('file', file, 'clip.m4a');
      await send(mp4Video).expect(415); // a video in disguise
      await send(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)])).expect(415); // a PNG
      await send(m4a, '130000').expect(400); // over 2 minutes
      await send(Buffer.concat([m4a, Buffer.alloc(2 * 1024 * 1024)])).expect(413);
      await http().post(url('/messages/voice')).set(as(bob)).field('durationMs', '1000').expect(400); // no file
      await http().post(url('/messages/voice')).set(as(carol)).field('durationMs', '1000').attach('file', m4a, 'a.m4a').expect(404);
    });

    describe('replies, deleting and forwarding (frontend request 2026-10-27)', () => {
      let otherGroupId: string; // alice + carol: where messages get forwarded to
      const send = (u: TestUser, payload: Record<string, unknown>, gid = groupId) =>
        emit<Record<string, any>>(u.socket!, 'chat:send', { groupId: gid, ...payload });

      beforeAll(async () => {
        const other = await http()
          .post('/groups')
          .set(as(alice))
          .send({ name: 'Forward target', description: 'd', tripStart: '2026-11-01T00:00:00Z', tripEnd: '2026-11-05T00:00:00Z' })
          .expect(201);
        otherGroupId = other.body.id;
        await http().post(`/groups/${otherGroupId}/members`).set(as(alice)).send({ username: carol.username }).expect(201);
      });

      afterAll(async () => {
        if (otherGroupId) await storage.deletePrefix(`voice/${otherGroupId}`);
      });

      it('replies to a message in the same group, quoting it', async () => {
        const original = await send(bob, { body: 'Fuel at Tabo?' });
        const reply = await send(alice, { body: 'Yes, fill up there', replyToMessageId: original.data!.id });
        expect(reply).toMatchObject({ ok: true, data: { forwarded: false, deletedAt: null } });
        expect(reply.data!.replyTo).toEqual({
          id: original.data!.id,
          sender: expect.objectContaining({ userId: bob.id }),
          type: 'NORMAL',
          kind: 'TEXT',
          preview: 'Fuel at Tabo?',
          deleted: false,
        });
        expect((await send(bob, { body: 'plain' })).data!.replyTo).toBeNull();

        const voice = await http()
          .post(url('/messages/voice'))
          .set(as(bob))
          .field('durationMs', '3000')
          .field('replyToMessageId', reply.data!.id)
          .attach('file', m4a, 'r.m4a')
          .expect(201);
        expect(voice.body.replyTo).toMatchObject({ id: reply.data!.id, preview: 'Yes, fill up there' });

        const elsewhere = await send(alice, { body: 'other trip' }, otherGroupId);
        expect(await send(alice, { body: 'x', replyToMessageId: elsewhere.data!.id })).toMatchObject({
          ok: false,
          error: { status: 400, message: 'replyToMessageId must be a message in this group' },
        });
        expect(await send(alice, { body: 'x', replyToMessageId: 'nope' })).toMatchObject({ ok: false, error: { status: 400 } });
      });

      it('lets only the sender delete a message; it stays as "deleted" and the group is told live', async () => {
        const original = await send(bob, { body: 'Wrong group, sorry' });
        const reply = await send(alice, { body: 'np', replyToMessageId: original.data!.id });
        const id = original.data!.id;

        await http().delete(url(`/messages/${id}`)).set(as(alice)).expect(403);
        await http().delete(url(`/messages/${id}`)).set(as(carol)).expect(404);
        await http().delete(url(`/messages/${randomUUID()}`)).set(as(bob)).expect(404);

        const aliceHears = waitFor<Record<string, any>>(alice.socket!, 'chat:message_deleted', (p) => p.messageId === id);
        const carolHears = receives(carol.socket!, 'chat:message_deleted');
        const res = await http().delete(url(`/messages/${id}`)).set(as(bob)).expect(200);
        expect(res.body).toMatchObject({ id, body: '', location: null, voice: null, deletedAt: expect.any(String) });
        expect(await aliceHears).toEqual({ groupId, messageId: id, deletedAt: res.body.deletedAt });
        expect(await carolHears).toBe(false);

        // Deleting again changes nothing and isn't announced again.
        const again = receives(alice.socket!, 'chat:message_deleted', (p) => p.messageId === id);
        expect((await http().delete(url(`/messages/${id}`)).set(as(bob)).expect(200)).body.deletedAt).toBe(res.body.deletedAt);
        expect(await again).toBe(false);

        const history = await http().get(url('/messages')).set(as(dave)).expect(200);
        const items = history.body.items as Record<string, any>[];
        expect(items.find((m) => m.id === id)).toMatchObject({ body: '', deletedAt: res.body.deletedAt });
        expect(items.find((m) => m.id === reply.data!.id)!.replyTo).toMatchObject({ id, preview: '', deleted: true });
        expect((await http().get(url('/messages?search=Wrong%20group')).set(as(dave)).expect(200)).body.items).toHaveLength(0);

        expect(await send(alice, { body: 'x', replyToMessageId: id })).toMatchObject({ ok: false, error: { status: 400 } });
        expect(await send(alice, { forwardFromMessageId: id }, otherGroupId)).toMatchObject({ ok: false, error: { status: 400 } });
      });

      it('does not delete alerts', async () => {
        const alert = await http().post(url('/alerts')).set(as(alice)).send({ type: 'GENERAL', body: 'Briefing at 7' }).expect(201);
        await http().delete(url(`/messages/${alert.body.id}`)).set(as(alice)).expect(400);
      });

      it('deletes a voice message’s recording', async () => {
        const voice = await http().post(url('/messages/voice')).set(as(bob)).field('durationMs', '2000').attach('file', m4a, 'v.m4a').expect(201);
        await http().get(url(`/messages/${voice.body.id}/voice`)).set(as(alice)).expect(200);
        await http().delete(url(`/messages/${voice.body.id}`)).set(as(bob)).expect(200);
        await http().get(url(`/messages/${voice.body.id}/voice`)).set(as(alice)).expect(404);
      });

      it('forwards a copy into another group the sender is in, marked as forwarded', async () => {
        const original = await send(bob, { kind: 'LOCATION', location: { lat: 32.09, lng: 78.38, label: 'Tabo monastery' }, body: 'meet here' });
        const carolHears = waitFor<Record<string, any>>(carol.socket!, 'chat:message', (p) => p.forwarded === true);
        const fwd = await send(alice, { forwardFromMessageId: original.data!.id, clientMsgId: randomUUID() }, otherGroupId);
        expect(fwd).toMatchObject({
          ok: true,
          data: { groupId: otherGroupId, kind: 'LOCATION', body: 'meet here', forwarded: true, replyTo: null, sender: { userId: alice.id } },
        });
        expect(fwd.data!.location).toMatchObject({ lat: 32.09, lng: 78.38, label: 'Tabo monastery' });
        expect((await carolHears).id).toBe(fwd.data!.id);

        // Only from a group the sender is in, only chat messages, and nothing else in the payload.
        expect(await send(carol, { forwardFromMessageId: original.data!.id }, otherGroupId)).toMatchObject({
          ok: false,
          error: { status: 404, message: 'Message to forward not found' },
        });
        expect(await send(alice, { forwardFromMessageId: original.data!.id, body: 'extra' }, otherGroupId)).toMatchObject({
          ok: false,
          error: { status: 400 },
        });
        const alert = await http().post(url('/alerts')).set(as(alice)).send({ type: 'GENERAL', body: 'Regroup' }).expect(201);
        expect(await send(alice, { forwardFromMessageId: alert.body.id }, otherGroupId)).toMatchObject({ ok: false, error: { status: 400 } });
      });

      it('forwards a voice message as its own copy, which outlives the original', async () => {
        const voice = await http().post(url('/messages/voice')).set(as(alice)).field('durationMs', '4200').attach('file', m4a, 'f.m4a').expect(201);
        const fwd = await send(alice, { forwardFromMessageId: voice.body.id }, otherGroupId);
        expect(fwd).toMatchObject({ ok: true, data: { kind: 'VOICE', forwarded: true, voice: { durationMs: 4200, contentType: 'audio/mp4' } } });

        await http().delete(url(`/messages/${voice.body.id}`)).set(as(alice)).expect(200);
        const audio = await http().get(`/groups/${otherGroupId}/messages/${fwd.data!.id}/voice`).set(as(carol)).buffer(true).expect(200);
        expect(Buffer.compare(audio.body as Buffer, m4a)).toBe(0);
      });
    });
  });

  describe('alerts & SOS', () => {
    let criticalId: string;
    let sosId: string;

    it('lets only admins send GENERAL / CRITICAL alerts, with a category for CRITICAL', async () => {
      await http().post(url('/alerts')).set(as(bob)).send({ type: 'CRITICAL', category: 'WEATHER', body: 'Snow' }).expect(403);
      await http().post(url('/alerts')).set(as(alice)).send({ type: 'CRITICAL', body: 'Snow' }).expect(400);
      await http().post(url('/alerts')).set(as(alice)).send({ type: 'GENERAL', category: 'WEATHER', body: 'Hi' }).expect(400);
      await http().post(url('/alerts')).set(as(alice)).send({ type: 'SOS', body: 'no' }).expect(400);
      await http().post(url('/alerts')).set(as(carol)).send({ type: 'GENERAL', body: 'Hi' }).expect(404);
    });

    it('broadcasts a critical alert as a banner + timeline message and pushes it to everyone else', async () => {
      pushes.length = 0;
      const bobBanner = waitFor<{ id: string; type: string }>(bob.socket!, 'alert:raised');
      const bobTimeline = waitFor<{ id: string }>(bob.socket!, 'chat:message');
      const res = await http()
        .post(url('/alerts'))
        .set(as(alice))
        .send({ type: 'CRITICAL', category: 'ROAD_CLOSURE', body: 'Kunzum La closed, stay in Kaza tonight' })
        .expect(201);
      criticalId = res.body.id;
      expect(res.body).toMatchObject({
        type: 'CRITICAL',
        category: 'ROAD_CLOSURE',
        alert: { requiresAck: true, active: true, ackCount: 0, pendingCount: 2, resolvedAt: null },
      });
      expect((await bobBanner).id).toBe(criticalId);
      expect((await bobTimeline).id).toBe(criticalId);

      await sleep(100);
      // Alerts push to online members too (bob and dave are connected).
      expect(pushesTo(bob.id, 'CRITICAL_ALERT')).toHaveLength(1);
      expect(pushesTo(dave.id, 'CRITICAL_ALERT')[0].message).toMatchObject({ title: 'Critical alert: Spiti Circuit 2026' });
      expect(pushesTo(alice.id, 'CRITICAL_ALERT')).toHaveLength(0);
    });

    it('lets any member raise an SOS with device coordinates; a second tap returns the same SOS', async () => {
      await http().post(url('/alerts/sos')).set(as(bob)).send({ lat: 32.2 }).expect(400);
      pushes.length = 0;
      const aliceBanner = waitFor<{ id: string; type: string }>(alice.socket!, 'alert:raised', (p) => p.type === 'SOS');

      const res = await http()
        .post(url('/alerts/sos'))
        .set(as(bob))
        .send({ body: 'Bike skidded near Losar, ankle hurt', lat: 32.437, lng: 77.749, accuracy: 15 })
        .expect(201);
      sosId = res.body.id;
      expect(res.body).toMatchObject({
        type: 'SOS',
        body: 'Bike skidded near Losar, ankle hurt',
        location: { lat: 32.437, lng: 77.749, accuracy: 15, source: 'DEVICE' },
        alert: { active: true, pendingCount: 2 },
      });
      expect((await aliceBanner).id).toBe(sosId);

      await sleep(100);
      expect(pushesTo(alice.id, 'SOS')[0].message).toMatchObject({
        title: 'SOS from E2E bob',
        body: 'Spiti Circuit 2026: Bike skidded near Losar, ankle hurt',
        data: { lat: '32.437', lng: '77.749', alertId: sosId },
      });
      expect(pushesTo(dave.id, 'SOS')).toHaveLength(1);

      const again = await http().post(url('/alerts/sos')).set(as(bob)).send({}).expect(201);
      expect(again.body.id).toBe(sosId);
    });

    it('uses a default message and no location when the device sends none and live location is off', async () => {
      const res = await http().post(url('/alerts/sos')).set(as(dave)).send({}).expect(201);
      expect(res.body).toMatchObject({ type: 'SOS', body: 'SOS: I need help', location: null });
      await http().post(url(`/alerts/${res.body.id}/resolve`)).set(as(dave)).expect(200);
    });

    it('collects acknowledgements and tells the SOS sender', async () => {
      await http().post(url(`/alerts/${sosId}/ack`)).set(as(bob)).expect(400); // own alert
      pushes.length = 0;
      const bobHears = waitFor<{ alertId: string; userId: string; ackCount: number; pendingCount: number }>(
        bob.socket!,
        'alert:acknowledged',
      );
      const res = await http().post(url(`/alerts/${sosId}/ack`)).set(as(alice)).expect(200);
      expect(res.body.alert).toMatchObject({ ackCount: 1, pendingCount: 1, acknowledgedByMe: true });
      expect(await bobHears).toMatchObject({ alertId: sosId, userId: alice.id, ackCount: 1, pendingCount: 1 });

      await sleep(100);
      expect(pushesTo(bob.id, 'SOS_ACKNOWLEDGED')[0].message).toMatchObject({ title: 'E2E alice saw your SOS' });

      // Idempotent: no second event.
      const again = receives(bob.socket!, 'alert:acknowledged');
      await http().post(url(`/alerts/${sosId}/ack`)).set(as(alice)).expect(200);
      expect(await again).toBe(false);

      const detail = await http().get(url(`/alerts/${sosId}`)).set(as(dave)).expect(200);
      expect(detail.body.acknowledgements.map((a: { userId: string }) => a.userId)).toEqual([alice.id]);
      expect(detail.body.acknowledgements[0].ackedAt).toBeTruthy();
      expect(detail.body.pending.map((u: { userId: string }) => u.userId)).toEqual([dave.id]);
      expect(detail.body.alert.acknowledgedByMe).toBe(false);
    });

    it('does not take acks on GENERAL alerts, and 404s unknown alerts', async () => {
      const general = await http().post(url('/alerts')).set(as(alice)).send({ type: 'GENERAL', body: 'Dinner at 8, Hotel Deyzor' }).expect(201);
      expect(general.body.alert).toMatchObject({ requiresAck: false, active: false, pendingCount: 0 });
      await http().post(url(`/alerts/${general.body.id}/ack`)).set(as(bob)).expect(400);
      await http().post(url(`/alerts/${general.body.id}/resolve`)).set(as(alice)).expect(400);
      await http().get(url(`/alerts/${randomUUID()}`)).set(as(bob)).expect(404);
      await http().get(url('/alerts/not-a-uuid')).set(as(bob)).expect(400);
      // A chat message isn't an alert.
      const msgs = await http().get(url('/messages')).query({ search: 'Kaza, fuel' }).set(as(bob)).expect(200);
      await http().get(url(`/alerts/${msgs.body.items[0].id}`)).set(as(bob)).expect(404);
    });

    it('lists active banners and resolves them with the right permissions', async () => {
      const active = await http().get(url('/alerts')).query({ active: true }).set(as(dave)).expect(200);
      expect(active.body.items.map((a: { id: string }) => a.id)).toEqual([sosId, criticalId]);

      await http().post(url(`/alerts/${sosId}/resolve`)).set(as(dave)).expect(403); // not sender, not admin
      const aliceHears = waitFor<{ alertId: string; resolvedBy: { userId: string } }>(alice.socket!, 'alert:resolved');
      pushes.length = 0;
      const resolved = await http().post(url(`/alerts/${sosId}/resolve`)).set(as(bob)).expect(200);
      expect(resolved.body.alert).toMatchObject({ active: false, resolvedBy: { userId: bob.id } });
      expect(await aliceHears).toMatchObject({ alertId: sosId, resolvedBy: { userId: bob.id } });
      await sleep(100);
      expect(pushesTo(alice.id, 'SOS_RESOLVED')[0].message).toMatchObject({ title: 'E2E bob is safe' });
      expect(pushesTo(bob.id, 'SOS_RESOLVED')).toHaveLength(0);

      // Resolving twice changes nothing.
      const again = await http().post(url(`/alerts/${sosId}/resolve`)).set(as(bob)).expect(200);
      expect(again.body.alert.resolvedAt).toBe(resolved.body.alert.resolvedAt);

      await http().post(url(`/alerts/${criticalId}/resolve`)).set(as(bob)).expect(403); // admins only
      await http().post(url(`/alerts/${criticalId}/resolve`)).set(as(alice)).expect(200);

      const nowActive = await http().get(url('/alerts')).query({ active: true }).set(as(dave)).expect(200);
      expect(nowActive.body.items).toHaveLength(0);

      const all = await http().get(url('/alerts')).query({ limit: 2 }).set(as(dave)).expect(200);
      expect(all.body.items).toHaveLength(2);
      expect(all.body.nextBefore).toBeTruthy();
      const sosOnly = await http().get(url('/alerts')).query({ type: 'SOS' }).set(as(dave)).expect(200);
      expect(sosOnly.body.items.every((a: { type: string }) => a.type === 'SOS')).toBe(true);
    });

    it('shows alerts in the chat timeline', async () => {
      const history = await http().get(url('/messages')).set(as(bob)).expect(200);
      const types = history.body.items.map((m: { type: string }) => m.type);
      expect(types).toEqual(expect.arrayContaining(['NORMAL', 'CRITICAL', 'SOS', 'GENERAL']));
    });

    it('pushes NEED_HELP status to the rest of the group', async () => {
      pushes.length = 0;
      await http().post(url('/status')).set(as(dave)).send({ status: 'NEED_HELP', note: 'Puncture at Kaza bridge' }).expect(201);
      await sleep(100);
      expect(pushesTo(alice.id, 'STATUS_NEED_HELP')[0].message).toMatchObject({
        title: 'E2E dave needs help',
        body: 'Spiti Circuit 2026: Puncture at Kaza bridge',
      });
      expect(pushesTo(bob.id, 'STATUS_NEED_HELP')).toHaveLength(1);
      expect(pushesTo(dave.id, 'STATUS_NEED_HELP')).toHaveLength(0);
    });
  });

  it('cuts a removed member off immediately', async () => {
    await http().delete(url(`/members/${dave.id}`)).set(as(alice)).expect(200);
    const daveHears = receives(dave.socket!, 'chat:message');
    await emit(bob.socket!, 'chat:send', { groupId, body: 'Dave went home' });
    expect(await daveHears).toBe(false);
    expect(await emit(dave.socket!, 'chat:send', { groupId, body: 'still here?' })).toMatchObject({ ok: false, error: { status: 404 } });
    await http().get(url('/messages')).set(as(dave)).expect(404);
    await http().post(url('/alerts/sos')).set(as(dave)).send({}).expect(404);
  });
});
