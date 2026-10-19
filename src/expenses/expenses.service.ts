import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, QueryFailedError, Repository } from 'typeorm';
import {
  Expense,
  ExpenseCategory,
  ExpensePayment,
  ExpenseSettlement,
  ExpenseSplit,
  Group,
  GroupMember,
  GroupRole,
  SplitType,
  User,
} from '../database/entities/index.js';
import { PushService } from '../notifications/push.service.js';
import { RealtimeService } from '../realtime/realtime.service.js';
import { StorageService } from '../storage/storage.service.js';
import type {
  CreateExpenseDto,
  CreateSettlementDto,
  ListExpensesQueryDto,
  UpdateExpenseDto,
} from './dto/expense.dto.js';
import {
  fromMinor,
  minorToDecimal,
  settleUp,
  splitEqually,
  toMinor,
} from './money.js';
import { detectReceiptType, RECEIPT_MAX_BYTES } from './receipt-file.js';

/** Socket events to the group (names from change request v1.0, change 6). */
export const EXPENSE_EVENTS = {
  CREATED: 'expense:created',
  UPDATED: 'expense:updated',
  DELETED: 'expense:deleted',
  SETTLEMENT_RECORDED: 'expense:settlement_recorded',
  SETTLEMENT_DELETED: 'expense:settlement_deleted',
} as const;
type ExpenseEvent = (typeof EXPENSE_EVENTS)[keyof typeof EXPENSE_EVENTS];

const DEFAULT_LIST_LIMIT = 50;
const EXPENSE_RELATIONS = {
  payer: true,
  createdBy: true,
  splits: { user: true },
  payments: { user: true },
} as const;

export interface UserSummary {
  userId: string;
  username: string;
  name: string;
  avatarUrl: string | null;
}

export interface ExpenseView {
  id: string;
  groupId: string;
  amount: number;
  currency: string;
  category: ExpenseCategory;
  date: string;
  description: string | null;
  splitType: SplitType;
  /** The main payer (whoever paid the most); everyone who paid is in `payments`. */
  paidBy: UserSummary;
  payments: (UserSummary & { amount: number })[];
  createdBy: UserSummary;
  splits: (UserSummary & { amount: number })[];
  myShare: number;
  hasReceipt: boolean;
  receiptContentType: string | null;
  canEdit: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface SettlementView {
  id: string;
  groupId: string;
  from: UserSummary;
  to: UserSummary;
  amount: number;
  currency: string;
  date: string;
  note: string | null;
  createdBy: UserSummary;
  canDelete: boolean;
  createdAt: Date;
}

export interface UploadedReceipt {
  buffer: Buffer;
  size: number;
}

/** Per-user money totals for a group, in minor units. */
interface Ledger {
  paid: Map<string, number>;
  share: Map<string, number>;
  sent: Map<string, number>;
  received: Map<string, number>;
}

/**
 * Expenses (PDF §2.7): members record shared costs, split equally or by exact amounts, and the
 * group sees per-category totals and a "who owes whom" summary. Repayments between members are
 * recorded as settlements so balances can reach zero.
 *
 * Any member can add an expense. Only whoever recorded it, or an admin, can edit/delete it.
 * One person or several can pay an expense (`expense_payments`), and it's shared only by the
 * members chosen for it (`expense_splits`). Money is computed in paise (see money.ts). Changes
 * go to the group as `expense:created` / `expense:updated` / `expense:deleted` (and the
 * `expense:settlement_*` events for repayments).
 */
@Injectable()
export class ExpensesService {
  private readonly logger = new Logger(ExpensesService.name);

  constructor(
    @InjectRepository(Expense) private readonly expenses: Repository<Expense>,
    @InjectRepository(ExpenseSplit)
    private readonly splits: Repository<ExpenseSplit>,
    @InjectRepository(ExpensePayment)
    private readonly payments: Repository<ExpensePayment>,
    @InjectRepository(ExpenseSettlement)
    private readonly settlements: Repository<ExpenseSettlement>,
    @InjectRepository(GroupMember)
    private readonly members: Repository<GroupMember>,
    @InjectRepository(Group) private readonly groups: Repository<Group>,
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly dataSource: DataSource,
    private readonly realtime: RealtimeService,
    private readonly push: PushService,
    private readonly storage: StorageService,
  ) {}

  // ---------------------------------------------------------------- expenses

