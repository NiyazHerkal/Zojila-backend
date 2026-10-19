import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn, Unique } from 'typeorm';
import type { Relation } from 'typeorm';
import { ShareDuration } from './enums.js';
import { GroupMember } from './group-member.entity.js';

/**
 * A member's live-location sharing session with one group (PDF §2.4). The row exists only
 * while sharing is on (one per member per group) and is deleted on stop or expiry.
 *
 * The foreign key is to the *membership* (group_id + user_id), so removing someone from a group,
 * or deleting the group, ends their sharing automatically. Live positions themselves live in
 * Redis, not here (live-only, no history; see LocationService).
 */
@Entity('location_shares')
@Unique('UQ_location_shares_group_user', ['groupId', 'userId'])
export class LocationShare {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'user_id' })
  userId!: string;

  @Column({ name: 'group_id' })
  groupId!: string;

  @Column({ type: 'enum', enum: ShareDuration })
  duration!: ShareDuration;

  @CreateDateColumn({ name: 'started_at', type: 'timestamptz', precision: 3 })
  startedAt!: Date;

  // Null for ALWAYS (until the member turns it off).
  @Column({ name: 'expires_at', type: 'timestamptz', precision: 3, nullable: true })
  expiresAt!: Date | null;

  @ManyToOne(() => GroupMember, { onDelete: 'CASCADE' })
  @JoinColumn([
    { name: 'group_id', referencedColumnName: 'groupId' },
    { name: 'user_id', referencedColumnName: 'userId' },
  ])
  member!: Relation<GroupMember>;
}
