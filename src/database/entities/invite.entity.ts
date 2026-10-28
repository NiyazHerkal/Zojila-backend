import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import type { Relation } from 'typeorm';
import { InviteChannel, InviteStatus } from './enums.js';
import { Group } from './group.entity.js';
import { User } from './user.entity.js';

/**
 * Two kinds of invite:
 * - LINK: multi-use shareable link plus a short code for the same invite. Only SHA-256 hashes
 *   of the token and code are stored; stays PENDING until it expires or an admin revokes it.
 * - SMS / EMAIL: addressed to one person (invitee email/phone, plus their user id if already
 *   registered). Shows up in their pending invitations; they accept or reject once.
 */
@Entity('invites')
export class Invite {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'group_id' })
  groupId!: string;

  @Column({ name: 'token_hash', type: 'varchar', unique: true, nullable: true })
  tokenHash!: string | null;

  /** LINK only: hash of the short code people type in (e.g. 7K2Q-MX4P). Null for older links. */
  @Column({ name: 'code_hash', type: 'varchar', unique: true, nullable: true })
  codeHash!: string | null;

  @Column({ type: 'enum', enum: InviteChannel })
  channel!: InviteChannel;

  @Column({ type: 'enum', enum: InviteStatus, default: InviteStatus.PENDING })
  status!: InviteStatus;

  @Column({ name: 'invitee_email', type: 'varchar', nullable: true })
  inviteeEmail!: string | null;

  @Column({ name: 'invitee_phone', type: 'varchar', nullable: true })
  inviteePhone!: string | null;

  @Column({ name: 'invitee_user_id', type: 'uuid', nullable: true })
  inviteeUserId!: string | null;

  @Column({ name: 'invited_by' })
  invitedById!: string;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt!: Date;

  @Column({ name: 'responded_at', type: 'timestamptz', nullable: true })
  respondedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @ManyToOne(() => Group, (group) => group.invites, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'group_id' })
  group!: Relation<Group>;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'invitee_user_id' })
  inviteeUser!: Relation<User> | null;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'invited_by' })
  invitedBy!: Relation<User>;
}
