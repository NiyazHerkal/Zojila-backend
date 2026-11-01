import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
} from 'typeorm';
import type { Relation } from 'typeorm';
import { GroupRole } from './enums.js';
import { Group } from './group.entity.js';
import { User } from './user.entity.js';

@Entity('group_members')
export class GroupMember {
  @PrimaryColumn({ name: 'group_id' })
  groupId!: string;

  @PrimaryColumn({ name: 'user_id' })
  userId!: string;

  @Column({ type: 'enum', enum: GroupRole, default: GroupRole.VIEWER })
  role!: GroupRole;

  @CreateDateColumn({ name: 'joined_at', type: 'timestamptz' })
  joinedAt!: Date;

  /** Opt-in, per group: save this member's shared positions as a trail (location history). */
  @Column({ name: 'location_history_enabled', default: false })
  locationHistoryEnabled!: boolean;

  /** When they last turned history on; positions taken before this are never saved. */
  @Column({ name: 'location_history_enabled_at', type: 'timestamptz', precision: 3, nullable: true })
  locationHistoryEnabledAt!: Date | null;

  @ManyToOne(() => Group, (group) => group.members, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'group_id' })
  group!: Relation<Group>;

  @ManyToOne(() => User, (user) => user.memberships, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user!: Relation<User>;
}
