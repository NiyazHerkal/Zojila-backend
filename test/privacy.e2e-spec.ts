import { randomUUID } from 'node:crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import { In, Repository } from 'typeorm';
import { AppModule } from './../src/app.module.js';
import { Group, Invite, User } from './../src/database/entities/index.js';
import { InviteDeliveryService } from './../src/notifications/invite-delivery.service.js';
import { OtpDeliveryService } from './../src/notifications/otp-delivery.service.js';
import { RetentionService } from './../src/privacy/retention.service.js';

// Phase 12 data privacy against the real dev Postgres: GDPR export and account deletion, closing
// a trip (read-only, then deleted), and the retention job (run only on this suite's own rows).
describe('Data privacy (e2e)', () => {
  let app: INestApplication;
  let users: Repository<User>;
  let groups: Repository<Group>;
  let invites: Repository<Invite>;
  let retention: RetentionService;
  const otpCodes = new Map<string, string>();

  const suffix = randomUUID().slice(0, 8);
  interface TestUser {
    id: string;
    username: string;
    email: string;
    token: string;
  }
  const userIds: string[] = [];
  let alice: TestUser;
  let bob: TestUser;
  let carol: TestUser;
  let tripId: string; // alice (admin) + bob

  const http = () => request(app.getHttpServer());
  const as = (u: TestUser) => ({ Authorization: `Bearer ${u.token}` });

  async function registerUser(label: string): Promise<TestUser> {
    const email = `privacy-e2e.${label}.${suffix}@example.com`;
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
    return { id: signup.body.userId, username, email, token: verified.body.accessToken };
  }

  async function createGroup(owner: TestUser, name: string): Promise<string> {
    const res = await http()
      .post('/groups')
      .set(as(owner))
      .send({ name, description: 'd', tripStart: '2026-10-10T00:00:00Z', tripEnd: '2026-10-19T00:00:00Z' })
      .expect(201);
    return res.body.id;
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(OtpDeliveryService)
      .useValue({
        sendEmail: async (to: string, code: string) => void otpCodes.set(to, code),
        sendSms: async (to: string, code: string) => void otpCodes.set(to, code),
      })
      .overrideProvider(InviteDeliveryService)
      .useValue({ sendEmail: async () => undefined, sendSms: async () => undefined })
      .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    users = moduleFixture.get(getRepositoryToken(User));
    groups = moduleFixture.get(getRepositoryToken(Group));
    invites = moduleFixture.get(getRepositoryToken(Invite));
    retention = moduleFixture.get(RetentionService);

    alice = await registerUser('alice');
    bob = await registerUser('bob');
    carol = await registerUser('carol');
    tripId = await createGroup(alice, 'Spiti');
    await http().post(`/groups/${tripId}/members`).set(as(alice)).send({ username: bob.username }).expect(201);
  });

  afterAll(async () => {
    if (userIds.length) {
      await groups.delete({ createdById: In(userIds) });
      await users.delete({ id: In(userIds) });
    }
    await app.close();
  });

  it('exports everything stored about the user', async () => {
    await http()
      .post(`/groups/${tripId}/expenses`)
      .set(as(alice))
      .send({ amount: 400, category: 'FUEL', date: '2026-10-11', splitType: 'EQUAL' })
      .expect(201);
    await http().post(`/groups/${tripId}/status`).set(as(alice)).send({ status: 'ARRIVED', note: 'Kaza' }).expect(201);

    const res = await http().get('/auth/me/export').set(as(alice)).expect(200);
    expect(res.headers['content-disposition']).toMatch(/^attachment; filename="travelgo-my-data-.+\.json"$/);
    expect(res.body.profile).toMatchObject({ id: alice.id, email: alice.email, username: alice.username });
    expect(res.body.groups).toEqual([expect.objectContaining({ groupId: tripId, role: 'ADMIN' })]);
    expect(res.body.expensesPaid).toEqual([expect.objectContaining({ amount: 400, category: 'FUEL' })]);
    expect(res.body.expenseShares).toEqual([expect.objectContaining({ amount: 200 })]);
    expect(res.body.statusUpdates).toEqual([expect.objectContaining({ status: 'ARRIVED', note: 'Kaza' })]);
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|password_hash|refreshToken/);
  });

  describe('closing a trip', () => {
    it('makes it read-only, tells members when it will be deleted, and can be reopened', async () => {
      const invite = await http()
        .post(`/groups/${tripId}/invites`)
        .set(as(alice))
        .send({ channel: 'EMAIL', email: carol.email })
        .expect(201);

      await http().post(`/groups/${tripId}/close`).set(as(bob)).expect(403);
      const closed = await http().post(`/groups/${tripId}/close`).set(as(alice)).expect(200);
      expect(closed.body.closedAt).not.toBeNull();
      const days = (new Date(closed.body.deleteAfter).getTime() - new Date(closed.body.closedAt).getTime()) / 86_400_000;
      expect(Math.round(days)).toBe(30);

      const blocked = await http()
        .post(`/groups/${tripId}/expenses`)
        .set(as(bob))
        .send({ amount: 10, category: 'FOOD', date: '2026-10-12', splitType: 'EQUAL' })
        .expect(409);
      expect(blocked.body).toMatchObject({ code: 'TRIP_CLOSED' });
      expect(blocked.body.message).toMatch(/closed, so it's read-only/);
      await http().post(`/groups/${tripId}/status`).set(as(bob)).send({ status: 'ARRIVED' }).expect(409);
      await http().patch(`/groups/${tripId}`).set(as(alice)).send({ name: 'x' }).expect(409);
      const accept = await http().post(`/invites/${invite.body.id}/accept`).set(as(carol)).expect(409);
      expect(accept.body.code).toBe('TRIP_CLOSED');
      // Reading (and downloading the report) still works.
      await http().get(`/groups/${tripId}/expenses`).set(as(bob)).expect(200);
      await http().get(`/groups/${tripId}/expenses/report?format=csv`).set(as(bob)).expect(200);

      const reopened = await http().post(`/groups/${tripId}/reopen`).set(as(alice)).expect(200);
      expect(reopened.body).toMatchObject({ closedAt: null, deleteAfter: null });
      await http().post(`/groups/${tripId}/status`).set(as(bob)).send({ status: 'IN_TRANSIT' }).expect(201);
    });
  });

  describe('deleting an account', () => {
    let dave: TestUser;
    let daveTrip: string; // dave is admin, bob a viewer
    let daveSolo: string; // only dave

    beforeAll(async () => {
      dave = await registerUser('dave');
      daveTrip = await createGroup(dave, 'Dave trip');
      daveSolo = await createGroup(dave, 'Dave solo');
      await http().post(`/groups/${daveTrip}/members`).set(as(dave)).send({ username: bob.username }).expect(201);
      await http()
        .post(`/groups/${daveTrip}/expenses`)
        .set(as(dave))
        .send({ amount: 300, category: 'FOOD', date: '2026-10-12', splitType: 'EQUAL' })
        .expect(201);
      await http().post(`/groups/${daveTrip}/alerts`).set(as(dave)).send({ type: 'GENERAL', body: 'Dinner at 8' }).expect(201);
    });

    it('needs the right password', async () => {
      await http().delete('/auth/me').set(as(dave)).send({ password: 'Wr0ng!Pass' }).expect(401);
      await http().delete('/auth/me').set(as(dave)).send({}).expect(400);
    });

    it('erases personal data but keeps the group working', async () => {
      await http().delete('/auth/me').set(as(dave)).send({ password: 'Str0ng!Pass' }).expect(200);

      const row = await users.findOneByOrFail({ id: dave.id });
      expect(row).toMatchObject({ name: 'Deleted user', email: null, phone: null, avatarUrl: null, refreshTokenHash: null });
      expect(row.username).toMatch(/^deleted_[0-9a-f]{12}$/);
      expect(row.deletedAt).not.toBeNull();

      // The old token and the old login stop working.
      await http().get('/auth/me').set(as(dave)).expect(401);
      await http().post('/auth/login').send({ identifier: dave.email, password: 'Str0ng!Pass' }).expect(401);

      // The group he shared: bob is now admin, history and balances still make sense.
      const members = await http().get(`/groups/${daveTrip}/members`).set(as(bob)).expect(200);
      expect(members.body).toEqual([expect.objectContaining({ userId: bob.id, role: 'ADMIN' })]);
      const alerts = await http().get(`/groups/${daveTrip}/alerts`).set(as(bob)).expect(200);
      expect(alerts.body.items[0].sender.name).toBe('Deleted user');
      const summary = await http().get(`/groups/${daveTrip}/expenses/summary`).set(as(bob)).expect(200);
      expect(summary.body.members.find((m: { userId: string }) => m.userId === dave.id)).toMatchObject({
        name: 'Deleted user',
        isMember: false,
        balance: 150,
      });

      // The group only he was in is gone.
      expect(await groups.existsBy({ id: daveSolo })).toBe(false);
    });
  });

  describe('retention job (scoped to this suite)', () => {
    it('deletes closed trips once their time is up', async () => {
      const old = await createGroup(alice, 'Old trip');
      await http().post(`/groups/${old}/close`).set(as(alice)).expect(200);
      expect(await retention.purgeClosedGroups(new Date(), [old])).toBe(0); // not due yet
      await groups.update({ id: old }, { deleteAfter: new Date(Date.now() - 1000) });
      expect(await retention.purgeClosedGroups(new Date(), [old])).toBe(1);
      expect(await groups.existsBy({ id: old })).toBe(false);
    });

    it('deletes accounts never verified within 7 days', async () => {
      const signup = await http()
        .post('/auth/signup')
        .send({ email: `privacy-e2e.ghost.${suffix}@example.com`, username: `ghost_${suffix}`, password: 'Str0ng!Pass', name: 'Ghost' })
        .expect(201);
      const ghost = signup.body.userId as string;
      userIds.push(ghost);
      expect(await retention.purgeUnverifiedAccounts(new Date(), [ghost, alice.id])).toBe(0);
      await users.update({ id: ghost }, { createdAt: new Date(Date.now() - 8 * 86_400_000) });
      await users.update({ id: alice.id }, { createdAt: new Date(Date.now() - 8 * 86_400_000) }); // verified: kept
      expect(await retention.purgeUnverifiedAccounts(new Date(), [ghost, alice.id])).toBe(1);
      expect(await users.existsBy({ id: ghost })).toBe(false);
      expect(await users.existsBy({ id: alice.id })).toBe(true);
    });

    it('deletes invites that expired over 30 days ago', async () => {
      const invite = await http().post(`/groups/${tripId}/invites`).set(as(alice)).send({ channel: 'LINK' }).expect(201);
      expect(await retention.purgeOldInvites(new Date(), [tripId])).toBe(0);
      await invites.update({ id: invite.body.id }, { expiresAt: new Date(Date.now() - 31 * 86_400_000) });
      expect(await retention.purgeOldInvites(new Date(), [tripId])).toBe(1);
    });
  });
});
