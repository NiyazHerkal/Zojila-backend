import { randomUUID } from 'node:crypto';
import { existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import { In, Repository } from 'typeorm';
import { AppModule } from './../src/app.module.js';
import { Group, User } from './../src/database/entities/index.js';
import { InviteDeliveryService } from './../src/notifications/invite-delivery.service.js';
import { OtpDeliveryService } from './../src/notifications/otp-delivery.service.js';

// Phase 4 DoD against the real dev Postgres: a group can be created, populated with members
// (direct add, email/SMS invite, share link) and role-managed.
describe('Groups & membership (e2e)', () => {
  let app: INestApplication;
  let users: Repository<User>;
  let groups: Repository<Group>;
  const otpCodes = new Map<string, string>();
  const invitesSent: { to: string; text: string }[] = [];

  const suffix = randomUUID().slice(0, 8);
  const password = 'Str0ng!Pass';
  const randomPhone = () => `+9198${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;

  interface TestUser {
    id: string;
    username: string;
    email: string;
    phone: string;
    token: string;
  }
  const userIds: string[] = [];
  let alice: TestUser; // group creator / admin
  let bob: TestUser; // added directly
  let carol: TestUser; // invited by email, later via link
  let dave: TestUser; // outsider, invited by SMS

  const http = () => request(app.getHttpServer());
  const as = (u: TestUser) => ({ Authorization: `Bearer ${u.token}` });

  async function registerUser(label: string): Promise<TestUser> {
    const email = `groups-e2e.${label}.${suffix}@example.com`; // not `e2e.%` — auth suite cleanup matches that
    const phone = randomPhone();
    const username = `${label}_${suffix}`;
    const signup = await http()
      .post('/auth/signup')
      .send({ email, phone, username, password, name: `E2E ${label}` })
      .expect(201);
    const verified = await http()
      .post('/auth/verify')
      .send({ userId: signup.body.userId, code: otpCodes.get(email) })
      .expect(201);
    userIds.push(signup.body.userId);
    return { id: signup.body.userId, username, email, phone, token: verified.body.accessToken };
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(OtpDeliveryService)
      .useValue({
        sendEmail: async (to: string, code: string) => void otpCodes.set(to, code),
        sendSms: async (to: string, code: string) => void otpCodes.set(to, code),
      })
      .overrideProvider(InviteDeliveryService)
      .useValue({
        sendEmail: async (to: string, _subject: string, text: string) => void invitesSent.push({ to, text }),
        sendSms: async (to: string, text: string) => void invitesSent.push({ to, text }),
      })
      .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    users = moduleFixture.get(getRepositoryToken(User));
    groups = moduleFixture.get(getRepositoryToken(Group));

    alice = await registerUser('alice');
    bob = await registerUser('bob');
    carol = await registerUser('carol');
    dave = await registerUser('dave');
  });

  afterAll(async () => {
    if (userIds.length) {
      await groups.delete({ createdById: In(userIds) });
      await users.delete({ id: In(userIds) });
    }
    await app.close();
  });

  let groupId: string;
  const trip = { tripStart: '2026-10-10T00:00:00Z', tripEnd: '2026-10-19T00:00:00Z' };

  it('validates and creates a group; the creator is its admin', async () => {
    await http().post('/groups').send({ name: 'x', description: 'y', ...trip }).expect(401);
    await http().post('/groups').set(as(alice)).send({ name: 'No description', ...trip }).expect(400);
    await http()
      .post('/groups')
      .set(as(alice))
      .send({ name: 'Backwards', description: 'd', tripStart: trip.tripEnd, tripEnd: trip.tripStart })
      .expect(400);

    const res = await http()
      .post('/groups')
      .set(as(alice))
      .send({ name: 'Ladakh Ride', description: 'Manali to Leh', ...trip })
      .expect(201);
    expect(res.body).toMatchObject({ name: 'Ladakh Ride', myRole: 'ADMIN', memberCount: 1, createdById: alice.id, coverImageUrl: null });
    groupId = res.body.id;

    const mine = await http().get('/groups').set(as(alice)).expect(200);
    expect(mine.body.map((g: { id: string }) => g.id)).toContain(groupId);
  });

  it('hides the group from non-members (404, including malformed ids)', async () => {
    await http().get(`/groups/${groupId}`).set(as(bob)).expect(404);
    await http().get('/groups/not-a-uuid').set(as(alice)).expect(404);
    const mine = await http().get('/groups').set(as(bob)).expect(200);
    expect(mine.body.map((g: { id: string }) => g.id)).not.toContain(groupId);
  });

  it('adds a registered user directly by email', async () => {
    await http()
      .post(`/groups/${groupId}/members`)
      .set(as(alice))
      .send({ email: `nobody.${suffix}@example.com` })
      .expect(404);

    const res = await http()
      .post(`/groups/${groupId}/members`)
      .set(as(alice))
      .send({ email: bob.email.toUpperCase() })
      .expect(201);
    expect(res.body).toMatchObject({ userId: bob.id, role: 'VIEWER' });

    await http().post(`/groups/${groupId}/members`).set(as(alice)).send({ phone: bob.phone }).expect(409);

    const group = await http().get(`/groups/${groupId}`).set(as(bob)).expect(200);
    expect(group.body).toMatchObject({ myRole: 'VIEWER', memberCount: 2 });
  });

  it('adds a registered user directly by username', async () => {
    await http()
      .post(`/groups/${groupId}/members`)
      .set(as(alice))
      .send({ username: `nobody_${suffix}` })
      .expect(404);
    await http().post(`/groups/${groupId}/members`).set(as(alice)).send({}).expect(400);

    const res = await http()
      .post(`/groups/${groupId}/members`)
      .set(as(alice))
      .send({ username: dave.username.toUpperCase() })
      .expect(201);
    expect(res.body).toMatchObject({ userId: dave.id, username: dave.username, role: 'VIEWER' });
    await http().post(`/groups/${groupId}/members`).set(as(alice)).send({ username: dave.username }).expect(409);

    // Taken usernames can't be claimed via profile update either.
    await http().patch('/auth/me').set(as(bob)).send({ username: alice.username }).expect(409);

    await http().delete(`/groups/${groupId}/members/${dave.id}`).set(as(alice)).expect(200);
  });

  it('lets only admins edit group details', async () => {
    await http().patch(`/groups/${groupId}`).set(as(bob)).send({ name: 'Hijack' }).expect(403);
    await http()
      .patch(`/groups/${groupId}`)
      .set(as(alice))
      .send({ tripEnd: '2026-10-01T00:00:00Z' })
      .expect(400);
    const res = await http()
      .patch(`/groups/${groupId}`)
      .set(as(alice))
      .send({ name: 'Ladakh Ride 2026', description: 'Manali → Leh → Pangong' })
      .expect(200);
    expect(res.body).toMatchObject({ name: 'Ladakh Ride 2026', description: 'Manali → Leh → Pangong' });
  });

  it('stores, replaces, serves and removes the cover image (admins only)', async () => {
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);
    const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 2)]);
    const pdf = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(64, 3)]);
    const url = `/groups/${groupId}/cover-image`;
    const coverFolder = resolve(process.env.UPLOAD_DIR || 'uploads', 'groups', groupId, 'cover');

    await http().get(url).set(as(bob)).expect(404);
    await http().post(url).set(as(bob)).attach('file', png, 'cover.png').expect(403);
    await http().post(url).set(as(alice)).expect(400);
    await http().post(url).set(as(alice)).attach('file', Buffer.from('just some text, not an image'), 'cover.jpg').expect(415);
    await http().post(url).set(as(alice)).attach('file', pdf, 'cover.pdf').expect(415); // fine for receipts, not covers
    await http()
      .post(url)
      .set(as(alice))
      .attach('file', Buffer.concat([png, Buffer.alloc(5 * 1024 * 1024)]), 'big.png')
      .expect(413);

    const first = await http().post(url).set(as(alice)).attach('file', png, 'cover.png').expect(200);
    expect(first.body).toMatchObject({ id: groupId, myRole: 'ADMIN' });
    expect(first.body.coverImageUrl).toMatch(new RegExp(`/groups/${groupId}/cover-image\\?v=[0-9a-f-]{36}$`));
    const seen = await http().get(`/groups/${groupId}`).set(as(bob)).expect(200);
    expect(seen.body.coverImageUrl).toBe(first.body.coverImageUrl);

    const file = await http().get(url).set(as(bob)).buffer(true).expect(200);
    expect(file.headers['content-type']).toBe('image/png');
    expect(file.headers['cache-control']).toBe('private, max-age=31536000, immutable');
    expect(Buffer.compare(file.body as Buffer, png)).toBe(0);

    // Replacing gives a new URL and leaves only the new file behind.
    const second = await http().post(url).set(as(alice)).attach('file', jpeg, 'cover.jpg').expect(200);
    expect(second.body.coverImageUrl).not.toBe(first.body.coverImageUrl);
    expect(readdirSync(coverFolder)).toHaveLength(1);
    const replaced = await http().get(url).set(as(bob)).buffer(true).expect(200);
    expect(replaced.headers['content-type']).toBe('image/jpeg');

    // A closed trip still shows its cover but can't change it.
    await http().post(`/groups/${groupId}/close`).set(as(alice)).expect(200);
    await http().get(url).set(as(bob)).expect(200);
    await http().post(url).set(as(alice)).attach('file', png, 'cover.png').expect(409);
    await http().delete(url).set(as(alice)).expect(409);
    await http().post(`/groups/${groupId}/reopen`).set(as(alice)).expect(200);

    await http().delete(url).set(as(bob)).expect(403);
    const removed = await http().delete(url).set(as(alice)).expect(200);
    expect(removed.body.coverImageUrl).toBeNull();
    expect(readdirSync(coverFolder)).toHaveLength(0);
    await http().get(url).set(as(bob)).expect(404);
    await http().delete(url).set(as(alice)).expect(200); // nothing to remove is fine

    // Leave one for the group-delete test to clean up.
    await http().post(url).set(as(alice)).attach('file', png, 'cover.png').expect(200);
  });

  it('changes roles, but never leaves the group without an admin', async () => {
    await http()
      .patch(`/groups/${groupId}/members/${alice.id}`)
      .set(as(alice))
      .send({ role: 'VIEWER' })
      .expect(409);
    await http()
      .patch(`/groups/${groupId}/members/${bob.id}`)
      .set(as(bob))
      .send({ role: 'ADMIN' })
      .expect(403);

    await http()
      .patch(`/groups/${groupId}/members/${bob.id}`)
      .set(as(alice))
      .send({ role: 'ADMIN' })
      .expect(200);
    const res = await http()
      .patch(`/groups/${groupId}/members/${bob.id}`)
      .set(as(alice))
      .send({ role: 'VIEWER' })
      .expect(200);
    expect(res.body.role).toBe('VIEWER');
  });

  it('invites by email: invitee sees it pending, can reject, then accept a new one', async () => {
    await http().post(`/groups/${groupId}/invites`).set(as(bob)).send({ channel: 'EMAIL', email: carol.email }).expect(403);
    await http().post(`/groups/${groupId}/invites`).set(as(alice)).send({ channel: 'EMAIL' }).expect(400);
    await http().post(`/groups/${groupId}/invites`).set(as(alice)).send({ channel: 'EMAIL', email: bob.email }).expect(409);

    const first = await http()
      .post(`/groups/${groupId}/invites`)
      .set(as(alice))
      .send({ channel: 'EMAIL', email: carol.email })
      .expect(201);
    expect(
      invitesSent.some((m) => m.to === carol.email && m.text.includes('Ladakh Ride 2026') && m.text.includes(`@${alice.username}`)),
    ).toBe(true);
    await http().post(`/groups/${groupId}/invites`).set(as(alice)).send({ channel: 'EMAIL', email: carol.email }).expect(409);

    const pending = await http().get('/invites').set(as(carol)).expect(200);
    expect(pending.body).toHaveLength(1);
    expect(pending.body[0]).toMatchObject({ id: first.body.id, group: { id: groupId } });

    await http().post(`/invites/${first.body.id}/accept`).set(as(dave)).expect(404);
    await http().post(`/invites/${first.body.id}/reject`).set(as(carol)).expect(201);
    await http().post(`/invites/${first.body.id}/accept`).set(as(carol)).expect(409);
    await http().get(`/groups/${groupId}`).set(as(carol)).expect(404);

    const second = await http()
      .post(`/groups/${groupId}/invites`)
      .set(as(alice))
      .send({ channel: 'EMAIL', email: carol.email })
      .expect(201);
    const accepted = await http().post(`/invites/${second.body.id}/accept`).set(as(carol)).expect(201);
    expect(accepted.body).toEqual({ groupId, status: 'ACCEPTED' });
    const group = await http().get(`/groups/${groupId}`).set(as(carol)).expect(200);
    expect(group.body.myRole).toBe('VIEWER');
  });

  it('invites by SMS and lets the admin revoke a pending invite', async () => {
    const invite = await http()
      .post(`/groups/${groupId}/invites`)
      .set(as(alice))
      .send({ channel: 'SMS', phone: dave.phone })
      .expect(201);
    expect(invitesSent.some((m) => m.to === dave.phone)).toBe(true);

    const listed = await http().get(`/groups/${groupId}/invites`).set(as(alice)).expect(200);
    expect(listed.body.map((i: { id: string }) => i.id)).toContain(invite.body.id);

    await http().delete(`/groups/${groupId}/invites/${invite.body.id}`).set(as(alice)).expect(200);
    expect((await http().get('/invites').set(as(dave)).expect(200)).body).toHaveLength(0);
    await http().post(`/invites/${invite.body.id}/accept`).set(as(dave)).expect(409);
  });

  it('joins via a multi-use share link until it is revoked', async () => {
    const link = await http().post(`/groups/${groupId}/invites`).set(as(alice)).send({ channel: 'LINK' }).expect(201);
    expect(link.body.token).toBeTruthy();
    expect(link.body.link).toMatch(new RegExp(`/${link.body.token}$`));
    const { token } = link.body;

    const preview = await http().get(`/invites/link/${token}`).set(as(dave)).expect(200);
    expect(preview.body).toMatchObject({
      group: { id: groupId },
      alreadyMember: false,
      invitedBy: { id: alice.id, username: alice.username },
    });

    await http().post(`/invites/link/${token}/accept`).set(as(dave)).expect(201);
    await http().post(`/invites/link/${token}/accept`).set(as(dave)).expect(201); // idempotent
    const members = await http().get(`/groups/${groupId}/members`).set(as(dave)).expect(200);
    expect(members.body).toHaveLength(4);
    expect(members.body[0]).toMatchObject({ userId: alice.id, username: alice.username, role: 'ADMIN' });
    expect(members.body[0].email).toBeUndefined();

    await http().delete(`/groups/${groupId}/invites/${link.body.id}`).set(as(alice)).expect(200);
    await http().get(`/invites/link/${token}`).set(as(dave)).expect(404);
    await http().get('/invites/link/bogus-token').set(as(dave)).expect(404);
  });

  it('removes members: admins remove anyone, members can leave, the last admin cannot', async () => {
    await http().delete(`/groups/${groupId}/members/${carol.id}`).set(as(bob)).expect(403);
    await http().delete(`/groups/${groupId}/members/${carol.id}`).set(as(alice)).expect(200);
    await http().get(`/groups/${groupId}`).set(as(carol)).expect(404);

    await http().delete(`/groups/${groupId}/members/${dave.id}`).set(as(dave)).expect(200);
    await http().delete(`/groups/${groupId}/members/${alice.id}`).set(as(alice)).expect(409);
    await http().delete(`/groups/${groupId}/members/${randomUUID()}`).set(as(alice)).expect(404);
  });

  it('lets only admins delete the group, and deletes its files with it', async () => {
    const folder = resolve(process.env.UPLOAD_DIR || 'uploads', 'groups', groupId);
    expect(existsSync(folder)).toBe(true);
    await http().delete(`/groups/${groupId}`).set(as(bob)).expect(403);
    await http().delete(`/groups/${groupId}`).set(as(alice)).expect(200);
    await http().get(`/groups/${groupId}`).set(as(alice)).expect(404);
    expect(existsSync(folder)).toBe(false);
  });
});