  async create(
    groupId: string,
    actor: GroupMember,
    dto: CreateExpenseDto,
  ): Promise<ExpenseView> {
    if (dto.clientId) {
      const existing = await this.findByClientId(
        groupId,
        actor.userId,
        dto.clientId,
      );
      if (existing)
        return this.toView(existing, await this.currency(groupId), actor);
    }
    const memberIds = await this.currentMemberIds(groupId);
    const totalMinor = toMinor(dto.amount);
    const payments = this.resolvePayments(
      totalMinor,
      dto.paidBy,
      dto.payments,
      actor.userId,
      memberIds,
    );
    const shares = this.resolveSplit(
      totalMinor,
      dto.splitType,
      dto.splitBetween,
      dto.shares,
      memberIds,
      memberIds,
    );

    let id: string;
    try {
      id = await this.dataSource.transaction(async (manager) => {
        const saved = await manager.save(
          manager.create(Expense, {
            groupId,
            payerId: mainPayer(payments),
            createdById: actor.userId,
            amount: minorToDecimal(totalMinor),
            category: dto.category,
            spentOn: dto.date,
            description: dto.description?.trim() || null,
            splitType: dto.splitType,
            clientId: dto.clientId ?? null,
          }),
        );
        await manager.save(this.splitRows(saved.id, shares));
        await manager.save(this.paymentRows(saved.id, payments));
        return saved.id;
      });
    } catch (err) {
      // Two creates with the same clientId raced: return the one that won.
      const existing =
        dto.clientId && isUniqueViolation(err)
          ? await this.findByClientId(groupId, actor.userId, dto.clientId)
          : null;
      if (existing)
        return this.toView(existing, await this.currency(groupId), actor);
      throw err;
    }

    const view = await this.get(groupId, actor, id);
    await this.announce(
      groupId,
      EXPENSE_EVENTS.CREATED,
      { expenseId: id },
      actor.userId,
      view,
    );
    this.pushNewExpense(view, actor.userId).catch((err: Error) =>
      this.logger.warn(`Expense push failed: ${err.message}`),
    );
    return view;
  }

  async list(groupId: string, actor: GroupMember, query: ListExpensesQueryDto) {
    const limit = query.limit ?? DEFAULT_LIST_LIMIT;
    const qb = this.expenses
      .createQueryBuilder('e')
      .select('e.id', 'id')
      .where('e.group_id = :groupId', { groupId })
      .orderBy('e.spent_on', 'DESC')
      .addOrderBy('e.created_at', 'DESC')
      .addOrderBy('e.id', 'DESC')
      .limit(limit + 1); // one extra row tells us whether another page exists
    if (query.category)
      qb.andWhere('e.category = :category', { category: query.category });
    if (query.paidBy)
      qb.andWhere(
        'EXISTS (SELECT 1 FROM expense_payments p WHERE p.expense_id = e.id AND p.user_id = :paidBy)',
        { paidBy: query.paidBy },
      );
    if (query.involving) {
      qb.andWhere(
        '(EXISTS (SELECT 1 FROM expense_payments p WHERE p.expense_id = e.id AND p.user_id = :involving) OR EXISTS (SELECT 1 FROM expense_splits s WHERE s.expense_id = e.id AND s.user_id = :involving))',
        { involving: query.involving },
      );
    }
    if (query.from) qb.andWhere('e.spent_on >= :from', { from: query.from });
    if (query.to) qb.andWhere('e.spent_on <= :to', { to: query.to });
    if (query.before) {
      const cursor = await this.expenses.findOne({
        where: { id: query.before, groupId },
      });
      if (!cursor)
        throw new BadRequestException(
          'before must be an expense id from this group',
        );
      qb.andWhere('(e.spent_on, e.created_at, e.id) < (:cDay, :cAt, :cId)', {
        cDay: cursor.spentOn,
        cAt: cursor.createdAt,
        cId: cursor.id,
      });
    }

    const ids = (await qb.getRawMany<{ id: string }>()).map((r) => r.id);
    const pageIds = ids.slice(0, limit);
    const currency = await this.currency(groupId);
    const rows = pageIds.length ? await this.loadMany(pageIds) : [];
    const byId = new Map(rows.map((e) => [e.id, e]));
    return {
      items: pageIds.map((id) => this.toView(byId.get(id)!, currency, actor)),
      nextBefore: ids.length > limit ? pageIds[pageIds.length - 1] : null,
    };
  }

