import { Column, Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import type { Relation } from 'typeorm';
import { GroupMember } from './group-member.entity.js';

/**
 * A member's read marker in a group chat: everything up to `last_read_at` counts as read.
 * One row per member (not per message), so read receipts stay cheap in big groups.
 *
 * The foreign key is to the membership, so leaving the group removes the marker.
 */
@Entity('message_reads')
export class MessageRead {
  @PrimaryColumn({ name: 'group_id', type: 'uuid' })
  groupId!: string;

  @PrimaryColumn({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @Column({ name: 'last_read_message_id', type: 'uuid' })
  lastReadMessageId!: string;

  // created_at of that message; only ever moves forward.
  @Column({ name: 'last_read_at', type: 'timestamptz', precision: 3 })
  lastReadAt!: Date;

  @ManyToOne(() => GroupMember, { onDelete: 'CASCADE' })
  @JoinColumn([
    { name: 'group_id', referencedColumnName: 'groupId' },
    { name: 'user_id', referencedColumnName: 'userId' },
  ])
  member!: Relation<GroupMember>;
}
