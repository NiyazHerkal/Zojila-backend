import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiProduces, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import type { GroupMember } from '../database/entities/index.js';
import { CurrentMembership } from '../groups/decorators/current-membership.decorator.js';
import { GroupMemberGuard } from '../groups/guards/group-member.guard.js';
import { perMinute, RATE_LIMITS } from '../security/rate-limit.js';
import {
  CreateExpenseDto,
  CreateSettlementDto,
  ListExpensesQueryDto,
  ReportQueryDto,
  UpdateExpenseDto,
} from './dto/expense.dto.js';
import { ExpenseReportService } from './expense-report.service.js';
import { ExpensesService, type UploadedReceipt } from './expenses.service.js';
import { RECEIPT_MAX_BYTES } from './receipt-file.js';

const uuid = new ParseUUIDPipe({ version: '4' });

/**
 * Expenses (PDF §2.7). Every member can add expenses and see everything. Editing/deleting an
 * expense: whoever recorded it, or an admin. Static routes (summary, settlements, report) are
 * declared before `:expenseId`.
 */
@ApiTags('expenses')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, GroupMemberGuard)
@Controller('groups/:groupId/expenses')
export class ExpensesController {
  constructor(
    private readonly expenses: ExpensesService,
    private readonly reports: ExpenseReportService,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Record an expense, split EQUAL (between all / chosen members) or CUSTOM (exact amounts).' })
  create(@Param('groupId') groupId: string, @CurrentMembership() me: GroupMember, @Body() dto: CreateExpenseDto) {
    return this.expenses.create(groupId, me, dto);
  }

  @Get()
  @ApiOperation({ summary: 'Expenses, newest day first. Filters: category, paidBy, involving, from/to. Paged with `before`.' })
  list(@Param('groupId') groupId: string, @CurrentMembership() me: GroupMember, @Query() query: ListExpensesQueryDto) {
    return this.expenses.list(groupId, me, query);
  }

  @Get('summary')
  @ApiOperation({ summary: 'Total, category breakdown, everyone’s balance and “who owes whom”.' })
  summary(@Param('groupId') groupId: string, @CurrentMembership() me: GroupMember) {
    return this.expenses.summary(groupId, me);
  }

  @Get('report')
  @ApiProduces('application/pdf', 'text/csv')
  @ApiOperation({ summary: 'Download the expense report: `format=pdf` (default) or `csv`.' })
  async report(@Param('groupId') groupId: string, @CurrentMembership() me: GroupMember, @Query() query: ReportQueryDto) {
    const { file, filename, contentType } = await this.reports.export(groupId, me, query.format ?? 'pdf');
    return new StreamableFile(file, { type: contentType, disposition: `attachment; filename="${filename}"`, length: file.length });
  }

  @Post('settlements')
  @ApiOperation({ summary: 'Record a repayment between two members (you paid or received it; admins can record any).' })
  createSettlement(@Param('groupId') groupId: string, @CurrentMembership() me: GroupMember, @Body() dto: CreateSettlementDto) {
    return this.expenses.createSettlement(groupId, me, dto);
  }

  @Get('settlements')
  @ApiOperation({ summary: 'Recorded repayments, newest first.' })
  listSettlements(@Param('groupId') groupId: string, @CurrentMembership() me: GroupMember) {
    return this.expenses.listSettlements(groupId, me);
  }

  @Delete('settlements/:settlementId')
  @ApiOperation({ summary: 'Delete a repayment recorded by mistake (whoever recorded it, or an admin).' })
  async deleteSettlement(
    @Param('groupId') groupId: string,
    @Param('settlementId', uuid) settlementId: string,
    @CurrentMembership() me: GroupMember,
  ) {
    await this.expenses.deleteSettlement(groupId, me, settlementId);
  }

  @Get(':expenseId')
  @ApiOperation({ summary: 'One expense with its splits.' })
  get(@Param('groupId') groupId: string, @Param('expenseId', uuid) expenseId: string, @CurrentMembership() me: GroupMember) {
    return this.expenses.get(groupId, me, expenseId);
  }

  @Patch(':expenseId')
  @ApiOperation({ summary: 'Edit an expense (whoever recorded it, or an admin). Send only what changes.' })
  update(
    @Param('groupId') groupId: string,
    @Param('expenseId', uuid) expenseId: string,
    @CurrentMembership() me: GroupMember,
    @Body() dto: UpdateExpenseDto,
  ) {
    return this.expenses.update(groupId, me, expenseId, dto);
  }

  @Delete(':expenseId')
  @ApiOperation({ summary: 'Delete an expense and its receipt (whoever recorded it, or an admin).' })
  async remove(@Param('groupId') groupId: string, @Param('expenseId', uuid) expenseId: string, @CurrentMembership() me: GroupMember) {
    await this.expenses.remove(groupId, me, expenseId);
  }

  @Put(':expenseId/receipt')
  @Throttle(perMinute(RATE_LIMITS.upload))
  @HttpCode(200)
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } }, required: ['file'] } })
  @ApiOperation({ summary: 'Attach or replace the receipt: JPEG/PNG/WebP/HEIC photo or PDF, max 5 MB, field `file`.' })
  // Allow a little over the limit here so the service can answer with a clear 413 message.
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: RECEIPT_MAX_BYTES + 1, files: 1 } }))
  putReceipt(
    @Param('groupId') groupId: string,
    @Param('expenseId', uuid) expenseId: string,
    @CurrentMembership() me: GroupMember,
    @UploadedFile() file: UploadedReceipt | undefined,
  ) {
    return this.expenses.putReceipt(groupId, me, expenseId, file);
  }

  @Get(':expenseId/receipt')
  @ApiProduces('image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf')
  @ApiOperation({ summary: 'Download the receipt (members).' })
  async getReceipt(@Param('groupId') groupId: string, @Param('expenseId', uuid) expenseId: string) {
    const { data, contentType, filename } = await this.expenses.getReceipt(groupId, expenseId);
    return new StreamableFile(data, { type: contentType, disposition: `inline; filename="${filename}"`, length: data.length });
  }

  @Delete(':expenseId/receipt')
  @ApiOperation({ summary: 'Remove the receipt (whoever recorded the expense, or an admin).' })
  deleteReceipt(@Param('groupId') groupId: string, @Param('expenseId', uuid) expenseId: string, @CurrentMembership() me: GroupMember) {
    return this.expenses.deleteReceipt(groupId, me, expenseId);
  }
}
