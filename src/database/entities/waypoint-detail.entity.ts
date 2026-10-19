import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import type { Relation } from 'typeorm';
import { WaypointDetailType } from './enums.js';
import { Waypoint } from './waypoint.entity.js';

@Entity('waypoint_details')
export class WaypointDetail {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'waypoint_id' })
  waypointId!: string;

  @Column({ type: 'enum', enum: WaypointDetailType })
  type!: WaypointDetailType;

  @Column({ type: 'jsonb' })
  payload!: Record<string, unknown>;

  @ManyToOne(() => Waypoint, (waypoint) => waypoint.details, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'waypoint_id' })
  waypoint!: Relation<Waypoint>;
}
