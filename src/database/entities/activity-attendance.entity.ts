import { CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import type { Relation } from 'typeorm';
import { Group } from './group.entity.js';
import { User } from './user.entity.js';

/**
 * A member has arrived at an itinerary stop (backend handover 2026-10-22, P-03). Keyed by the
 * stop's `stop_key` like activity_progress, so it survives re-finalizing. Row = arrived; undoing
 * deletes it. Members only ever write their own row.
 */
@Entity('activity_attendance')
export class ActivityAttendance {
  @PrimaryColumn({ name: 'group_id' })
  groupId!: string;

  @PrimaryColumn({ name: 'stop_key', type: 'uuid' })
  stopKey!: string;

  @PrimaryColumn({ name: 'user_id' })
  userId!: string;

  @CreateDateColumn({ name: 'arrived_at', type: 'timestamptz', precision: 3 })
  arrivedAt!: Date;

  @ManyToOne(() => Group, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'group_id' })
  group!: Relation<Group>;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user!: Relation<User>;
}
