import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import type { JwtPayload } from '../auth/strategies/jwt.strategy.js';
import { GroupMemberGuard } from '../groups/guards/group-member.guard.js';
import { SetStatusDto } from './dto/set-status.dto.js';
import { StatusHistoryQueryDto } from './dto/status-history-query.dto.js';
import { StatusService } from './status.service.js';

/** Trip status (PDF §2.6). Any member (Admin or Viewer) can set their own status. */
@ApiTags('status')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, GroupMemberGuard)
@Controller('groups/:groupId/status')
export class StatusController {
  constructor(private readonly statusService: StatusService) {}

  @Post()
  @ApiOperation({
    summary: 'Set my status: ARRIVED / STOPPED / NEED_HELP / IN_TRANSIT (+ optional note). Pushed live as `status:updated`.',
  })
  setStatus(@Param('groupId') groupId: string, @CurrentUser() user: JwtPayload, @Body() dto: SetStatusDto) {
    return this.statusService.setStatus(groupId, user.sub, dto);
  }

  @Get()
  @ApiOperation({ summary: "Every member's current status (null if not set yet)." })
  current(@Param('groupId') groupId: string) {
    return this.statusService.current(groupId);
  }

  @Get('history')
  @ApiOperation({ summary: 'Status history, newest first, optionally for one member. Paged with `before`.' })
  history(@Param('groupId') groupId: string, @Query() query: StatusHistoryQueryDto) {
    return this.statusService.history(groupId, query);
  }
}
