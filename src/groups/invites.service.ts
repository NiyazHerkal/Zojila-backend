import { createHash, randomBytes } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  GoneException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, FindOptionsWhere, MoreThan, Repository } from 'typeorm';
import {
  Group,
  GroupMember,
  GroupRole,
  Invite,
  InviteChannel,
  InviteStatus,
  User,
} from '../database/entities/index.js';
import { CLOSED_TRIP_MESSAGE } from './guards/group-member.guard.js';
import { InviteDeliveryService } from '../notifications/invite-delivery.service.js';
import { GroupEventsService } from './group-events.service.js';
import type { CreateInviteDto } from './dto/create-invite.dto.js';

const DEFAULT_INVITE_TTL_DAYS = 7;
const DEFAULT_INVITE_LINK_BASE_URL = 'https://travelgo.app/invite';

@Injectable()
export class InvitesService {
  constructor(
    @InjectRepository(Invite) private readonly invites: Repository<Invite>,
    @InjectRepository(Group) private readonly groups: Repository<Group>,
    @InjectRepository(GroupMember) private readonly members: Repository<GroupMember>,
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly dataSource: DataSource,
    private readonly config: ConfigService,
    private readonly delivery: InviteDeliveryService,
    private readonly events: GroupEventsService,
  ) {}

  // --- admin side (group-scoped) ---

  async create(groupId: string, inviterId: string, dto: CreateInviteDto) {
    const expiresAt = new Date(Date.now() + (dto.expiresInDays ?? DEFAULT_INVITE_TTL_DAYS) * 86_400_000);

    if (dto.channel === InviteChannel.LINK) {
      // Raw token is returned once and never stored — only its hash.
      const token = randomBytes(32).toString('base64url');
      const invite = await this.invites.save(
        this.invites.create({
          groupId,
          channel: InviteChannel.LINK,
          tokenHash: this.hashToken(token),
          invitedById: inviterId,
          expiresAt,
        }),
      );
      return { ...this.toView(invite), token, link: `${this.linkBaseUrl()}/${token}` };
    }

    const email = dto.channel === InviteChannel.EMAIL ? dto.email : undefined;
    const phone = dto.channel === InviteChannel.SMS ? dto.phone : undefined;
    if (!email && !phone) throw new BadRequestException(`${dto.channel === InviteChannel.EMAIL ? 'email' : 'phone'} is required`);

    const registered = await this.users.findOne({ where: email ? { email } : { phone } });
    if (registered && (await this.members.existsBy({ groupId, userId: registered.id }))) {
      throw new ConflictException('That user is already a member of this group');
    }

    const duplicate = await this.invites.existsBy({
      groupId,
      status: InviteStatus.PENDING,
      expiresAt: MoreThan(new Date()),
      ...(email ? { inviteeEmail: email } : { inviteePhone: phone }),
    });
    if (duplicate) {
      throw new ConflictException('A pending invite already exists for this person — revoke it to send a new one');
    }

    const invite = await this.invites.save(
      this.invites.create({
        groupId,
        channel: dto.channel,
        inviteeEmail: email ?? null,
        inviteePhone: phone ?? null,
        inviteeUserId: registered?.id ?? null,
        invitedById: inviterId,
        expiresAt,
      }),
    );

    const [group, inviter] = await Promise.all([
      this.groups.findOneByOrFail({ id: groupId }),
      this.users.findOneByOrFail({ id: inviterId }),
    ]);
    const text =
      `${inviter.name} (@${inviter.username}) invited you to join "${group.name}" on TravelGo. ` +
      `Sign in or sign up with this ${email ? 'email address' : 'phone number'} to accept.`;
    if (email) await this.delivery.sendEmail(email, `Join "${group.name}" on TravelGo`, text);
    if (phone) await this.delivery.sendSms(phone, text);

    return this.toView(invite);
  }

  async listForGroup(groupId: string) {
    const invites = await this.invites.find({
      where: { groupId, status: InviteStatus.PENDING, expiresAt: MoreThan(new Date()) },
      relations: { invitedBy: true },
      order: { createdAt: 'DESC' },
    });
    return invites.map((i) => this.toView(i));
  }

  async revoke(groupId: string, inviteId: string): Promise<void> {
    const result = await this.invites.update(
      { id: inviteId, groupId, status: InviteStatus.PENDING },
      { status: InviteStatus.REVOKED },
    );
    if (!result.affected) throw new NotFoundException('Pending invite not found');
  }

  // --- invitee side ---

  /** Pending SMS/email invites addressed to the current user (by id, or verified email/phone). */
  async listMine(userId: string) {
    const user = await this.users.findOneByOrFail({ id: userId });
    const base = { status: InviteStatus.PENDING, expiresAt: MoreThan(new Date()) };
    const where: FindOptionsWhere<Invite>[] = [{ ...base, inviteeUserId: user.id }];
    if (user.email && user.emailVerified) where.push({ ...base, inviteeEmail: user.email });
    if (user.phone && user.phoneVerified) where.push({ ...base, inviteePhone: user.phone });

    const invites = await this.invites.find({
      where,
      relations: { group: true, invitedBy: true },
      order: { createdAt: 'DESC' },
    });
    return invites.map((i) => ({ ...this.toView(i), group: this.toGroupSummary(i.group) }));
  }

