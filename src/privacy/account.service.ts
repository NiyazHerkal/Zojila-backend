import { randomBytes, randomUUID } from 'node:crypto';
import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { DataSource, IsNull, Repository } from 'typeorm';
import {
  DeviceToken,
  Expense,
  ExpenseSettlement,
  ActivityAttendance,
  ActivityUpdate,
  ExpensePayment,
  ExpenseSplit,
  Feedback,
  Group,
  GroupMember,
  GroupRole,
  Invite,
  InviteStatus,
  LocationShare,
  LocationShareLink,
  Notification,
  Message,
  StatusUpdate,
  SavedPlace,
  UsageDaily,
  User,
} from '../database/entities/index.js';
import { GroupEventsService } from '../groups/group-events.service.js';
import { GroupsService } from '../groups/groups.service.js';
import { LiveShareService } from '../location/live-share.service.js';
import { RealtimeService } from '../realtime/realtime.service.js';
import { StorageService } from '../storage/storage.service.js';

export const DELETED_USER_NAME = 'Deleted user';

/**
 * GDPR rights (PDF §4 "GDPR and applicable data-protection compliance"): a user can download
 * everything stored about them, and delete their account.
 *
 * Deleting doesn't remove the user row: other members' chat history, expense splits and
 * balances refer to it. Instead every personal field is scrubbed (name → "Deleted user", no
 * email/phone/avatar, random username and password), memberships and devices are removed, and
 * groups where they were the only member are deleted.
 */
