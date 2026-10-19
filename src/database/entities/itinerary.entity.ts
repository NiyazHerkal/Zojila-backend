import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import type { Relation } from 'typeorm';
import { ItineraryStatus } from './enums.js';
import { Group } from './group.entity.js';
import { User } from './user.entity.js';
import { Waypoint } from './waypoint.entity.js';

/**
 * Each group has at most one DRAFT (the admin's working copy) and any number of LOCKED
 * versions (1, 2, 3…), which are immutable apart from weather/elevation refreshes. Finalizing
 * turns the draft into the next version. Editing after that starts a new draft copied from
 * the latest version. Viewers only ever see LOCKED versions (PDF §2.3.2).
 */
@Entity('itineraries')
@Index('UQ_itineraries_one_draft_per_group', ['groupId'], { unique: true, where: `"status" = 'DRAFT'` })
@Index('UQ_itineraries_group_version', ['groupId', 'version'], { unique: true, where: '"version" IS NOT NULL' })
export class Itinerary {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'group_id' })
  groupId!: string;

  @Column({ type: 'enum', enum: ItineraryStatus, default: ItineraryStatus.DRAFT })
  status!: ItineraryStatus;

  @Column({ name: 'created_by' })
  createdBy!: string;

  // Assigned when the draft is finalized; null while DRAFT.
  @Column({ type: 'int', nullable: true })
  version!: number | null;

  // For a draft: the locked version it was copied from (null = started from scratch).
  @Column({ name: 'based_on_version', type: 'int', nullable: true })
  basedOnVersion!: number | null;

  // Bumped on every draft edit. Admins send it back as `If-Match` so an edit made from a stale
  // copy (e.g. queued offline) is rejected instead of silently overwriting another admin's work.
  @Column({ type: 'int', default: 0 })
  revision!: number;

  @Column({ name: 'locked_at', type: 'timestamptz', nullable: true })
  lockedAt!: Date | null;

  // Road route through the pins in order (see RouteService), computed on first request and kept
  // with a hash of the coordinates it was built from, so a moved pin recomputes it.
  @Column({ name: 'route_json', type: 'jsonb', nullable: true })
  routeJson!: object | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @ManyToOne(() => Group, (group) => group.itineraries, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'group_id' })
  group!: Relation<Group>;

  @ManyToOne(() => User, (user) => user.createdItineraries)
  @JoinColumn({ name: 'created_by' })
  creator!: Relation<User>;

  @OneToMany(() => Waypoint, (waypoint) => waypoint.itinerary)
  waypoints!: Relation<Waypoint>[];
}
