import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { Relation } from 'typeorm';
import { Group } from './group.entity.js';
import { User } from './user.entity.js';
import { ExpenseSplit } from './expense-split.entity.js';
import { ExpensePayment } from './expense-payment.entity.js';
import { ExpenseCategory, SplitType } from './enums.js';

/**
 * A shared expense (PDF §2.7). `amount` is in the group's currency. Splits always add up to
 * the amount exactly (computed in paise). Members who later leave keep their splits, so
 * balances stay correct.
 */
@Entity('expenses')
@Index(['groupId', 'spentOn'])
// Re-sending the same client_id (e.g. an offline queue retrying) returns the original expense.
@Index('UQ_expenses_creator_client_id', ['createdById', 'clientId'], { unique: true, where: '"client_id" IS NOT NULL' })
export class Expense {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'group_id' })
  groupId!: string;

  // The main payer: whoever paid the most (see expense_payments for everyone who paid).
  // Can differ from who recorded it (created_by).
  @Column({ name: 'payer_id' })
  payerId!: string;

  @Column({ name: 'created_by' })
  createdById!: string;

  @Column('decimal', { precision: 12, scale: 2 })
  amount!: string;

  @Column({ type: 'enum', enum: ExpenseCategory })
  category!: ExpenseCategory;

  // The day the money was spent (YYYY-MM-DD), not when it was recorded.
  @Column({ name: 'spent_on', type: 'date' })
  spentOn!: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  description!: string | null;

  @Column({ name: 'split_type', type: 'enum', enum: SplitType })
  splitType!: SplitType;

  // Storage key of the receipt image/PDF (see StorageService); null = no receipt.
  // The app's own id for the expense, so a retried create doesn't make a duplicate.
  @Column({ name: 'client_id', type: 'varchar', length: 64, nullable: true })
  clientId!: string | null;

  @Column({ name: 'receipt_key', type: 'varchar', nullable: true })
  receiptKey!: string | null;

  @Column({ name: 'receipt_content_type', type: 'varchar', nullable: true })
  receiptContentType!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz', precision: 3 })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz', precision: 3 })
  updatedAt!: Date;

  @ManyToOne(() => Group, (group) => group.expenses, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'group_id' })
  group!: Relation<Group>;

  @ManyToOne(() => User, (user) => user.expensesPaid)
  @JoinColumn({ name: 'payer_id' })
  payer!: Relation<User>;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'created_by' })
  createdBy!: Relation<User>;

  @OneToMany(() => ExpenseSplit, (split) => split.expense)
  splits!: Relation<ExpenseSplit>[];

  @OneToMany(() => ExpensePayment, (payment) => payment.expense)
  payments!: Relation<ExpensePayment>[];
}
