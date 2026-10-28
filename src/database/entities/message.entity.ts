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
import { AlertCategory, MessageKind, MessageType } from './enums.js';
import { Group } from './group.entity.js';
import { MessageAck } from './message-ack.entity.js';
import { User } from './user.entity.js';

/**
 * A position in a message: where an SOS was raised (from the device, or the sender's live
 * location share), or a location shared in chat (with an optional place label).
 */
export interface AlertLocation {
  lat: number;
  lng: number;
  accuracy: number | null;
  recordedAt: string;
  source: 'DEVICE' | 'LIVE_SHARE';
  label?: string | null;
}

/**
 * Group chat message or alert (PDF §2.5). Alerts (GENERAL / CRITICAL / SOS) live in the same
 * timeline as chat, so the chat screen shows them in order; CRITICAL and SOS also collect
 * acknowledgements (`message_acks`) and stay "active" until resolved.
 *
 * Read receipts are not stored per message: each member has a last-read marker
 * (`message_reads`), and "read by N" is derived from it.
 */
@Entity('messages')
@Index(['groupId', 'createdAt'])
// Resending the same client_msg_id returns the original message instead of a duplicate.
@Index('UQ_messages_sender_client_msg', ['senderId', 'clientMsgId'], { unique: true, where: '"client_msg_id" IS NOT NULL' })
export class Message {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'group_id' })
  groupId!: string;

  @Column({ name: 'sender_id' })
  senderId!: string;

  @Column('text')
  body!: string;

  @Column({ type: 'enum', enum: MessageType, default: MessageType.NORMAL })
  type!: MessageType;

  // TEXT (incl. emoji and every alert), LOCATION (`location` set) or VOICE (`voice_*` set).
  @Column({ type: 'enum', enum: MessageKind, default: MessageKind.TEXT })
  kind!: MessageKind;

  // CRITICAL alerts only.
  @Column({ type: 'enum', enum: AlertCategory, nullable: true })
  category!: AlertCategory | null;

  // The app's own id for the message, echoed back so it can match its "sending…" bubble.
  @Column({ name: 'client_msg_id', type: 'varchar', length: 64, nullable: true })
  clientMsgId!: string | null;

  // SOS and LOCATION messages.
  @Column({ type: 'jsonb', nullable: true })
  location!: AlertLocation | null;

  // VOICE messages: the audio file in StorageService, its type and length (as the app measured it).
  @Column({ name: 'voice_key', type: 'varchar', nullable: true })
  voiceKey!: string | null;

  @Column({ name: 'voice_content_type', type: 'varchar', length: 40, nullable: true })
  voiceContentType!: string | null;

  @Column({ name: 'voice_duration_ms', type: 'int', nullable: true })
  voiceDurationMs!: number | null;

  // CRITICAL / SOS: set when the alert is over (banner goes away).
  @Column({ name: 'resolved_at', type: 'timestamptz', precision: 3, nullable: true })
  resolvedAt!: Date | null;

  @Column({ name: 'resolved_by', type: 'uuid', nullable: true })
  resolvedById!: string | null;

  // The message this one answers (same group). Kept if that message is deleted: it shows as deleted.
  @Column({ name: 'reply_to_id', type: 'uuid', nullable: true })
  replyToId!: string | null;

  // A copy of another message the sender forwarded (where it came from isn't kept).
  @Column({ default: false })
  forwarded!: boolean;

  // Deleted by its sender: body, location and voice are wiped and it shows as "deleted".
  @Column({ name: 'deleted_at', type: 'timestamptz', precision: 3, nullable: true })
  deletedAt!: Date | null;

  // timestamptz(3) = millisecond precision, matching JS Dates, so cursors and read markers compare exactly.
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz', precision: 3 })
  createdAt!: Date;

  @ManyToOne(() => Group, (group) => group.messages, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'group_id' })
  group!: Relation<Group>;

  @ManyToOne(() => User, (user) => user.messages)
  @JoinColumn({ name: 'sender_id' })
  sender!: Relation<User>;

  @ManyToOne(() => User, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'resolved_by' })
  resolvedBy!: Relation<User> | null;

  @ManyToOne(() => Message, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'reply_to_id' })
  replyTo!: Relation<Message> | null;

  @OneToMany(() => MessageAck, (ack) => ack.message)
  acks!: Relation<MessageAck>[];
}
