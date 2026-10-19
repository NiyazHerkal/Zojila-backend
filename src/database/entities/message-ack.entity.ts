import { CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import type { Relation } from 'typeorm';
import { Message } from './message.entity.js';
import { User } from './user.entity.js';

/** A member confirming they've seen a CRITICAL or SOS alert (PDF §2.5 "members acknowledge receipt"). */
@Entity('message_acks')
export class MessageAck {
  @PrimaryColumn({ name: 'message_id', type: 'uuid' })
  messageId!: string;

  @PrimaryColumn({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @CreateDateColumn({ name: 'acked_at', type: 'timestamptz', precision: 3 })
  ackedAt!: Date;

  @ManyToOne(() => Message, (message) => message.acks, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'message_id' })
  message!: Relation<Message>;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user!: Relation<User>;
}