  async get(
    groupId: string,
    actor: GroupMember,
    expenseId: string,
  ): Promise<ExpenseView> {
    const expense = await this.findExpense(groupId, expenseId);
    return this.toView(expense, await this.currency(groupId), actor);
  }

  async update(
    groupId: string,
    actor: GroupMember,
    expenseId: string,
    dto: UpdateExpenseDto,
  ): Promise<ExpenseView> {
    const expense = await this.findExpense(groupId, expenseId);
    this.assertCanEdit(expense, actor);
    const memberIds = await this.currentMemberIds(groupId);
    const totalMinor =
      dto.amount !== undefined ? toMinor(dto.amount) : toMinor(expense.amount);

    // Who paid: re-set when the payers or the amount change.
    let payments: Map<string, number> | null = null;
    const payerIds = expense.payments.map((p) => p.userId);
    if (dto.paidBy !== undefined || dto.payments !== undefined) {
      // People who already paid it may stay on even if they've left the group since.
      payments = this.resolvePayments(
        totalMinor,
        dto.paidBy,
        dto.payments,
        expense.payerId,
        [...new Set([...memberIds, ...payerIds])],
      );
    } else if (totalMinor !== toMinor(expense.amount)) {
      if (payerIds.length > 1) {
        throw new BadRequestException(
          'Send the new payments when changing the amount of an expense several people paid',
        );
      }
      payments = new Map([[payerIds[0] ?? expense.payerId, totalMinor]]);
    }

    const splitType = dto.splitType ?? expense.splitType;
    const splitChanged =
      dto.amount !== undefined ||
      dto.splitType !== undefined ||
      dto.splitBetween !== undefined ||
      dto.shares !== undefined;

    let shares: Map<string, number> | null = null;
    if (splitChanged) {
      if (splitType === SplitType.CUSTOM && !dto.shares) {
        throw new BadRequestException(
          'Send the new shares when changing the amount or split of a CUSTOM expense',
        );
      }
      // Keep join order (ex-members last) so leftover paise land on the same people every time.
      const order = (id: string) =>
        memberIds.includes(id) ? memberIds.indexOf(id) : memberIds.length;
      const existingIds = expense.splits
        .map((s) => s.userId)
        .sort((a, b) => order(a) - order(b));
      // Re-splitting between the same people is allowed even if some have left the group since.
      const fallback =
        expense.splitType === SplitType.EQUAL ? existingIds : memberIds;
      const allowed = [...new Set([...memberIds, ...existingIds])];
      shares = this.resolveSplit(
        totalMinor,
        splitType,
        dto.splitBetween,
        dto.shares,
        fallback,
        allowed,
      );
    }

    await this.dataSource.transaction(async (manager) => {
      await manager.update(
        Expense,
        { id: expense.id },
        {
          ...(dto.amount !== undefined && {
            amount: minorToDecimal(totalMinor),
          }),
          ...(dto.category !== undefined && { category: dto.category }),
          ...(dto.date !== undefined && { spentOn: dto.date }),
          ...(dto.description !== undefined && {
            description: dto.description?.trim() || null,
          }),
          ...(payments && { payerId: mainPayer(payments) }),
          splitType,
          updatedAt: new Date(),
        },
      );
      if (shares) {
        await manager.delete(ExpenseSplit, { expenseId: expense.id });
        await manager.save(this.splitRows(expense.id, shares));
      }
      if (payments) {
        await manager.delete(ExpensePayment, { expenseId: expense.id });
        await manager.save(this.paymentRows(expense.id, payments));
      }
    });

    const view = await this.get(groupId, actor, expenseId);
    await this.announce(
      groupId,
      EXPENSE_EVENTS.UPDATED,
      { expenseId },
      actor.userId,
      view,
    );
    return view;
  }

  async remove(
    groupId: string,
    actor: GroupMember,
    expenseId: string,
  ): Promise<void> {
    const expense = await this.findExpense(groupId, expenseId);
    this.assertCanEdit(expense, actor);
    await this.expenses.delete({ id: expense.id }); // splits and payments cascade
    if (expense.receiptKey) await this.storage.delete(expense.receiptKey);
    await this.announce(
      groupId,
      EXPENSE_EVENTS.DELETED,
      { expenseId },
      actor.userId,
    );
  }

  // ---------------------------------------------------------------- receipts

