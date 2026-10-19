import { Column, Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import type { Relation } from 'typeorm';
import { Expense } from './expense.entity.js';
import { User } from './user.entity.js';

/**
 * Who actually paid an expense, and how much (change request v1.0, change 6). One row for a
 * single payer, several when people chipped in. Always adds up to the expense amount exactly.
 */
@Entity('expense_payments')
export class ExpensePayment {
  @PrimaryColumn({ name: 'expense_id' })
  expenseId!: string;

  @PrimaryColumn({ name: 'user_id' })
  userId!: string;

  @Column('decimal', { precision: 12, scale: 2 })
  amount!: string;

  @ManyToOne(() => Expense, (expense) => expense.payments, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'expense_id' })
  expense!: Relation<Expense>;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user!: Relation<User>;
}
