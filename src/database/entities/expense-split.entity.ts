import { Column, Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import type { Relation } from 'typeorm';
import { Expense } from './expense.entity.js';
import { User } from './user.entity.js';

@Entity('expense_splits')
export class ExpenseSplit {
  @PrimaryColumn({ name: 'expense_id' })
  expenseId!: string;

  @PrimaryColumn({ name: 'user_id' })
  userId!: string;

  @Column({ name: 'share_amount', type: 'decimal', precision: 10, scale: 2 })
  shareAmount!: string;

  @ManyToOne(() => Expense, (expense) => expense.splits, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'expense_id' })
  expense!: Relation<Expense>;

  @ManyToOne(() => User, (user) => user.expenseSplits, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user!: Relation<User>;
}
