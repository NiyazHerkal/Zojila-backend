import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { ConflictException } from '@nestjs/common';
import { DataSource, In } from 'typeorm';
import { dataSourceOptions } from '../src/database/data-source.js';
import {
  Expense, ExpenseCategory, ExpensePayment, ExpenseSettlement, ExpenseSplit, Group,
  GroupMember, GroupRole, LiveShareDuration, LocationShareLink, SplitType, User,
} from '../src/database/entities/index.js';
import { GroupsService } from '../src/groups/groups.service.js';
import { ExpensesService } from '../src/expenses/expenses.service.js';
import { LiveNamespaceRef, LiveShareService } from '../src/location/live-share.service.js';

// Real row locks and independent pooled connections; no push, sockets or external providers.
describe('API consistency under concurrent writes (Postgres)', () => {
  let db: DataSource;
  let groups: GroupsService;
  let expenses: ExpensesService;
  let live: LiveShareService;
  let users: User[] = [];
  const groupIds: string[] = [];
  const realtime = { emitToGroup: async () => undefined, emitToUser: async () => undefined };
  const push = { sendToUsers: async () => undefined };

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) process.loadEnvFile('.env');
    db = new DataSource({ ...dataSourceOptions(), logging: false });
    await db.initialize();
    const suffix = randomUUID().slice(0, 8);
    users = await db.getRepository(User).save(['alice', 'bob'].map((label) =>
      db.getRepository(User).create({ username: `cons_${label}_${suffix}`, name: label,
        email: `cons.${label}.${suffix}@example.com`, passwordHash: 'unused-in-this-suite', emailVerified: true })));
    groups = new GroupsService(db.getRepository(Group), db.getRepository(GroupMember), db.getRepository(User),
      db, {} as never, push as never, { groupUpdated: async () => undefined } as never, new ConfigService());
    expenses = new ExpensesService(db.getRepository(Expense), db.getRepository(ExpenseSplit),
      db.getRepository(ExpensePayment), db.getRepository(ExpenseSettlement), db.getRepository(GroupMember),
      db.getRepository(Group), db.getRepository(User), db, realtime as never, push as never, {} as never);
    live = new LiveShareService(db.getRepository(LocationShareLink), {} as never, realtime as never,
      push as never, new LiveNamespaceRef(), new ConfigService({ LIVE_SHARE_MAX_ACTIVE: '5' }));
  });

  afterAll(async () => {
    if (db?.isInitialized) {
      if (groupIds.length) await db.getRepository(Group).delete({ id: In(groupIds) });
      if (users.length) await db.getRepository(User).delete({ id: In(users.map((user) => user.id)) });
      await db.destroy();
    }
  });

  async function newGroup() {
    const group = await groups.create(users[0].id, {
      name: 'Concurrency regression', description: 'Temporary test data',
      tripStart: '2026-11-02', tripEnd: '2026-11-03', currency: 'INR',
    });
    groupIds.push(group.id);
    await db.getRepository(GroupMember).save({ groupId: group.id, userId: users[1].id, role: GroupRole.VIEWER });
    const actor = await db.getRepository(GroupMember).findOneByOrFail({ groupId: group.id, userId: users[0].id });
    return { group, actor };
  }

  it('limits simultaneous live-link creation to five links', async () => {
    const results = await Promise.allSettled(Array.from({ length: 12 }, () =>
      live.start(users[0].id, LiveShareDuration.ONE_HOUR)));
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(5);
    const rejected = results.filter((result) => result.status === 'rejected');
    expect(rejected).toHaveLength(7);
    for (const result of rejected) expect(result.reason).toBeInstanceOf(ConflictException);
    expect(await live.activeLinks(users[0].id)).toHaveLength(5);
    // Another account has an independent quota.
    await expect(live.start(users[1].id, LiveShareDuration.ONE_HOUR)).resolves.toHaveProperty('id');
  });

  it.each(['expense', 'settlement'] as const)(
    'rechecks currency eligibility after a concurrent %s commits', async (kind) => {
      const { group, actor } = await newGroup();
      const writer = db.createQueryRunner();
      await writer.connect();
      await writer.startTransaction();
      let pending: Promise<unknown> | undefined;
      try {
        await writer.manager.findOneOrFail(Group, { where: { id: group.id }, lock: { mode: 'pessimistic_write' } });
        const [{ pid }] = await writer.query('SELECT pg_backend_pid() AS pid') as { pid: number }[];
        if (kind === 'expense') {
          await writer.manager.save(writer.manager.create(Expense, {
            groupId: group.id, payerId: actor.userId, createdById: actor.userId,
            amount: '100.00', category: ExpenseCategory.FUEL, spentOn: '2026-11-02', splitType: SplitType.EQUAL,
          }));
        } else {
          await writer.manager.save(writer.manager.create(ExpenseSettlement, {
            groupId: group.id, fromUserId: actor.userId, toUserId: users[1].id,
            createdById: actor.userId, amount: '100.00', paidOn: '2026-11-02',
          }));
        }
        // Capture rejection immediately, and wait until the other connection is actually blocked.
        pending = groups.update(group.id, actor, { currency: 'USD' }).catch((error: unknown) => error);
        const deadline = Date.now() + 4000;
        let blocked = false;
        while (Date.now() < deadline) {
          const [row] = await db.query(
            'SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE $1::int = ANY(pg_blocking_pids(pid))) AS blocked', [pid],
          ) as { blocked: boolean }[];
          if (row.blocked) { blocked = true; break; }
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        expect(blocked).toBe(true);
        await writer.commitTransaction();
        expect(await pending).toBeInstanceOf(ConflictException);
        expect((await db.getRepository(Group).findOneByOrFail({ id: group.id })).currency).toBe('INR');
      } finally {
        if (writer.isTransactionActive) await writer.rollbackTransaction();
        await writer.release();
        if (pending) await pending;
      }
    },
  );

  it('creates expenses and settlements normally, and permits a currency change before money exists', async () => {
    const { group, actor } = await newGroup();
    expect((await groups.update(group.id, actor, { currency: 'USD' })).currency).toBe('USD');
    const expense = await expenses.create(group.id, actor, {
      amount: 100, category: ExpenseCategory.FUEL, date: '2026-11-02', splitType: SplitType.EQUAL,
    });
    expect(expense.currency).toBe('USD');
    const settlement = await expenses.createSettlement(group.id, actor, { toUserId: users[1].id, amount: 50 });
    expect(settlement.currency).toBe('USD');
    await expect(groups.update(group.id, actor, { currency: 'INR' })).rejects.toBeInstanceOf(ConflictException);
    expect((await groups.update(group.id, actor, { name: 'Renamed trip' })).name).toBe('Renamed trip');
  });
});
