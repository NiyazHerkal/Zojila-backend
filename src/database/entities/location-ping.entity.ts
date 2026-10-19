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

// UNUSED for now: Phase 7 is live-location only (latest position in Redis, no trail/history),
// decided 2026-09-29. Kept for a future "route trail" feature, which would also need a
// retention job (context/01_Architecture.md §4 Data Privacy).
@Entity('location_pings')
@Index(['groupId', 'recordedAt'])
export class LocationPing {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'user_id' })
  userId!: string;

  @Column({ name: 'group_id' })
  groupId!: string;

  @Column('double precision')
  lat!: number;

  @Column('double precision')
  lng!: number;

  @CreateDateColumn({ name: 'recorded_at', type: 'timestamptz' })
  recordedAt!: Date;

  @ManyToOne(() => User, (user) => user.locationPings, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user!: Relation<User>;

  @ManyToOne(() => Group, (group) => group.locationPings, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'group_id' })
  group!: Relation<Group>;
}
