import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import type { Relation } from 'typeorm';
import { Group } from './group.entity.js';
import { User } from './user.entity.js';

/**
 * A repayment between two members ("Bob paid Alice back 500"). It moves both balances, so the
 * "who owes whom" summary can reach zero. Not an expense: it doesn't count in totals or categories.
 */
@Entity('expense_settlements')
@Index(['groupId', 'paidOn'])
export class ExpenseSettlement {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'group_id' })
  groupId!: string;

  @Column({ name: 'from_user_id' })
  fromUserId!: string;

  @Column({ name: 'to_user_id' })
  toUserId!: string;

  @Column('decimal', { precision: 12, scale: 2 })
  amount!: string;

  @Column({ name: 'paid_on', type: 'date' })
  paidOn!: string;

  @Column({ type: 'varchar', length: 280, nullable: true })
  note!: string | null;

  @Column({ name: 'created_by' })
  createdById!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz', precision: 3 })
  createdAt!: Date;

  @ManyToOne(() => Group, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'group_id' })
  group!: Relation<Group>;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'from_user_id' })
  fromUser!: Relation<User>;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'to_user_id' })
  toUser!: Relation<User>;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'created_by' })
  createdBy!: Relation<User>;
}
