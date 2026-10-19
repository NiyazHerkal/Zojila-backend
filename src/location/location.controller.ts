import { Body, Controller, Delete, Get, Param, Post, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import type { JwtPayload } from '../auth/strategies/jwt.strategy.js';
import { GroupMemberGuard } from '../groups/guards/group-member.guard.js';
import { LocationUpdateDto, StartSharingDto } from './dto/location.dto.js';
import { LocationService } from './location.service.js';

/** Live location per group (PDF §2.4). Every member controls only their own sharing. */
@ApiTags('location')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, GroupMemberGuard)
@Controller('groups/:groupId/location')
export class LocationController {
  constructor(private readonly locationService: LocationService) {}

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
}
