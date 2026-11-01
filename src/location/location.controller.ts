import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import type { JwtPayload } from '../auth/strategies/jwt.strategy.js';
import { CurrentMembership } from '../groups/decorators/current-membership.decorator.js';
import { AllowWhenClosed, GroupMemberGuard } from '../groups/guards/group-member.guard.js';
import type { GroupMember } from '../database/entities/index.js';
import { LocationHistoryQueryDto, LocationUpdateDto, StartSharingDto, UpdateLocationHistoryDto } from './dto/location.dto.js';
import { LocationHistoryService } from './location-history.service.js';
import { LocationService } from './location.service.js';

/** Live location per group (PDF §2.4). Every member controls only their own sharing. */
@ApiTags('location')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, GroupMemberGuard)
@Controller('groups/:groupId/location')
export class LocationController {
  constructor(
    private readonly locationService: LocationService,
    private readonly history: LocationHistoryService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Group map feed: every member with trip status, sharing state and live position.' })
  feed(@Param('groupId') groupId: string) {
    return this.locationService.feed(groupId);
  }

  @Post()
  @ApiOperation({
    summary: 'Send my position(s) while sharing: `points` = 1 (foreground) or a batch (background). 409 if sharing is off.',
  })
  record(@Param('groupId') groupId: string, @CurrentUser() user: JwtPayload, @Body() dto: LocationUpdateDto) {
    return this.locationService.recordPositions(groupId, user.sub, dto.points);
  }

  @Get('share')
  @ApiOperation({ summary: 'My sharing state in this group, with remaining time.' })
  mySession(@Param('groupId') groupId: string, @CurrentUser() user: JwtPayload) {
    return this.locationService.mySession(groupId, user.sub);
  }

  @Put('share')
  @ApiOperation({ summary: 'Start sharing (or change duration; the timer restarts): ONE_HOUR / FOUR_HOURS / EIGHT_HOURS / ALWAYS.' })
  start(@Param('groupId') groupId: string, @CurrentUser() user: JwtPayload, @Body() dto: StartSharingDto) {
    return this.locationService.startSharing(groupId, user.sub, dto.duration);
  }

  @Delete('share')
  @ApiOperation({ summary: 'Stop sharing now.' })
  stop(@Param('groupId') groupId: string, @CurrentUser() user: JwtPayload) {
    return this.locationService.stopSharing(groupId, user.sub);
  }

  // --- location history (opt-in per group) ---

  @Get('history/settings')
  @ApiOperation({ summary: 'My location history setting in this group, with the notice to show before opting in.' })
  historySettings(@CurrentMembership() membership: GroupMember) {
    return this.history.settings(membership);
  }

  @Put('history/settings')
  @AllowWhenClosed() // turning it off must always work; turning it on is refused on a closed trip
  @ApiOperation({
    summary: 'Turn my location history on (send the notice version shown) or off (stops saving and deletes my trail here).',
  })
  updateHistorySettings(@CurrentMembership() membership: GroupMember, @Body() dto: UpdateLocationHistoryDto) {
    return this.history.update(membership, dto.enabled, dto.noticeVersion);
  }

  @Delete('history')
  @AllowWhenClosed()
  @ApiOperation({ summary: 'Delete my saved trail in this group (the setting stays as it is).' })
  deleteMyHistory(@Param('groupId') groupId: string, @CurrentUser() user: JwtPayload) {
    return this.history.deleteMine(groupId, user.sub);
  }

  @Get('history/:userId')
  @ApiOperation({ summary: "A member's saved trail, oldest first (others' only while their history is on). Paged by `after`." })
  memberHistory(
    @Param('groupId') groupId: string,
    @Param('userId', ParseUUIDPipe) userId: string,
    @CurrentUser() user: JwtPayload,
    @Query() query: LocationHistoryQueryDto,
  ) {
    return this.history.history(groupId, user.sub, userId, query);
  }
}
