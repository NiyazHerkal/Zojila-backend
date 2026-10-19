import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module.js';
import { Expense, ExpensePayment, ExpenseSettlement, ExpenseSplit, Group, GroupMember, User } from '../database/entities/index.js';
import { GroupsModule } from '../groups/groups.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { RealtimeModule } from '../realtime/realtime.module.js';
import { ExpenseReportService } from './expense-report.service.js';
import { ExpensesController } from './expenses.controller.js';
import { ExpensesService } from './expenses.service.js';

/** Expenses, splits, settle-up and reports (PDF §2.7). Receipts go through the global StorageModule. */
@Module({
  imports: [
    AuthModule,
    GroupsModule,
    RealtimeModule,
    NotificationsModule,
    TypeOrmModule.forFeature([Expense, ExpenseSplit, ExpensePayment, ExpenseSettlement, Group, GroupMember, User]),
  ],
  controllers: [ExpensesController],
  providers: [ExpensesService, ExpenseReportService],
  exports: [ExpensesService], // the offline trip bundle (Phase 11) includes expenses
})
export class ExpensesModule {}
