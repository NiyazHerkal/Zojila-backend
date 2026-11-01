import {
  Column,
  CreateDateColumn,
  Entity,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import type { Relation } from 'typeorm';
import { OtpPurpose } from './enums.js';
import { Group } from './group.entity.js';
import { GroupMember } from './group-member.entity.js';
import { Itinerary } from './itinerary.entity.js';
import { Message } from './message.entity.js';
import { StatusUpdate } from './status-update.entity.js';
import { Expense } from './expense.entity.js';
import { ExpenseSplit } from './expense-split.entity.js';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', unique: true, nullable: true })
  email!: string | null;

  @Column({ type: 'varchar', unique: true, nullable: true })
  phone!: string | null;

  // Public handle, stored lowercase (see IsUsernamePolicy). Used to find/add people (PDF §2.2).
  @Column({ type: 'varchar', unique: true })
  username!: string;

  @Column({ name: 'password_hash' })
  passwordHash!: string;

  @Column()
  name!: string;

  @Column({ name: 'avatar_url', type: 'varchar', nullable: true })
  avatarUrl!: string | null;

  // Set when the picture was uploaded (POST /auth/me/avatar); avatarUrl then points at our API.
  // Null when there's no picture or avatarUrl is an external URL sent by the app.
  @Column({ name: 'avatar_key', type: 'varchar', nullable: true })
  avatarKey!: string | null;

  @Column({ name: 'avatar_content_type', type: 'varchar', length: 40, nullable: true })
  avatarContentType!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  // When the user's last app connection closed (presence "last seen"). Null = never connected.
  @Column({ name: 'last_seen_at', type: 'timestamptz', precision: 3, nullable: true })
  lastSeenAt!: Date | null;

  // Verification (Sign Up requires email/SMS verification before activation)
  @Column({ name: 'email_verified', default: false })
  emailVerified!: boolean;

  @Column({ name: 'phone_verified', default: false })
  phoneVerified!: boolean;

  @Column({ name: 'otp_code_hash', type: 'varchar', nullable: true })
  otpCodeHash!: string | null;

  @Column({ name: 'otp_expires_at', type: 'timestamptz', nullable: true })
  otpExpiresAt!: Date | null;

  @Column({ name: 'otp_purpose', type: 'enum', enum: OtpPurpose, nullable: true })
  otpPurpose!: OtpPurpose | null;

  // Wrong guesses against the current OTP; the code is cancelled after 5 (brute-force guard).
  @Column({ name: 'otp_attempts', default: 0 })
  otpAttempts!: number;

  // Password reset
  @Column({ name: 'password_reset_token_hash', type: 'varchar', nullable: true })
  passwordResetTokenHash!: string | null;

  @Column({ name: 'password_reset_expires_at', type: 'timestamptz', nullable: true })
  passwordResetExpiresAt!: Date | null;

  @Column({ name: 'password_reset_attempts', default: 0 })
  passwordResetAttempts!: number;

  // Refresh token rotation — hash only, never store raw tokens
  @Column({ name: 'refresh_token_hash', type: 'varchar', nullable: true })
  refreshTokenHash!: string | null;

  // Set when the user deletes their account (GDPR). The row stays, scrubbed of personal data,
  // so other members' chat history and expense balances keep working ("Deleted user").
  @Column({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt!: Date | null;

  @OneToMany(() => Group, (group) => group.creator)
  createdGroups!: Relation<Group>[];

  @OneToMany(() => GroupMember, (member) => member.user)
  memberships!: Relation<GroupMember>[];

  @OneToMany(() => Itinerary, (itinerary) => itinerary.creator)
  createdItineraries!: Relation<Itinerary>[];


  @OneToMany(() => Message, (message) => message.sender)
  messages!: Relation<Message>[];

  @OneToMany(() => StatusUpdate, (status) => status.user)
  statusUpdates!: Relation<StatusUpdate>[];

  @OneToMany(() => Expense, (expense) => expense.payer)
  expensesPaid!: Relation<Expense>[];

  @OneToMany(() => ExpenseSplit, (split) => split.user)
  expenseSplits!: Relation<ExpenseSplit>[];
}
