import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import type { Relation } from 'typeorm';
import { DevicePlatform, FeedbackCategory, FeedbackStatus } from './enums.js';
import { Group } from './group.entity.js';
import { User } from './user.entity.js';

/**
 * In-app feedback / bug reports (PDF Phase 13 "structured feedback capture"). Sent from the
 * app with device details, optionally a screenshot; the team is emailed and triages them
 * through the ops endpoints.
 */
@Entity('feedback')
@Index(['status', 'createdAt'])
export class Feedback {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'user_id' })
  userId!: string;

  // The trip it's about, if any. Kept if the trip is deleted (the report is still useful).
  @Column({ name: 'group_id', type: 'uuid', nullable: true })
  groupId!: string | null;

  @Column({ type: 'enum', enum: FeedbackCategory })
  category!: FeedbackCategory;

  @Column({ type: 'varchar', length: 4000 })
  message!: string;

  @Column({ type: 'smallint', nullable: true })
  rating!: number | null;

  // Where in the app, e.g. "expenses/summary".
  @Column({ type: 'varchar', length: 80, nullable: true })
  screen!: string | null;

  @Column({ name: 'app_version', type: 'varchar', length: 40, nullable: true })
  appVersion!: string | null;

  @Column({ type: 'enum', enum: DevicePlatform, nullable: true })
  platform!: DevicePlatform | null;

  @Column({ name: 'os_version', type: 'varchar', length: 40, nullable: true })
  osVersion!: string | null;

  @Column({ name: 'device_model', type: 'varchar', length: 80, nullable: true })
  deviceModel!: string | null;

  @Column({ name: 'screenshot_key', type: 'varchar', nullable: true })
  screenshotKey!: string | null;

  @Column({ name: 'screenshot_content_type', type: 'varchar', nullable: true })
  screenshotContentType!: string | null;

  @Column({ type: 'enum', enum: FeedbackStatus, default: FeedbackStatus.NEW })
  status!: FeedbackStatus;

  // The team's triage note.
  @Column({ name: 'ops_note', type: 'varchar', length: 1000, nullable: true })
  opsNote!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz', precision: 3 })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz', precision: 3 })
  updatedAt!: Date;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user!: Relation<User>;

  @ManyToOne(() => Group, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'group_id' })
  group!: Relation<Group> | null;
}
