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

  @ManyToOne(() => Group, (group) => group.members, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'group_id' })
  group!: Relation<Group>;

  @ManyToOne(() => User, (user) => user.memberships, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user!: Relation<User>;
}
