import { Column, Entity, JoinColumn, ManyToOne, PrimaryColumn, UpdateDateColumn } from 'typeorm';
import type { Relation } from 'typeorm';
import { ActivityStatus } from './enums.js';
import { Group } from './group.entity.js';
import { User } from './user.entity.js';

/**
 * Where the group is with one itinerary stop (change request v1.0, change 3). Keyed by the stop's
 * `stop_key`, which every version of the itinerary shares, so the status survives re-finalizing.
 * No row = UPCOMING. Only admins set it.
 */
@Entity('activity_progress')
export class ActivityProgress {
  @PrimaryColumn({ name: 'group_id' })
  groupId!: string;

  @PrimaryColumn({ name: 'stop_key', type: 'uuid' })
  stopKey!: string;

  @Column({ type: 'enum', enum: ActivityStatus })
  status!: ActivityStatus;

  @Column({ name: 'updated_by', type: 'uuid' })
  updatedById!: string;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz', precision: 3 })
  updatedAt!: Date;

  @ManyToOne(() => Group, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'group_id' })
  group!: Relation<Group>;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'updated_by' })
  updatedBy!: Relation<User>;
}
