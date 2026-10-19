import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Query, StreamableFile, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { FeedbackQueryDto, UpdateFeedbackDto } from '../feedback/dto/feedback.dto.js';
import { FeedbackService } from '../feedback/feedback.service.js';
import { OpsKeyGuard } from './ops-key.guard.js';
import { OpsService } from './ops.service.js';

const uuid = new ParseUUIDPipe({ version: '4' });

/** Team-only: beta metrics and feedback triage. Header `X-Ops-Key: <OPS_API_KEY>`. */
@ApiTags('ops')
@ApiSecurity('ops-key')
@UseGuards(OpsKeyGuard)
@Controller('ops')
export class OpsController {
  constructor(
    private readonly ops: OpsService,
    private readonly feedback: FeedbackService,
  ) {}

  @Get('stats')
  @ApiQuery({ name: 'since', required: false, description: 'YYYY-MM-DD, default 30 days ago' })
  @ApiOperation({ summary: 'Beta KPIs (PDF §9): users, retention, groups, invites, chat, location, expenses, exports, safety.' })
  stats(@Query('since') since?: string) {
    return this.ops.stats(since && /^\d{4}-\d{2}-\d{2}$/.test(since) ? since : undefined);
  }

  @Get('trips')
  @ApiOperation({ summary: 'Per-trip feature checklist (Phase 13 DoD: a real trip used end-to-end).' })
  trips() {
    return this.ops.trips();
  }

  @Get('feedback')
  @ApiOperation({ summary: 'Feedback reports, newest first. Filters: status, category. Paged with `before`.' })
  listFeedback(@Query() query: FeedbackQueryDto) {
    return this.feedback.list(query);
  }

  @Get('feedback/:feedbackId')
  @ApiOperation({ summary: 'One report.' })
  getFeedback(@Param('feedbackId', uuid) id: string) {
    return this.feedback.get(id);
  }

  @Patch('feedback/:feedbackId')
  @ApiOperation({ summary: 'Triage: set status (NEW / IN_PROGRESS / DONE / WONT_FIX) and a note the tester can see.' })
  updateFeedback(@Param('feedbackId', uuid) id: string, @Body() dto: UpdateFeedbackDto) {
    return this.feedback.update(id, dto);
  }

  @Get('feedback/:feedbackId/screenshot')
  @ApiOperation({ summary: 'The report’s screenshot.' })
  async screenshot(@Param('feedbackId', uuid) id: string) {
    const { data, contentType } = await this.feedback.screenshot(id);
    return new StreamableFile(data, { type: contentType, length: data.length });
  }
}
