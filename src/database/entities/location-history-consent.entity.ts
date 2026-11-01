import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import type { Relation } from 'typeorm';
import { Group } from './group.entity.js';
import { User } from './user.entity.js';

export enum LocationHistoryConsentAction {
  GRANTED = 'GRANTED',
  WITHDRAWN = 'WITHDRAWN',
}

/**
 * Append-only record of each time a member turned location history on or off in a group, with
 * the version of the notice they were shown (proof of consent, DPDP Act 2023 s.6(10)). Kept
 * after they leave the group; deleted with the group or the account.
 */
@Entity('location_history_consents')
@Index('IDX_location_history_consents_user_group', ['userId', 'groupId', 'createdAt'])
export class LocationHistoryConsent {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'user_id' })
  userId!: string;

  @Column({ name: 'group_id' })
  groupId!: string;

  @Column({ type: 'enum', enum: LocationHistoryConsentAction })
  action!: LocationHistoryConsentAction;

  /** The notice the member agreed to (GRANTED); null on WITHDRAWN. */
  @Column({ name: 'notice_version', type: 'varchar', length: 20, nullable: true })
  noticeVersion!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz', precision: 3 })
  createdAt!: Date;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user!: Relation<User>;

  @ManyToOne(() => Group, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'group_id' })
  group!: Relation<Group>;
}