  async putReceipt(
    groupId: string,
    actor: GroupMember,
    expenseId: string,
    file: UploadedReceipt | undefined,
  ) {
    const expense = await this.findExpense(groupId, expenseId);
    this.assertCanEdit(expense, actor);
    if (!file?.buffer?.length)
      throw new BadRequestException(
        'Attach the receipt as multipart field "file"',
      );
    if (file.size > RECEIPT_MAX_BYTES)
      throw new PayloadTooLargeException('Receipt must be 5 MB or smaller');
    const type = detectReceiptType(file.buffer);
    if (!type)
      throw new UnsupportedMediaTypeException(
        'Receipt must be a JPEG, PNG, WebP or HEIC photo, or a PDF',
      );

    const key = `receipts/${groupId}/${expenseId}/${randomUUID()}.${type.extension}`;
    await this.storage.put(key, file.buffer, type.contentType);
    await this.expenses.update(
      { id: expenseId },
      {
        receiptKey: key,
        receiptContentType: type.contentType,
        updatedAt: new Date(),
      },
    );
    if (expense.receiptKey) await this.storage.delete(expense.receiptKey);

    const view = await this.get(groupId, actor, expenseId);
    await this.announce(
      groupId,
      EXPENSE_EVENTS.UPDATED,
      { expenseId },
      actor.userId,
      view,
    );
    return view;
  }

  async getReceipt(groupId: string, expenseId: string) {
    const expense = await this.findExpense(groupId, expenseId);
    if (!expense.receiptKey || !expense.receiptContentType)
      throw new NotFoundException('This expense has no receipt');
    const data = await this.storage.get(expense.receiptKey);
    if (!data) throw new NotFoundException('Receipt file is missing');
    const extension = expense.receiptKey.split('.').pop();
    return {
      data,
      contentType: expense.receiptContentType,
      filename: `receipt-${expense.spentOn}-${expense.id.slice(0, 8)}.${extension}`,
    };
  }

  async deleteReceipt(groupId: string, actor: GroupMember, expenseId: string) {
    const expense = await this.findExpense(groupId, expenseId);
    this.assertCanEdit(expense, actor);
    if (expense.receiptKey) {
      await this.expenses.update(
        { id: expenseId },
        { receiptKey: null, receiptContentType: null, updatedAt: new Date() },
      );
      await this.storage.delete(expense.receiptKey);
      const view = await this.get(groupId, actor, expenseId);
      await this.announce(
        groupId,
        EXPENSE_EVENTS.UPDATED,
        { expenseId },
        actor.userId,
        view,
      );
      return view;
    }
    return this.get(groupId, actor, expenseId);
  }

  // ---------------------------------------------------------------- summary

