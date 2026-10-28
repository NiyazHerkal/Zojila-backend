import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import type { Relation } from 'typeorm';
import { SavedPlaceSource } from './enums.js';
import { User } from './user.entity.js';

/**
 * A place a user saved (backend handover 2026-10-22, P-07). Private to the user. Either a place
 * from a provider (nearby / search results, by its `providerPlaceId`) or a pin dropped on the
 * map. `place_key` is what makes two saves "the same place": the provider id, or the pin's
 * coordinates rounded to 5 decimals (~1 m).
 */
@Entity('saved_places')
@Index('UQ_saved_places_user_place_key', ['userId', 'placeKey'], { unique: true })
export class SavedPlace {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'user_id' })
  userId!: string;

  @Column({ name: 'place_key', type: 'varchar', length: 200 })
  placeKey!: string;

  @Column({ type: 'enum', enum: SavedPlaceSource })
  source!: SavedPlaceSource;

  @Column({ name: 'provider_place_id', type: 'varchar', length: 200, nullable: true })
  providerPlaceId!: string | null;

  @Column({ type: 'varchar', length: 200 })
  name!: string;

  @Column('double precision')
  lat!: number;

  @Column('double precision')
  lng!: number;

  @Column({ type: 'varchar', length: 500, nullable: true })
  address!: string | null;

  @Column({ type: 'varchar', length: 60, nullable: true })
  category!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz', precision: 3 })
  createdAt!: Date;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user!: Relation<User>;
}
