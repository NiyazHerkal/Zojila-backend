import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import type { Relation } from 'typeorm';
import { User } from './user.entity.js';
import { GroupMember } from './group-member.entity.js';
import { Invite } from './invite.entity.js';
import { Itinerary } from './itinerary.entity.js';
import { LocationPing } from './location-ping.entity.js';
import { Message } from './message.entity.js';
import { StatusUpdate } from './status-update.entity.js';
import { Expense } from './expense.entity.js';

@Entity('groups')
export class Group {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  name!: string;

  @Column()
  description!: string;

  @Column({ name: 'trip_start', type: 'timestamptz' })
  tripStart!: Date;

  @Column({ name: 'trip_end', type: 'timestamptz' })
  tripEnd!: Date;

  // ISO 4217 code for every expense in the group (single currency, PDF §2.7).
  @Column({ type: 'char', length: 3, default: 'INR' })
  currency!: string;

  // A closed trip is read-only, and is deleted for good at delete_after (PDF §4 "group data
  // deletion on group closure"). An admin can reopen it until then.
  @Column({ name: 'closed_at', type: 'timestamptz', nullable: true })
  closedAt!: Date | null;

  @Column({ name: 'delete_after', type: 'timestamptz', nullable: true })
  deleteAfter!: Date | null;

  // Optional trip cover photo in StorageService, e.g. `groups/<id>/cover/<uuid>.jpg`.
  @Column({ name: 'cover_image_key', type: 'varchar', nullable: true })
  coverImageKey!: string | null;

  @Column({ name: 'cover_image_content_type', type: 'varchar', length: 40, nullable: true })
  coverImageContentType!: string | null;

  // Creator only — admin rights come from GroupMember.role, and a group can have several admins.
  @Column({ name: 'created_by' })
  createdById!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @ManyToOne(() => User, (user) => user.createdGroups)
  @JoinColumn({ name: 'created_by' })
  creator!: Relation<User>;

  @OneToMany(() => GroupMember, (member) => member.group)
  members!: Relation<GroupMember>[];

  @OneToMany(() => Invite, (invite) => invite.group)
  invites!: Relation<Invite>[];

  @OneToMany(() => Itinerary, (itinerary) => itinerary.group)
  itineraries!: Relation<Itinerary>[];

  @OneToMany(() => LocationPing, (ping) => ping.group)
  locationPings!: Relation<LocationPing>[];

  @OneToMany(() => Message, (message) => message.group)
  messages!: Relation<Message>[];

  @OneToMany(() => StatusUpdate, (status) => status.group)
  statusUpdates!: Relation<StatusUpdate>[];

  @OneToMany(() => Expense, (expense) => expense.group)
  expenses!: Relation<Expense>[];
}