@Injectable()
export class AccountService {
  private readonly logger = new Logger(AccountService.name);

  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly dataSource: DataSource,
    private readonly groups: GroupsService,
    private readonly groupEvents: GroupEventsService,
    private readonly liveShare: LiveShareService,
    private readonly realtime: RealtimeService,
    private readonly storage: StorageService,
  ) {}

  /** Everything stored about the user, as JSON. Live positions aren't stored, so they're not here. */
  async export(userId: string) {
    const user = await this.activeUser(userId);
    const m = this.dataSource.manager;
    const [memberships, messages, statuses, expensesPaid, expensesRecorded, shares, repayments, invitesSent, invitesReceived, devices, locationShares, feedback, activityUpdates, liveLinks, savedPlaces, arrivals, notifications] =
      await Promise.all([
        m.find(GroupMember, { where: { userId }, relations: { group: true }, order: { joinedAt: 'ASC' } }),
        m.find(Message, { where: { senderId: userId }, order: { createdAt: 'ASC' } }),
        m.find(StatusUpdate, { where: { userId }, order: { createdAt: 'ASC' } }),
        m.find(ExpensePayment, { where: { userId }, relations: { expense: true } }),
        m.find(Expense, { where: { createdById: userId }, select: { id: true, groupId: true }, order: { spentOn: 'ASC' } }),
        m.find(ExpenseSplit, { where: { userId }, relations: { expense: true } }),
        m.find(ExpenseSettlement, { where: [{ fromUserId: userId }, { toUserId: userId }], order: { paidOn: 'ASC' } }),
        m.find(Invite, { where: { invitedById: userId }, order: { createdAt: 'ASC' } }),
        m.find(Invite, { where: { inviteeUserId: userId }, order: { createdAt: 'ASC' } }),
        m.find(DeviceToken, { where: { userId } }),
        m.find(LocationShare, { where: { userId } }),
        m.find(Feedback, { where: { userId }, order: { createdAt: 'ASC' } }),
        m.find(ActivityUpdate, { where: { userId, deletedAt: IsNull() }, order: { createdAt: 'ASC' } }),
        m.find(LocationShareLink, { where: { userId }, order: { startedAt: 'ASC' } }),
        m.find(SavedPlace, { where: { userId }, order: { createdAt: 'ASC' } }),
        m.find(ActivityAttendance, { where: { userId }, order: { arrivedAt: 'ASC' } }),
        m.find(Notification, { where: { userId }, order: { createdAt: 'ASC' } }),
      ]);

    return {
      exportedAt: new Date(),
      profile: {
        id: user.id,
        username: user.username,
        name: user.name,
        email: user.email,
        phone: user.phone,
        avatarUrl: user.avatarUrl,
        emailVerified: user.emailVerified,
        phoneVerified: user.phoneVerified,
        createdAt: user.createdAt,
        lastSeenAt: user.lastSeenAt,
      },
      groups: memberships.map((g) => ({ groupId: g.groupId, name: g.group.name, role: g.role, joinedAt: g.joinedAt })),
      messages: messages.map((x) => ({
        id: x.id,
        groupId: x.groupId,
        type: x.type,
        kind: x.kind,
        category: x.category,
        body: x.body,
        location: x.location,
        voiceDurationMs: x.voiceDurationMs, // the recording itself plays in the app
        createdAt: x.createdAt,
      })),
      activityUpdates: activityUpdates.map((u) => ({
        groupId: u.groupId,
        activityId: u.stopKey,
        text: u.text,
        createdAt: u.createdAt,
        editedAt: u.editedAt,
      })),
      statusUpdates: statuses.map((s) => ({ groupId: s.groupId, status: s.status, note: s.note, createdAt: s.createdAt })),
      expensesPaid: expensesPaid
        .map(({ expense: e, amount }) => ({
          id: e.id,
          groupId: e.groupId,
          amount: Number(e.amount),
          paidAmount: Number(amount), // your part, when several people paid
          category: e.category,
          date: e.spentOn,
          description: e.description,
          hasReceipt: !!e.receiptKey,
          createdAt: e.createdAt,
        }))
        .sort((a, b) => a.date.localeCompare(b.date)),
      expensesRecorded: expensesRecorded.map((e) => e.id),
      expenseShares: shares.map((s) => ({ expenseId: s.expenseId, groupId: s.expense.groupId, amount: Number(s.shareAmount) })),
      repayments: repayments.map((r) => ({
        groupId: r.groupId,
        direction: r.fromUserId === userId ? 'PAID' : 'RECEIVED',
        otherUserId: r.fromUserId === userId ? r.toUserId : r.fromUserId,
        amount: Number(r.amount),
        date: r.paidOn,
        note: r.note,
      })),
      invitesSent: invitesSent.map((i) => ({
        groupId: i.groupId,
        channel: i.channel,
        inviteeEmail: i.inviteeEmail,
        inviteePhone: i.inviteePhone,
        status: i.status,
        createdAt: i.createdAt,
      })),
      invitesReceived: invitesReceived.map((i) => ({ groupId: i.groupId, channel: i.channel, status: i.status, createdAt: i.createdAt })),
      devices: devices.map((d) => ({ platform: d.platform, registeredAt: d.createdAt })),
      locationSharing: locationShares.map((s) => ({ groupId: s.groupId, duration: s.duration, startedAt: s.startedAt, expiresAt: s.expiresAt })),
      liveLocationLinks: liveLinks.map((l) => ({
        recipientLabel: l.recipientLabel,
        duration: l.duration,
        startedAt: l.startedAt,
        expiresAt: l.expiresAt,
        endedAt: l.endedAt,
        firstViewedAt: l.firstViewedAt,
      })),
      feedback: feedback.map((f) => ({ category: f.category, message: f.message, rating: f.rating, status: f.status, createdAt: f.createdAt })),
      savedPlaces: savedPlaces.map((p) => ({
        source: p.source,
        providerPlaceId: p.providerPlaceId,
        name: p.name,
        lat: p.lat,
        lng: p.lng,
        address: p.address,
        category: p.category,
        savedAt: p.createdAt,
      })),
      activityArrivals: arrivals.map((a) => ({ groupId: a.groupId, activityId: a.stopKey, arrivedAt: a.arrivedAt })),
      notifications: notifications.map((n) => ({ type: n.type, groupId: n.groupId, title: n.title, body: n.body, createdAt: n.createdAt, readAt: n.readAt })),
      notes: [
        'Live location positions are never stored: only your latest position is kept while you share, and removed when sharing ends.',
        'Receipt files are attached to the expenses they belong to; download them from the expense in the app.',
      ],
    };
  }

  /** Deletes (anonymises) the account. Needs the current password, so a stolen phone alone can't. */
  async delete(userId: string, password: string): Promise<void> {
    const user = await this.activeUser(userId);
    if (!(await bcrypt.compare(password, user.passwordHash))) throw new UnauthorizedException('Wrong password');

    // Live links end first, so their viewers are told and disconnected.
    await this.liveShare.stopAll(userId);

    const reportIds: string[] = [];
    const leftGroups: { groupId: string; wasSharing: boolean }[] = [];
    const promoted: { groupId: string; userId: string }[] = [];
    const groupsToDelete = await this.dataSource.transaction(async (manager) => {
      const memberships = await manager.find(GroupMember, { where: { userId } });
      const soleMemberGroups: string[] = [];
      for (const membership of memberships) {
        // Lock the group so concurrent role changes can't leave it without an admin.
        await manager.findOne(Group, { where: { id: membership.groupId }, lock: { mode: 'pessimistic_write' } });
        const others = await manager.find(GroupMember, {
          where: { groupId: membership.groupId },
          order: { joinedAt: 'ASC' },
        });
        const rest = others.filter((o) => o.userId !== userId);
        if (!rest.length) {
          soleMemberGroups.push(membership.groupId);
          continue;
        }
        // Never leave a group without an admin: promote the longest-standing member.
        if (membership.role === GroupRole.ADMIN && !rest.some((o) => o.role === GroupRole.ADMIN)) {
          await manager.update(GroupMember, { groupId: membership.groupId, userId: rest[0].userId }, { role: GroupRole.ADMIN });
          promoted.push({ groupId: membership.groupId, userId: rest[0].userId });
        }
        const wasSharing = await manager.existsBy(LocationShare, { groupId: membership.groupId, userId });
        await manager.delete(GroupMember, { groupId: membership.groupId, userId }); // ends location sharing too
        leftGroups.push({ groupId: membership.groupId, wasSharing });
      }

      await manager.delete(DeviceToken, { userId });
      await manager.delete(LocationShareLink, { userId });
      await manager.delete(SavedPlace, { userId });
      await manager.delete(ActivityAttendance, { userId });
      await manager.delete(Notification, { userId });
      await manager.delete(UsageDaily, { userId });
      // Feedback can contain anything the person typed: it goes with the account (screenshots after commit).
      const reports = await manager.find(Feedback, { where: { userId }, select: { id: true } });
      reportIds.push(...reports.map((r) => r.id));
      await manager.delete(Feedback, { userId });
      await manager.update(Invite, { inviteeUserId: userId, status: InviteStatus.PENDING }, { status: InviteStatus.REVOKED });
      await manager.update(User, { id: userId }, {
        username: `deleted_${randomUUID().replace(/-/g, '').slice(0, 12)}`,
        name: DELETED_USER_NAME,
        email: null,
        phone: null,
        avatarUrl: null,
        avatarKey: null,
        avatarContentType: null,
        passwordHash: await bcrypt.hash(randomBytes(32).toString('hex'), 10),
        emailVerified: false,
        phoneVerified: false,
        otpCodeHash: null,
        otpExpiresAt: null,
        otpPurpose: null,
        passwordResetTokenHash: null,
        passwordResetExpiresAt: null,
        refreshTokenHash: null,
        lastSeenAt: null,
        deletedAt: new Date(),
      });
      return soleMemberGroups;
    });

    // Groups nobody else was in go completely (rows cascade; receipt files via GroupsService).
    for (const groupId of groupsToDelete) await this.groups.remove(groupId);
    for (const id of reportIds) await this.storage.deletePrefix(`feedback/${id}`);
    await this.storage.deletePrefix(`avatars/${userId}`);
    for (const g of leftGroups) await this.groupEvents.memberRemoved(g.groupId, userId, userId, g.wasSharing);
    for (const p of promoted) await this.groupEvents.roleChanged(p.groupId, p.userId, GroupRole.ADMIN, null);
    this.realtime.disconnectUser(userId);
    this.logger.log(`Account ${userId} deleted (${groupsToDelete.length} sole-member group(s) removed)`);
  }

  private async activeUser(userId: string): Promise<User> {
    const user = await this.users.findOne({ where: { id: userId } });
    if (!user || user.deletedAt) throw new UnauthorizedException('This account has been deleted');
    return user;
  }
}
