import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import type { Relation } from 'typeorm';
import { TripStatus } from './enums.js';
import { Group } from './group.entity.js';
import { User } from './user.entity.js';

@Entity('status_updates')
@Index(['groupId', 'userId', 'createdAt'])
// Re-sending the same client_id (an offline queue retrying) returns the original update.
@Index('UQ_status_updates_user_client_id', ['userId', 'clientId'], { unique: true, where: '"client_id" IS NOT NULL' })
export class StatusUpdate {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'user_id' })
  userId!: string;

  @Column({ name: 'group_id' })
  groupId!: string;

  @Column({ type: 'enum', enum: TripStatus })
  status!: TripStatus;

  // Optional context, e.g. what help is needed or why the group stopped.
  @Column({ type: 'varchar', length: 280, nullable: true })
  note!: string | null;

  @Column({ name: 'client_id', type: 'varchar', length: 64, nullable: true })
  clientId!: string | null;

  // When it happened: now, or the recordedAt the app sent for a status set offline.
  // timestamptz(3) = millisecond precision, matching JS Dates, so history cursors never skip rows.
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz', precision: 3 })
  createdAt!: Date;

  @ManyToOne(() => User, (user) => user.statusUpdates, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user!: Relation<User>;

  @ManyToOne(() => Group, (group) => group.statusUpdates, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'group_id' })
  group!: Relation<Group>;
}
