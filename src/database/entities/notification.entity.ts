import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import type { Relation } from 'typeorm';
import { Group } from './group.entity.js';
import { User } from './user.entity.js';

/**
 * One entry in a user's notifications feed (backend handover 2026-10-22, Q2): alerts & SOS, trip
 * and membership changes, expenses. Written whether or not the user has a phone registered for
 * push. Chat and location-sharing pushes aren't kept here. Deleted after 90 days.
 */
@Entity('notifications')
@Index(['userId', 'createdAt'])
export class Notification {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'user_id' })
  userId!: string;

  @Column({ name: 'group_id', type: 'uuid', nullable: true })
  groupId!: string | null;

  /** Same values as the push `data.type`, e.g. SOS, EXPENSE_ADDED, MEMBER_ADDED. */
  @Column({ type: 'varchar', length: 40 })
  type!: string;

  @Column({ type: 'varchar', length: 200 })
  title!: string;

  @Column({ type: 'varchar', length: 1000 })
  body!: string;

  /** The ids the app needs to open the right screen (groupId, alertId, expenseId…), as strings. */
  @Column({ type: 'jsonb', default: {} })
  data!: Record<string, string>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz', precision: 3 })
  createdAt!: Date;

  @Column({ name: 'read_at', type: 'timestamptz', precision: 3, nullable: true })
  readAt!: Date | null;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user!: Relation<User>;

  @ManyToOne(() => Group, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'group_id' })
  group!: Relation<Group> | null;
}
