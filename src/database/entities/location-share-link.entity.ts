import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import type { Relation } from 'typeorm';
import { LiveShareDuration, LiveShareEndReason } from './enums.js';
import { User } from './user.entity.js';

/**
 * Live location shared with someone outside TravelGo through a secret link (change request v1.0,
 * change 10, "like WhatsApp live location"). One row per link, i.e. per recipient. Only a
 * SHA-256 hash of the link's token is stored. Positions aren't stored here: the sharer's latest
 * position sits in Redis while a link is active (no history).
 * Active = `ended_at` is null and `expires_at` is in the future.
 */
@Entity('location_share_links')
@Index(['userId', 'expiresAt'])
export class LocationShareLink {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'user_id' })
  userId!: string;

  // Who it's for, as the sharer typed it ("Mom"). Shown to the sharer and the recipient.
  @Column({ name: 'recipient_label', type: 'varchar', length: 60, nullable: true })
  recipientLabel!: string | null;

  @Column({ name: 'token_hash', type: 'varchar', length: 64, unique: true })
  tokenHash!: string;

  @Column({ type: 'enum', enum: LiveShareDuration })
  duration!: LiveShareDuration;

  @CreateDateColumn({ name: 'started_at', type: 'timestamptz', precision: 3 })
  startedAt!: Date;

  @Column({ name: 'expires_at', type: 'timestamptz', precision: 3 })
  expiresAt!: Date;

  // Set when the sharer stops it, or by the sweep once it has expired (and everyone was told).
  @Column({ name: 'ended_at', type: 'timestamptz', precision: 3, nullable: true })
  endedAt!: Date | null;

  @Column({ name: 'end_reason', type: 'enum', enum: LiveShareEndReason, nullable: true })
  endReason!: LiveShareEndReason | null;

  @Column({ name: 'first_viewed_at', type: 'timestamptz', precision: 3, nullable: true })
  firstViewedAt!: Date | null;

  @Column({ name: 'last_viewed_at', type: 'timestamptz', precision: 3, nullable: true })
  lastViewedAt!: Date | null;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user!: Relation<User>;
}