  /** Totals, category breakdown, everyone's balance and the suggested "who pays whom". */
  async summary(groupId: string, actor: GroupMember) {
    const [currency, ledger, members, categories] = await Promise.all([
      this.currency(groupId),
      this.ledger(groupId),
      this.members.find({ where: { groupId }, relations: { user: true } }),
      this.expenses
        .createQueryBuilder('e')
        .select('e.category', 'category')
        .addSelect('SUM(e.amount)', 'total')
        .addSelect('COUNT(*)::int', 'count')
        .where('e.group_id = :groupId', { groupId })
        .groupBy('e.category')
        .getRawMany<{
          category: ExpenseCategory;
          total: string;
          count: number;
        }>(),
    ]);

    const balances = this.balances(ledger);
    const memberIds = new Set(members.map((m) => m.userId));
    // Everyone who's in the group or has money history in it (ex-members keep their balance).
    const people = await this.userSummaries([
      ...new Set([...memberIds, ...balances.keys()]),
    ]);

    const totalMinor = categories.reduce((sum, c) => sum + toMinor(c.total), 0);
    const byCategory = categories
      .map((c) => ({
        category: c.category,
        total: fromMinor(toMinor(c.total)),
        count: c.count,
        percent: totalMinor
          ? Math.round((toMinor(c.total) / totalMinor) * 1000) / 10
          : 0,
      }))
      .sort((a, b) => b.total - a.total);

    const get = (map: Map<string, number>, id: string) => map.get(id) ?? 0;
    const memberRows = [...people.values()]
      .map((u) => ({
        ...u,
        isMember: memberIds.has(u.userId),
        paid: fromMinor(get(ledger.paid, u.userId)),
        share: fromMinor(get(ledger.share, u.userId)),
        repaid: fromMinor(get(ledger.sent, u.userId)),
        received: fromMinor(get(ledger.received, u.userId)),
        balance: fromMinor(get(balances, u.userId)),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    const settleUpList = settleUp(balances).map((t) => ({
      from: people.get(t.fromUserId)!,
      to: people.get(t.toUserId)!,
      amount: fromMinor(t.amountMinor),
    }));

    return {
      currency,
      totalSpent: fromMinor(totalMinor),
      expenseCount: categories.reduce((n, c) => n + c.count, 0),
      byCategory,
      members: memberRows,
      settleUp: settleUpList,
      myBalance: fromMinor(get(balances, actor.userId)),
    };
  }

  // ---------------------------------------------------------------- settlements

  async createSettlement(
    groupId: string,
    actor: GroupMember,
    dto: CreateSettlementDto,
  ): Promise<SettlementView> {
    const fromUserId = dto.fromUserId ?? actor.userId;
    if (fromUserId === dto.toUserId)
      throw new BadRequestException(
        'fromUserId and toUserId must be different people',
      );
    if (
      actor.role !== GroupRole.ADMIN &&
      actor.userId !== fromUserId &&
      actor.userId !== dto.toUserId
    ) {
      throw new ForbiddenException(
        'You can only record repayments you made or received (admins can record any)',
      );
    }
    const participants = new Set([
      ...(await this.currentMemberIds(groupId)),
      ...this.balances(await this.ledger(groupId)).keys(),
    ]);
    if (!participants.has(fromUserId) || !participants.has(dto.toUserId)) {
      throw new BadRequestException(
        'Both people must be members of the group (or have expenses in it)',
      );
    }

    const saved = await this.settlements.save(
      this.settlements.create({
        groupId,
        fromUserId,
        toUserId: dto.toUserId,
        amount: minorToDecimal(toMinor(dto.amount)),
        paidOn: dto.date ?? today(),
        note: dto.note?.trim() || null,
        createdById: actor.userId,
      }),
    );
    const view = await this.getSettlement(groupId, actor, saved.id);
    await this.announce(
      groupId,
      EXPENSE_EVENTS.SETTLEMENT_RECORDED,
      { settlementId: saved.id },
      actor.userId,
    );
    this.pushSettlement(view, actor.userId).catch((err: Error) =>
      this.logger.warn(`Settlement push failed: ${err.message}`),
    );
    return view;
  }

  /** Newest first. Trip-sized, so not paged. */
  async listSettlements(
    groupId: string,
    actor: GroupMember,
  ): Promise<SettlementView[]> {
    const [rows, currency] = await Promise.all([
      this.settlements.find({
        where: { groupId },
        relations: { fromUser: true, toUser: true, createdBy: true },
        order: { paidOn: 'DESC', createdAt: 'DESC' },
      }),
      this.currency(groupId),
    ]);
    return rows.map((s) => this.toSettlementView(s, currency, actor));
  }

  async deleteSettlement(
    groupId: string,
    actor: GroupMember,
    settlementId: string,
  ): Promise<void> {
    const settlement = await this.settlements.findOne({
      where: { id: settlementId, groupId },
    });
    if (!settlement) throw new NotFoundException('Repayment not found');
    if (
      actor.role !== GroupRole.ADMIN &&
      actor.userId !== settlement.createdById
    ) {
      throw new ForbiddenException(
        'Only whoever recorded this repayment, or an admin, can delete it',
      );
    }
    await this.settlements.delete({ id: settlementId });
    await this.announce(
      groupId,
      EXPENSE_EVENTS.SETTLEMENT_DELETED,
      { settlementId },
      actor.userId,
    );
  }

  // ---------------------------------------------------------------- report data

  /** Everything the exported report needs, oldest expense first. */
  async reportData(groupId: string, actor: GroupMember) {
    const [group, summary, rows, settlements] = await Promise.all([
      this.groups.findOneByOrFail({ id: groupId }),
      this.summary(groupId, actor),
      this.expenses.find({
        where: { groupId },
        relations: EXPENSE_RELATIONS,
        order: { spentOn: 'ASC', createdAt: 'ASC' },
      }),
      this.listSettlements(groupId, actor),
    ]);
    const expenses = rows.map((e) => this.toView(e, group.currency, actor));
    return { group, summary, expenses, settlements: settlements.reverse() };
  }

  // ---------------------------------------------------------------- helpers

  /**
   * Works out each person's share in paise. `fallbackIds` = who splits an EQUAL expense when
   * `splitBetween` isn't sent; `allowedIds` = who may appear in the split.
   */
  private resolveSplit(
    totalMinor: number,
    splitType: SplitType,
    splitBetween: string[] | undefined,
    shares: { userId: string; amount: number }[] | undefined,
    fallbackIds: string[],
    allowedIds: string[],
  ): Map<string, number> {
    const allowed = new Set(allowedIds);
    if (splitType === SplitType.EQUAL) {
      if (shares)
        throw new BadRequestException(
          'shares is only for CUSTOM splits (use splitBetween for EQUAL)',
        );
      const ids = splitBetween ?? fallbackIds;
      if (!ids.length)
        throw new BadRequestException('Nobody to split this expense between');
      if (ids.some((id) => !allowed.has(id)))
        throw new BadRequestException(
          'Everyone in splitBetween must be a member of the group',
        );
      return splitEqually(totalMinor, ids);
    }

    if (splitBetween)
      throw new BadRequestException(
        'splitBetween is only for EQUAL splits (use shares for CUSTOM)',
      );
    if (!shares?.length)
      throw new BadRequestException('shares is required for a CUSTOM split');
    const result = new Map<string, number>();
    for (const share of shares) {
      if (result.has(share.userId))
        throw new BadRequestException(
          'Each member can appear only once in shares',
        );
      if (!allowed.has(share.userId))
        throw new BadRequestException(
          'Everyone in shares must be a member of the group',
        );
      result.set(share.userId, toMinor(share.amount));
    }
    const sum = [...result.values()].reduce((s, v) => s + v, 0);
    if (sum !== totalMinor) {
      throw new BadRequestException(
        `shares add up to ${minorToDecimal(sum)}, but the amount is ${minorToDecimal(totalMinor)}`,
      );
    }
    return result;
  }

  /**
   * Who paid, in paise: `payments` when several people paid (must add up to the amount),
   * otherwise `paidBy` (default `defaultPayerId`) paid it all. `allowedIds` = who may pay.
   */
  private resolvePayments(
    totalMinor: number,
    paidBy: string | undefined,
    payments: { userId: string; amount: number }[] | undefined,
    defaultPayerId: string,
    allowedIds: string[],
  ): Map<string, number> {
    const allowed = new Set(allowedIds);
    if (paidBy && payments)
      throw new BadRequestException(
        'Send paidBy (one payer) or payments (several), not both',
      );
    if (!payments) {
      const payerId = paidBy ?? defaultPayerId;
      if (!allowed.has(payerId))
        throw new BadRequestException('paidBy must be a member of the group');
      return new Map([[payerId, totalMinor]]);
    }

    const result = new Map<string, number>();
    for (const payment of payments) {
      if (result.has(payment.userId))
        throw new BadRequestException(
          'Each member can appear only once in payments',
        );
      if (!allowed.has(payment.userId))
        throw new BadRequestException(
          'Everyone in payments must be a member of the group',
        );
      result.set(payment.userId, toMinor(payment.amount));
    }
    const sum = [...result.values()].reduce((s, v) => s + v, 0);
    if (sum !== totalMinor) {
      throw new BadRequestException(
        `payments add up to ${minorToDecimal(sum)}, but the amount is ${minorToDecimal(totalMinor)}`,
      );
    }
    return result;
  }

  private paymentRows(
    expenseId: string,
    payments: Map<string, number>,
  ): ExpensePayment[] {
    return [...payments].map(([userId, minor]) =>
      this.payments.create({
        expenseId,
        userId,
        amount: minorToDecimal(minor),
      }),
    );
  }

  private splitRows(
    expenseId: string,
    shares: Map<string, number>,
  ): ExpenseSplit[] {
    return [...shares].map(([userId, minor]) =>
      this.splits.create({
        expenseId,
        userId,
        shareAmount: minorToDecimal(minor),
      }),
    );
  }

  private async ledger(groupId: string): Promise<Ledger> {
    const sumBy = async (sql: string): Promise<Map<string, number>> => {
      const rows = await this.dataSource.query<
        { user_id: string; total: string }[]
      >(sql, [groupId]);
      return new Map(rows.map((r) => [r.user_id, toMinor(r.total)]));
    };
    const [paid, share, sent, received] = await Promise.all([
      sumBy(
        'SELECT p.user_id, SUM(p.amount) AS total FROM expense_payments p JOIN expenses e ON e.id = p.expense_id WHERE e.group_id = $1 GROUP BY p.user_id',
      ),
      sumBy(
        'SELECT s.user_id, SUM(s.share_amount) AS total FROM expense_splits s JOIN expenses e ON e.id = s.expense_id WHERE e.group_id = $1 GROUP BY s.user_id',
      ),
      sumBy(
        'SELECT from_user_id AS user_id, SUM(amount) AS total FROM expense_settlements WHERE group_id = $1 GROUP BY from_user_id',
      ),
      sumBy(
        'SELECT to_user_id AS user_id, SUM(amount) AS total FROM expense_settlements WHERE group_id = $1 GROUP BY to_user_id',
      ),
    ]);
    return { paid, share, sent, received };
  }

  /** balance = paid − share + repaid − received. Positive: is owed money. Only non-zero balances. */
  private balances(ledger: Ledger): Map<string, number> {
    const ids = new Set([
      ...ledger.paid.keys(),
      ...ledger.share.keys(),
      ...ledger.sent.keys(),
      ...ledger.received.keys(),
    ]);
    const result = new Map<string, number>();
    for (const id of ids) {
      const balance =
        (ledger.paid.get(id) ?? 0) -
        (ledger.share.get(id) ?? 0) +
        (ledger.sent.get(id) ?? 0) -
        (ledger.received.get(id) ?? 0);
      if (balance !== 0) result.set(id, balance);
    }
    return result;
  }

  private async findExpense(
    groupId: string,
    expenseId: string,
  ): Promise<Expense> {
    const expense = await this.expenses.findOne({
      where: { id: expenseId, groupId },
      relations: EXPENSE_RELATIONS,
    });
    if (!expense) throw new NotFoundException('Expense not found');
    return expense;
  }

  private findByClientId(
    groupId: string,
    userId: string,
    clientId: string,
  ): Promise<Expense | null> {
    return this.expenses.findOne({
      where: { groupId, createdById: userId, clientId },
      relations: EXPENSE_RELATIONS,
    });
  }

  private loadMany(ids: string[]): Promise<Expense[]> {
    return this.expenses.find({
      where: { id: In(ids) },
      relations: EXPENSE_RELATIONS,
    });
  }

  private async getSettlement(
    groupId: string,
    actor: GroupMember,
    id: string,
  ): Promise<SettlementView> {
    const s = await this.settlements.findOneOrFail({
      where: { id, groupId },
      relations: { fromUser: true, toUser: true, createdBy: true },
    });
    return this.toSettlementView(s, await this.currency(groupId), actor);
  }

  private assertCanEdit(expense: Expense, actor: GroupMember): void {
    if (!this.canEdit(expense, actor)) {
      throw new ForbiddenException(
        'Only whoever recorded this expense, or an admin, can change it',
      );
    }
  }

  private canEdit(expense: Expense, actor: GroupMember): boolean {
    return (
      actor.role === GroupRole.ADMIN || expense.createdById === actor.userId
    );
  }

  private async currentMemberIds(groupId: string): Promise<string[]> {
    const members = await this.members.find({
      where: { groupId },
      select: { userId: true, joinedAt: true },
      order: { joinedAt: 'ASC' },
    });
    return members.map((m) => m.userId);
  }

  private async currency(groupId: string): Promise<string> {
    const group = await this.groups.findOne({
      where: { id: groupId },
      select: { id: true, currency: true },
    });
    return group?.currency ?? 'INR';
  }

  private async userSummaries(
    ids: string[],
  ): Promise<Map<string, UserSummary>> {
    if (!ids.length) return new Map();
    const users = await this.users.find({ where: { id: In(ids) } });
    return new Map(users.map((u) => [u.id, userSummary(u)]));
  }

  /**
   * Tells the group. `expense` (created/updated) goes out without the per-person fields
   * (`myShare`, `canEdit`), which each app works out for itself.
   */
  private async announce(
    groupId: string,
    event: ExpenseEvent,
    ids: { expenseId?: string; settlementId?: string },
    byUserId: string,
    expense?: ExpenseView,
  ) {
    let details: Omit<ExpenseView, 'myShare' | 'canEdit'> | undefined;
    if (expense) {
      const { myShare: _myShare, canEdit: _canEdit, ...rest } = expense;
      details = rest;
    }
    await this.realtime.emitToGroup(groupId, event, {
      groupId,
      ...ids,
      byUserId,
      timestamp: new Date(),
      ...(details && { expense: details }),
    });
  }

  // Fire-and-forget: tells everyone sharing a new expense what their part is.
  private async pushNewExpense(
    view: ExpenseView,
    actorId: string,
  ): Promise<void> {
    const group = await this.groups.findOne({
      where: { id: view.groupId },
      select: { id: true, name: true },
    });
    const label = view.description ?? categoryLabel(view.category);
    for (const split of view.splits) {
      if (split.userId === actorId) continue;
      await this.push.sendToUsers([split.userId], {
        title: group?.name ?? 'New expense',
        body: `${view.createdBy.name} added ${label}: ${money(view.amount, view.currency)}. Your share: ${money(split.amount, view.currency)}`,
        data: {
          type: 'EXPENSE_ADDED',
          groupId: view.groupId,
          expenseId: view.id,
        },
      });
    }
  }

  private async pushSettlement(
    view: SettlementView,
    actorId: string,
  ): Promise<void> {
    const other = actorId === view.to.userId ? view.from : view.to;
    if (other.userId === actorId) return;
    await this.push.sendToUsers([other.userId], {
      title: 'Repayment recorded',
      body: `${view.from.name} paid ${view.to.name} ${money(view.amount, view.currency)}`,
      data: {
        type: 'EXPENSE_SETTLEMENT',
        groupId: view.groupId,
        settlementId: view.id,
      },
    });
  }

  private toView(
    e: Expense,
    currency: string,
    actor: GroupMember,
  ): ExpenseView {
    const splits = e.splits
      .map((s) => ({
        ...userSummary(s.user),
        amount: fromMinor(toMinor(s.shareAmount)),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
    const payments = e.payments
      .map((p) => ({
        ...userSummary(p.user),
        amount: fromMinor(toMinor(p.amount)),
      }))
      .sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name));
    return {
      id: e.id,
      groupId: e.groupId,
      amount: fromMinor(toMinor(e.amount)),
      currency,
      category: e.category,
      date: e.spentOn,
      description: e.description,
      splitType: e.splitType,
      paidBy: userSummary(e.payer),
      payments,
      createdBy: userSummary(e.createdBy),
      splits,
      myShare: splits.find((s) => s.userId === actor.userId)?.amount ?? 0,
      hasReceipt: !!e.receiptKey,
      receiptContentType: e.receiptContentType,
      canEdit: this.canEdit(e, actor),
      createdAt: e.createdAt,
      updatedAt: e.updatedAt,
    };
  }

  private toSettlementView(
    s: ExpenseSettlement,
    currency: string,
    actor: GroupMember,
  ): SettlementView {
    return {
      id: s.id,
      groupId: s.groupId,
      from: userSummary(s.fromUser),
      to: userSummary(s.toUser),
      amount: fromMinor(toMinor(s.amount)),
      currency,
      date: s.paidOn,
      note: s.note,
      createdBy: userSummary(s.createdBy),
      canDelete:
        actor.role === GroupRole.ADMIN || actor.userId === s.createdById,
      createdAt: s.createdAt,
    };
  }
}

export function userSummary(user: User): UserSummary {
  return {
    userId: user.id,
    username: user.username,
    name: user.name,
    avatarUrl: user.avatarUrl,
  };
}

export function categoryLabel(category: ExpenseCategory): string {
  const words = category.toLowerCase().replace('_', ' / ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** "INR 1,200.50" — the app formats with its own locale; this is for pushes and reports. */
export function money(amount: number, currency: string): string {
  return `${currency} ${amount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Whoever paid the most; on a tie, the first listed. */
function mainPayer(payments: Map<string, number>): string {
  let best: [string, number] | null = null;
  for (const entry of payments) if (!best || entry[1] > best[1]) best = entry;
  return best![0];
}

function isUniqueViolation(err: unknown): boolean {
  return (
    err instanceof QueryFailedError &&
    (err.driverError as { code?: string }).code === '23505'
  );
}

/** Today in the server's timezone, YYYY-MM-DD. */
function today(): string {
  return new Date().toLocaleDateString('en-CA');
}