  async respond(userId: string, inviteId: string, accept: boolean) {
    const user = await this.users.findOneByOrFail({ id: userId });
    const invite = await this.invites.findOne({ where: { id: inviteId } });
    if (!invite || invite.channel === InviteChannel.LINK || !this.isAddressedTo(invite, user)) {
      throw new NotFoundException('Invite not found');
    }
    if (invite.status !== InviteStatus.PENDING) {
      throw new ConflictException(`Invite has already been ${invite.status.toLowerCase()}`);
    }
    if (invite.expiresAt < new Date()) throw new GoneException('Invite has expired');

    const joined = await this.dataSource.transaction(async (manager) => {
      // Conditional on PENDING so a concurrent revoke/response can't be overwritten.
      const result = await manager.update(
        Invite,
        { id: invite.id, status: InviteStatus.PENDING },
        {
          status: accept ? InviteStatus.ACCEPTED : InviteStatus.REJECTED,
          inviteeUserId: user.id,
          respondedAt: new Date(),
        },
      );
      if (!result.affected) throw new ConflictException('Invite is no longer pending');
      return accept && (await this.joinAsViewer(manager, invite.groupId, user.id));
    });
    if (joined) await this.events.memberJoined(invite.groupId, user.id, 'INVITE', invite.invitedById);

    return { groupId: invite.groupId, status: accept ? InviteStatus.ACCEPTED : InviteStatus.REJECTED };
  }

  async previewLink(userId: string, token: string) {
    const invite = await this.findActiveLink(token);
    const alreadyMember = await this.members.existsBy({ groupId: invite.groupId, userId });
    return {
      group: this.toGroupSummary(invite.group),
      invitedBy: this.toUserSummary(invite.invitedBy),
      expiresAt: invite.expiresAt,
      alreadyMember,
    };
  }

  async acceptLink(userId: string, token: string) {
    const invite = await this.findActiveLink(token);
    const joined = await this.dataSource.transaction((manager) => this.joinAsViewer(manager, invite.groupId, userId));
    if (joined) await this.events.memberJoined(invite.groupId, userId, 'LINK', invite.invitedById);
    return { groupId: invite.groupId };
  }

  // --- internals ---

  private async findActiveLink(token: string): Promise<Invite> {
    const invite = await this.invites.findOne({
      where: {
        tokenHash: this.hashToken(token),
        channel: InviteChannel.LINK,
        status: InviteStatus.PENDING,
        expiresAt: MoreThan(new Date()),
      },
      relations: { group: true, invitedBy: true },
    });
    if (!invite) throw new NotFoundException('Invite link is invalid, revoked or expired');
    return invite;
  }

  // Idempotent: accepting an invite to a group you're already in is a no-op, not an error.
  // Returns whether the user actually joined (false = was already a member).
  private async joinAsViewer(manager: EntityManager, groupId: string, userId: string): Promise<boolean> {
    const group = await manager.findOne(Group, { where: { id: groupId }, select: { id: true, closedAt: true } });
    if (group?.closedAt) throw new ConflictException(CLOSED_TRIP_MESSAGE);
    const result = await manager
      .createQueryBuilder()
      .insert()
      .into(GroupMember)
      .values({ groupId, userId, role: GroupRole.VIEWER })
      .orIgnore()
      .returning('user_id')
      .execute();
    return (result.raw as unknown[]).length > 0;
  }

  private isAddressedTo(invite: Invite, user: User): boolean {
    return (
      invite.inviteeUserId === user.id ||
      (!!invite.inviteeEmail && user.emailVerified && invite.inviteeEmail === user.email) ||
      (!!invite.inviteePhone && user.phoneVerified && invite.inviteePhone === user.phone)
    );
  }

  // Link tokens are 256-bit random, so a fast hash is enough (same reasoning as refresh tokens).
  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private linkBaseUrl(): string {
    return this.config.get<string>('INVITE_LINK_BASE_URL', DEFAULT_INVITE_LINK_BASE_URL).replace(/\/+$/, '');
  }

  private toView(invite: Invite) {
    return {
      id: invite.id,
      groupId: invite.groupId,
      channel: invite.channel,
      status: invite.status,
      inviteeEmail: invite.inviteeEmail,
      inviteePhone: invite.inviteePhone,
      invitedBy: invite.invitedBy ? this.toUserSummary(invite.invitedBy) : { id: invite.invitedById },
      expiresAt: invite.expiresAt,
      createdAt: invite.createdAt,
    };
  }

  private toUserSummary(user: User) {
    return { id: user.id, username: user.username, name: user.name };
  }

  private toGroupSummary(group: Group) {
    const { id, name, description, tripStart, tripEnd } = group;
    return { id, name, description, tripStart, tripEnd };
  }
}
