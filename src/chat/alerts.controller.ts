import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import type { JwtPayload } from '../auth/strategies/jwt.strategy.js';
import { GroupRole, type GroupMember } from '../database/entities/index.js';
import { CurrentMembership } from '../groups/decorators/current-membership.decorator.js';
import { GroupMemberGuard, GroupRoles } from '../groups/guards/group-member.guard.js';
import { perMinute, RATE_LIMITS } from '../security/rate-limit.js';
import { AlertsService } from './alerts.service.js';
import { AlertsQueryDto, CreateAlertDto, RaiseSosDto } from './dto/alerts.dto.js';

/** Alerts & SOS (PDF §2.5), over HTTP so the app gets a clear success/failure, even from the background. */
@ApiTags('alerts')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, GroupMemberGuard)
@Controller('groups/:groupId/alerts')
export class AlertsController {
  constructor(private readonly alerts: AlertsService) {}

  @Post()
  @Throttle(perMinute(RATE_LIMITS.alerts))
  @GroupRoles([GroupRole.ADMIN])
  @ApiOperation({
    summary: 'Admin: send a GENERAL announcement or a CRITICAL alert (category WEATHER / ROAD_CLOSURE / SAFETY / OTHER). Pushed to every member.',
  })
  create(@Param('groupId') groupId: string, @CurrentUser() user: JwtPayload, @Body() dto: CreateAlertDto) {
    return this.alerts.create(groupId, user.sub, dto);
  }

  @Post('sos')
  @SkipThrottle() // an emergency must never be refused; repeat taps return the same active SOS
  @ApiOperation({
    summary:
      'Any member: raise an SOS (red banner + push to everyone). Optional body and device coordinates; falls back to the live-location position. Notifies the group only, not emergency services.',
  })
  sos(@Param('groupId') groupId: string, @CurrentUser() user: JwtPayload, @Body() dto: RaiseSosDto) {
    return this.alerts.raiseSos(groupId, user.sub, dto);
  }

  @Get()
  @ApiOperation({ summary: 'Alerts, newest first. `active=true` = unresolved CRITICAL / SOS (banners to show on app start).' })
  list(@Param('groupId') groupId: string, @CurrentUser() user: JwtPayload, @Query() query: AlertsQueryDto) {
    return this.alerts.list(groupId, user.sub, query);
  }

  @Get(':alertId')
  @ApiOperation({ summary: 'One alert with who has acknowledged it and who has not yet.' })
  get(@Param('groupId') groupId: string, @CurrentUser() user: JwtPayload, @Param('alertId', ParseUUIDPipe) alertId: string) {
    return this.alerts.get(groupId, user.sub, alertId);
  }

  @Post(':alertId/ack')
  @HttpCode(200)
  @ApiOperation({ summary: 'Acknowledge a CRITICAL / SOS alert ("I\'ve seen it"). Idempotent.' })
  acknowledge(
    @Param('groupId') groupId: string,
    @CurrentMembership() membership: GroupMember,
    @Param('alertId', ParseUUIDPipe) alertId: string,
  ) {
    return this.alerts.acknowledge(groupId, membership, alertId);
  }

  @Post(':alertId/resolve')
  @HttpCode(200)
  @ApiOperation({ summary: 'End a CRITICAL / SOS alert. SOS: the sender or an admin. CRITICAL: admins.' })
  resolve(
    @Param('groupId') groupId: string,
    @CurrentMembership() membership: GroupMember,
    @Param('alertId', ParseUUIDPipe) alertId: string,
  ) {
    return this.alerts.resolve(groupId, membership, alertId);
  }
}
