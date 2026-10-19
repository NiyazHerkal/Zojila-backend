import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { io, type Socket } from 'socket.io-client';
import request from 'supertest';
import { In, Repository } from 'typeorm';
import { AppModule } from './../src/app.module.js';
import { Group, User } from './../src/database/entities/index.js';
import { OtpDeliveryService } from './../src/notifications/otp-delivery.service.js';

// Phase 10 DoD against the real dev Postgres: a group logs shared expenses (equal and custom
// splits, receipts) and sees a correct settlement summary, including recorded repayments.
describe('Expenses (e2e)', () => {
  let app: INestApplication;
  let baseUrl: string;
  let users: Repository<User>;
  let groups: Repository<Group>;
  const otpCodes = new Map<string, string>();
  const sockets: Socket[] = [];
  let bobSocket: Socket;

  const suffix = randomUUID().slice(0, 8);
  interface TestUser {
    id: string;
    username: string;
    token: string;
  }
  const userIds: string[] = [];
  let alice: TestUser; // admin
  let bob: TestUser; // viewer
  let carol: TestUser; // viewer, leaves later
  let dave: TestUser; // not a member
  let groupId: string;
  let fuelId: string; // alice paid 900, equal between all 3
  let snacksId: string; // bob paid 100.01, equal between bob + carol
  let hotelId: string; // carol paid 1000, custom: alice 600, carol 400

  const http = () => request(app.getHttpServer());
  const as = (u: TestUser) => ({ Authorization: `Bearer ${u.token}` });
  const url = (path = '') => `/groups/${groupId}/expenses${path}`;
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);

  async function registerUser(label: string): Promise<TestUser> {
    const email = `expenses-e2e.${label}.${suffix}@example.com`;
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

  const balanceOf = (summary: { members: { userId: string; balance: number }[] }, u: TestUser) =>
    summary.members.find((m) => m.userId === u.id)?.balance;

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
    await app.listen(0, '127.0.0.1'); // sockets need a real port
    baseUrl = (await app.getUrl()).replace('[::1]', '127.0.0.1');
    users = moduleFixture.get(getRepositoryToken(User));
    groups = moduleFixture.get(getRepositoryToken(Group));

    alice = await registerUser('alice');
    bob = await registerUser('bob');
    carol = await registerUser('carol');
    dave = await registerUser('dave');

    const group = await http()
      .post('/groups')
      .set(as(alice))
      .send({ name: 'Spiti Loop', description: 'd', tripStart: '2026-10-10T00:00:00Z', tripEnd: '2026-10-19T00:00:00Z' })
      .expect(201);
    groupId = group.body.id;
    expect(group.body.currency).toBe('INR');
    for (const u of [bob, carol]) {
      await http().post(`/groups/${groupId}/members`).set(as(alice)).send({ username: u.username }).expect(201);
    }
  });

  afterAll(async () => {
    sockets.forEach((s) => s.disconnect());
    if (userIds.length) {
      await groups.delete({ createdById: In(userIds) });
      await users.delete({ id: In(userIds) });
    }
    await app.close();
  });

  it('splits equally between every member by default, with live expense:created', async () => {
    bobSocket = io(baseUrl, { auth: { token: bob.token }, transports: ['websocket'], reconnection: false });
    sockets.push(bobSocket);
    await new Promise((r) => bobSocket.once('ready', r));
    const event = new Promise<Record<string, any>>((r) => bobSocket.once('expense:created', r));

    const res = await http()
      .post(url())
      .set(as(alice))
      .send({ amount: 900, category: 'FUEL', date: '2026-10-11', description: 'Diesel at Tandi', splitType: 'EQUAL' })
      .expect(201);
    fuelId = res.body.id;
    expect(res.body).toMatchObject({ amount: 900, currency: 'INR', category: 'FUEL', date: '2026-10-11', splitType: 'EQUAL', myShare: 300, canEdit: true, hasReceipt: false });
    expect(res.body.paidBy.userId).toBe(alice.id);
    expect(res.body.payments).toEqual([expect.objectContaining({ userId: alice.id, amount: 900 })]);
    expect(res.body.splits.map((s: { amount: number }) => s.amount)).toEqual([300, 300, 300]);
    const received = await event;
    expect(received).toMatchObject({ groupId, expenseId: fuelId, byUserId: alice.id, expense: { id: fuelId, amount: 900 } });
    expect(received.timestamp).toBeDefined();
    expect(received.expense.myShare).toBeUndefined(); // per-person fields stay out of the broadcast
  });

  it('splits between chosen members and puts the leftover paisa on the first one', async () => {
    const res = await http()
      .post(url())
      .set(as(bob))
      .send({ amount: 100.01, category: 'FOOD', date: '2026-10-12', splitType: 'EQUAL', splitBetween: [bob.id, carol.id] })
      .expect(201);
    snacksId = res.body.id;
    const byUser = Object.fromEntries(res.body.splits.map((s: { userId: string; amount: number }) => [s.userId, s.amount]));
    expect(byUser).toEqual({ [bob.id]: 50.01, [carol.id]: 50 });
  });

  it('takes a custom split that adds up exactly, paid by someone else', async () => {
    const res = await http()
      .post(url())
      .set(as(alice))
      .send({
        amount: 1000,
        category: 'ACCOMMODATION',
        date: '2026-10-12',
        paidBy: carol.id,
        splitType: 'CUSTOM',
        shares: [{ userId: alice.id, amount: 600 }, { userId: carol.id, amount: 400 }],
      })
      .expect(201);
    hotelId = res.body.id;
    expect(res.body.paidBy.userId).toBe(carol.id);
    expect(res.body.createdBy.userId).toBe(alice.id);
    expect(res.body.myShare).toBe(600);
  });

  it('rejects invalid expenses with clear messages', async () => {
    const base = { amount: 100, category: 'FOOD', date: '2026-10-12' };
    const bad = async (body: object, message: string | RegExp) => {
      const res = await http().post(url()).set(as(alice)).send(body).expect(400);
      expect(JSON.stringify(res.body.message)).toMatch(message);
    };
    await bad({ ...base, splitType: 'CUSTOM', shares: [{ userId: alice.id, amount: 60 }] }, 'shares add up to 60.00, but the amount is 100.00');
    await bad({ ...base, amount: 10.005, splitType: 'EQUAL' }, /amount/);
    await bad({ amount: 100, category: 'FOOD', splitType: 'EQUAL' }, /date must be YYYY-MM-DD/);
    await bad({ ...base, category: 'CASINO', splitType: 'EQUAL' }, /category/);
    await bad({ ...base, splitType: 'EQUAL', splitBetween: [dave.id] }, 'must be a member');
    await bad({ ...base, splitType: 'EQUAL', paidBy: dave.id }, 'paidBy must be a member');
    await bad({ ...base, splitType: 'EQUAL', shares: [{ userId: alice.id, amount: 100 }] }, 'shares is only for CUSTOM');
    await bad({ ...base, splitType: 'CUSTOM' }, 'shares is required');
    await bad({ ...base, splitType: 'EQUAL', paidBy: alice.id, payments: [{ userId: alice.id, amount: 100 }] }, 'not both');
    await bad({ ...base, splitType: 'EQUAL', payments: [{ userId: alice.id, amount: 60 }] }, 'payments add up to 60.00, but the amount is 100.00');
    await bad({ ...base, splitType: 'EQUAL', payments: [{ userId: alice.id, amount: 50 }, { userId: dave.id, amount: 50 }] }, 'must be a member');
    await bad({ ...base, splitType: 'EQUAL', payments: [{ userId: alice.id, amount: 50 }, { userId: alice.id, amount: 50 }] }, 'only once in payments');
    await http().post(url()).set(as(dave)).send({ ...base, splitType: 'EQUAL' }).expect(404);
  });

  it('shows a correct summary: totals, categories, balances and who owes whom', async () => {
    const { body } = await http().get(url('/summary')).set(as(bob)).expect(200);
    expect(body.currency).toBe('INR');
    expect(body.totalSpent).toBe(2000.01);
    expect(body.expenseCount).toBe(3);
    expect(body.byCategory.map((c: { category: string }) => c.category)).toEqual(['ACCOMMODATION', 'FUEL', 'FOOD']);
    // alice: paid 900, share 300 + 600 → 0 · bob: paid 100.01, share 300 + 50.01 → −250 · carol: paid 1000, share 300 + 50 + 400 → +250
    expect(balanceOf(body, alice)).toBe(0);
    expect(balanceOf(body, bob)).toBe(-250);
    expect(balanceOf(body, carol)).toBe(250);
    expect(body.myBalance).toBe(-250);
    expect(body.settleUp).toHaveLength(1);
    expect(body.settleUp[0]).toMatchObject({ from: { userId: bob.id }, to: { userId: carol.id }, amount: 250 });
  });

  it('lists newest day first, filters, and pages', async () => {
    const all = await http().get(url()).set(as(carol)).expect(200);
    expect(all.body.items.map((e: { id: string }) => e.id)).toEqual([hotelId, snacksId, fuelId]);
    expect(all.body.nextBefore).toBeNull();

    const page1 = await http().get(url('?limit=2')).set(as(carol)).expect(200);
    expect(page1.body.items).toHaveLength(2);
    const page2 = await http().get(url(`?limit=2&before=${page1.body.nextBefore}`)).set(as(carol)).expect(200);
    expect(page2.body.items.map((e: { id: string }) => e.id)).toEqual([fuelId]);

    const mine = await http().get(url(`?involving=${bob.id}`)).set(as(bob)).expect(200);
    expect(mine.body.items.map((e: { id: string }) => e.id).sort()).toEqual([fuelId, snacksId].sort());
    const food = await http().get(url('?category=FOOD')).set(as(bob)).expect(200);
    expect(food.body.items.map((e: { id: string }) => e.id)).toEqual([snacksId]);
    await http().get(url(`?before=${randomUUID()}`)).set(as(bob)).expect(400);
  });

  it('lets only whoever recorded an expense, or an admin, change it', async () => {
    const asBob = await http().get(url(`/${fuelId}`)).set(as(bob)).expect(200);
    expect(asBob.body.canEdit).toBe(false);
    await http().patch(url(`/${fuelId}`)).set(as(bob)).send({ description: 'mine now' }).expect(403);
    await http().delete(url(`/${fuelId}`)).set(as(bob)).expect(403);

    // bob edits his own; alice (admin) can edit bob's too
    await http().patch(url(`/${snacksId}`)).set(as(bob)).send({ description: 'Maggi + chai' }).expect(200);
    const edited = await http().patch(url(`/${snacksId}`)).set(as(alice)).send({ category: 'FOOD', description: null }).expect(200);
    expect(edited.body.description).toBeNull();
  });

  it('re-splits an EQUAL expense when the amount changes, but a CUSTOM one needs new shares', async () => {
    const res = await http().patch(url(`/${fuelId}`)).set(as(alice)).send({ amount: 1200 }).expect(200);
    expect(res.body.splits.map((s: { amount: number }) => s.amount)).toEqual([400, 400, 400]);
    await http().patch(url(`/${hotelId}`)).set(as(alice)).send({ amount: 1100 }).expect(400);
    await http().patch(url(`/${fuelId}`)).set(as(alice)).send({ amount: 900 }).expect(200); // back, so balances match above
  });

  it('records repayments that clear the balance, with permission checks', async () => {
    await http().post(url('/settlements')).set(as(bob)).send({ toUserId: bob.id, amount: 10 }).expect(400);
    await http().post(url('/settlements')).set(as(carol)).send({ fromUserId: alice.id, toUserId: bob.id, amount: 10 }).expect(403);

    const res = await http()
      .post(url('/settlements'))
      .set(as(bob))
      .send({ toUserId: carol.id, amount: 250, date: '2026-10-20', note: 'UPI' })
      .expect(201);
    expect(res.body).toMatchObject({ from: { userId: bob.id }, to: { userId: carol.id }, amount: 250, date: '2026-10-20', note: 'UPI', canDelete: true });

    const { body } = await http().get(url('/summary')).set(as(alice)).expect(200);
    expect(body.settleUp).toEqual([]);
    expect([alice, bob, carol].map((u) => balanceOf(body, u))).toEqual([0, 0, 0]);
    const list = await http().get(url('/settlements')).set(as(carol)).expect(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0].canDelete).toBe(false);
    await http().delete(url(`/settlements/${res.body.id}`)).set(as(carol)).expect(403);
  });

  it('takes several payers per expense, with balances, filters and edits to match', async () => {
    // Everyone is at 0 here. 900 shared by all three; alice paid 600 and bob 300.
    const created = await http()
      .post(url())
      .set(as(carol))
      .send({
        amount: 900,
        category: 'ACTIVITIES',
        date: '2026-10-14',
        splitType: 'EQUAL',
        payments: [
          { userId: bob.id, amount: 300 },
          { userId: alice.id, amount: 600 },
        ],
      })
      .expect(201);
    const id = created.body.id as string;
    expect(created.body.paidBy.userId).toBe(alice.id); // the main payer = whoever paid most
    expect(created.body.payments.map((p: { userId: string; amount: number }) => [p.userId, p.amount])).toEqual([
      [alice.id, 600],
      [bob.id, 300],
    ]);

    const summary = await http().get(url('/summary')).set(as(alice)).expect(200);
    expect([alice, bob, carol].map((u) => balanceOf(summary.body, u))).toEqual([300, 0, -300]);
    const paidByBob = await http().get(url(`?paidBy=${bob.id}`)).set(as(bob)).expect(200);
    expect(paidByBob.body.items.map((e: { id: string }) => e.id)).toContain(id);

    // Changing the amount needs new payments when several people paid.
    const msg = await http().patch(url(`/${id}`)).set(as(carol)).send({ amount: 1200 }).expect(400);
    expect(msg.body.message).toMatch('Send the new payments');

    const updatedEvent = new Promise<Record<string, any>>((r) => bobSocket.once('expense:updated', r));
    const single = await http().patch(url(`/${id}`)).set(as(carol)).send({ paidBy: bob.id }).expect(200);
    expect(single.body.paidBy.userId).toBe(bob.id);
    expect(single.body.payments).toEqual([expect.objectContaining({ userId: bob.id, amount: 900 })]);
    expect(await updatedEvent).toMatchObject({ expenseId: id, expense: { paidBy: { userId: bob.id } } });

    // One payer again, so a new amount just moves to that payer.
    const bigger = await http().patch(url(`/${id}`)).set(as(carol)).send({ amount: 1200 }).expect(200);
    expect(bigger.body.payments).toEqual([expect.objectContaining({ userId: bob.id, amount: 1200 })]);

    const deletedEvent = new Promise<Record<string, any>>((r) => bobSocket.once('expense:deleted', r));
    await http().delete(url(`/${id}`)).set(as(carol)).expect(200);
    expect(await deletedEvent).toMatchObject({ groupId, expenseId: id, byUserId: carol.id });
    const after = await http().get(url('/summary')).set(as(alice)).expect(200);
    expect([alice, bob, carol].map((u) => balanceOf(after.body, u))).toEqual([0, 0, 0]);
  });

  it('stores, serves and validates receipts', async () => {
    const up = await http().put(url(`/${fuelId}/receipt`)).set(as(alice)).attach('file', png, 'bill.png').expect(200);
    expect(up.body).toMatchObject({ hasReceipt: true, receiptContentType: 'image/png' });

    const file = await http().get(url(`/${fuelId}/receipt`)).set(as(bob)).buffer(true).expect(200);
    expect(file.headers['content-type']).toBe('image/png');
    expect(Buffer.compare(file.body as Buffer, png)).toBe(0);

    await http().put(url(`/${fuelId}/receipt`)).set(as(bob)).attach('file', png, 'bill.png').expect(403);
    await http()
      .put(url(`/${fuelId}/receipt`))
      .set(as(alice))
      .attach('file', Buffer.from('just some text, not a receipt'), 'bill.png')
      .expect(415);
    await http()
      .put(url(`/${fuelId}/receipt`))
      .set(as(alice))
      .attach('file', Buffer.concat([png, Buffer.alloc(5 * 1024 * 1024)]), 'big.png')
      .expect(413);
    await http().put(url(`/${fuelId}/receipt`)).set(as(alice)).expect(400);

    const removed = await http().delete(url(`/${fuelId}/receipt`)).set(as(alice)).expect(200);
    expect(removed.body.hasReceipt).toBe(false);
    await http().get(url(`/${fuelId}/receipt`)).set(as(alice)).expect(404);
    await http().put(url(`/${hotelId}/receipt`)).set(as(alice)).attach('file', png, 'hotel.png').expect(200);
  });

  it('exports the report as PDF and CSV', async () => {
    const pdf = await http().get(url('/report')).set(as(bob)).buffer(true).expect(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect(pdf.headers['content-disposition']).toMatch(/^attachment; filename="spiti-loop-expenses-\d{4}-\d{2}-\d{2}\.pdf"$/);
    expect((pdf.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');

    const csv = await http().get(url('/report?format=csv')).set(as(bob)).expect(200);
    expect(csv.headers['content-type']).toMatch(/^text\/csv/);
    const text = csv.text;
    expect(text.startsWith('﻿Type,Date,Category')).toBe(true);
    expect(text).toContain('EXPENSE,2026-10-11,FUEL,Diesel at Tandi');
    expect(text).toContain('REPAYMENT,2026-10-20,,UPI');
    await http().get(url('/report?format=xlsx')).set(as(bob)).expect(400);
  });

  it("locks the currency once there are expenses, and keeps an ex-member's balance", async () => {
    await http().patch(`/groups/${groupId}`).set(as(alice)).send({ currency: 'USD' }).expect(409);
    await http().patch(`/groups/${groupId}`).set(as(alice)).send({ currency: 'rupees' }).expect(400);

    // Carol is owed nothing now; give her a balance, then she leaves.
    await http()
      .post(url())
      .set(as(carol))
      .send({ amount: 300, category: 'TRANSPORT', date: '2026-10-13', splitType: 'EQUAL' })
      .expect(201);
    await http().delete(`/groups/${groupId}/members/${carol.id}`).set(as(carol)).expect(200);
    const { body } = await http().get(url('/summary')).set(as(alice)).expect(200);
    const exMember = body.members.find((m: { userId: string }) => m.userId === carol.id);
    expect(exMember).toMatchObject({ isMember: false, balance: 200 });
    expect(body.settleUp.reduce((s: number, t: { amount: number }) => s + t.amount, 0)).toBe(200);
  });

  it('deletes expenses, and the group’s receipt files with the group', async () => {
    await http().delete(url(`/${snacksId}`)).set(as(bob)).expect(200);
    await http().get(url(`/${snacksId}`)).set(as(bob)).expect(404);
    await http().get(url('/not-a-uuid')).set(as(bob)).expect(400);

    const folder = resolve(process.env.UPLOAD_DIR || 'uploads', 'receipts', groupId);
    expect(existsSync(folder)).toBe(true);
    await http().delete(`/groups/${groupId}`).set(as(alice)).expect(200);
    expect(existsSync(folder)).toBe(false);
  });
});
