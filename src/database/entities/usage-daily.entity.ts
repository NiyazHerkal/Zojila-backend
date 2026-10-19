import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import type { Relation } from 'typeorm';
import { Group } from './group.entity.js';
import { User } from './user.entity.js';

/**
 * Daily usage counters for the beta KPIs (PDF §9): "user X did action Y in trip Z on day D,
 * N times". Only for actions with no other record (connections, location sharing started,
 * exports); chat, expenses and statuses are counted from their own tables. No content, no
 * locations. Deleted with the user's account or the trip, and after USAGE_RETENTION_DAYS.
 */
@Entity('usage_daily')
@Index('UQ_usage_daily_group', ['day', 'metric', 'userId', 'groupId'], { unique: true, where: '"group_id" IS NOT NULL' })
@Index('UQ_usage_daily_no_group', ['day', 'metric', 'userId'], { unique: true, where: '"group_id" IS NULL' })
export class UsageDaily {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id!: string;

  @Column({ type: 'date' })
  day!: string;

  @Column({ type: 'varchar', length: 40 })
  metric!: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @Column({ name: 'group_id', type: 'uuid', nullable: true })
  groupId!: string | null;

  @Column({ type: 'int', default: 1 })
  count!: number;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user!: Relation<User>;

  @ManyToOne(() => Group, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'group_id' })
  group!: Relation<Group> | null;
}
