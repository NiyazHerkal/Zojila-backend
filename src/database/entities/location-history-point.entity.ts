import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import type { Relation } from 'typeorm';
import { GroupMember } from './group-member.entity.js';

/**
 * One saved position of a member's trail in one group (location history, opt-in per group,
 * 2026-10-28). Written only while the member is sharing live location with the group AND has
 * turned history on (`group_members.location_history_enabled`). Deleted when they turn history
 * off, leave or are removed (FK to the membership), when the group is deleted, and by the
 * retention job after LOCATION_HISTORY_RETENTION_DAYS (default 30).
 */
@Entity('location_history')
@Index('IDX_location_history_member_time', ['groupId', 'userId', 'recordedAt'])
@Index('IDX_location_history_recorded_at', ['recordedAt'])
export class LocationHistoryPoint {
  // bigint: a 10 s update rate makes many rows; TypeORM returns it as a string.
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id!: string;

  @Column({ name: 'group_id' })
  groupId!: string;

  @Column({ name: 'user_id' })
  userId!: string;

  @Column('double precision')
  lat!: number;

  @Column('double precision')
  lng!: number;

  @Column({ type: 'real', nullable: true })
  accuracy!: number | null;

  @Column({ type: 'real', nullable: true })
  heading!: number | null;

  @Column({ type: 'real', nullable: true })
  speed!: number | null;

  /** When the device took the fix (clamped to the server's "now"). */
  @Column({ name: 'recorded_at', type: 'timestamptz', precision: 3 })
  recordedAt!: Date;

  @ManyToOne(() => GroupMember, { onDelete: 'CASCADE' })
  @JoinColumn([
    { name: 'group_id', referencedColumnName: 'groupId' },
    { name: 'user_id', referencedColumnName: 'userId' },
  ])
  member!: Relation<GroupMember>;
}
