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
import { Group } from './group.entity.js';
import { User } from './user.entity.js';

/**
 * A text update a member posts about one itinerary stop (change request v1.0, change 4), e.g.
 * "Parking is full, use the lot behind the temple". Shared with the group. Deleting only sets
 * `deleted_at`, so the timeline can show "update deleted" consistently on every phone.
 */
@Entity('activity_updates')
@Index(['groupId', 'stopKey', 'createdAt'])
// Re-sending the same client_id (an offline queue retrying) returns the original update.
@Index('UQ_activity_updates_user_client_id', ['userId', 'clientId'], { unique: true, where: '"client_id" IS NOT NULL' })
export class ActivityUpdate {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'group_id' })
  groupId!: string;

  @Column({ name: 'stop_key', type: 'uuid' })
  stopKey!: string;

  @Column({ name: 'user_id' })
  userId!: string;

  @Column({ type: 'varchar', length: 1000 })
  text!: string;

  @Column({ name: 'client_id', type: 'varchar', length: 64, nullable: true })
  clientId!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz', precision: 3 })
  createdAt!: Date;

  // Set only when the text is edited (null = never edited).
  @Column({ name: 'edited_at', type: 'timestamptz', precision: 3, nullable: true })
  editedAt!: Date | null;

  @Column({ name: 'deleted_at', type: 'timestamptz', precision: 3, nullable: true })
  deletedAt!: Date | null;

  @Column({ name: 'deleted_by', type: 'uuid', nullable: true })
  deletedById!: string | null;

  @ManyToOne(() => Group, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'group_id' })
  group!: Relation<Group>;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user!: Relation<User>;
}
