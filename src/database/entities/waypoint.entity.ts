import {
  Column,
  Entity,
  Generated,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import type { Relation, ValueTransformer } from 'typeorm';
import { Itinerary } from './itinerary.entity.js';
import { WaypointDetail } from './waypoint-detail.entity.js';

/** Postgres returns `time` as HH:mm:ss; the API uses HH:mm. */
const hhmm: ValueTransformer = {
  to: (value: string | null | undefined) => value,
  from: (value: string | null) => (value ? value.slice(0, 5) : null),
};

@Entity('waypoints')
@Index(['itineraryId', 'order'])
@Index('UQ_waypoints_itinerary_stop_key', ['itineraryId', 'stopKey'], { unique: true })
export class Waypoint {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  // The stop's identity across versions: copied when a draft is made from a finalized version,
  // so activity status and updates (keyed by it) stay attached. Shown in the API as `activityId`.
  @Column({ name: 'stop_key', type: 'uuid' })
  @Generated('uuid')
  stopKey!: string;

  @Column({ name: 'itinerary_id' })
  itineraryId!: string;

  // 0-based position in the route. First = start point, last = end point, the rest are mid-waypoints.
  @Column()
  order!: number;

  @Column()
  name!: string;

  @Column('double precision')
  lat!: number;

  @Column('double precision')
  lng!: number;

  // Calendar date of this stop (YYYY-MM-DD). No time or timezone, so it reads the same everywhere.
  @Column({ type: 'date', nullable: true })
  date!: string | null;

  // Optional start/end time of the stop (HH:mm), wall-clock time at the stop like `date`.
  @Column({ name: 'start_time', type: 'time', nullable: true, transformer: hhmm })
  startTime!: string | null;

  @Column({ name: 'end_time', type: 'time', nullable: true, transformer: hhmm })
  endTime!: string | null;

  @Column({ type: 'varchar', nullable: true })
  notes!: string | null;

  // Meters above sea level, filled from the elevation provider. Null until fetched.
  @Column({ type: 'double precision', nullable: true })
  elevation!: number | null;

  // Last weather lookup for this stop's date: { status, forecast?, fetchedAt } (see WeatherResult).
  @Column({ name: 'weather_json', type: 'jsonb', nullable: true })
  weatherJson!: Record<string, unknown> | null;

  // Reserved: reviews (TripAdvisor/Google) are an open question — not populated yet.
  @Column({ name: 'reviews_json', type: 'jsonb', nullable: true })
  reviewsJson!: Record<string, unknown> | null;

  @ManyToOne(() => Itinerary, (itinerary) => itinerary.waypoints, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'itinerary_id' })
  itinerary!: Relation<Itinerary>;

  @OneToMany(() => WaypointDetail, (detail) => detail.waypoint)
  details!: Relation<WaypointDetail>[];
}
