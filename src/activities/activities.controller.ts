import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { GroupRole, type GroupMember } from '../database/entities/index.js';
import { CurrentMembership } from '../groups/decorators/current-membership.decorator.js';
import { GroupMemberGuard, GroupRoles } from '../groups/guards/group-member.guard.js';
import { ActivitiesService } from './activities.service.js';
import {
  CreateActivityUpdateDto,
  EditActivityUpdateDto,
  ListActivityUpdatesQueryDto,
  SetActivityStatusDto,
} from './dto/activity.dto.js';

/**
 * Activity status and updates (change request v1.0, changes 3–4). An activity is a stop of the
 * finalized itinerary, identified by its `activityId` (stable across versions).
 */
@ApiTags('activities')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, GroupMemberGuard)
@Controller('groups/:groupId')
export class ActivitiesController {
  constructor(private readonly activities: ActivitiesService) {}

  @Get('activities')
  @ApiOperation({ summary: 'Stops of the latest finalized itinerary with their status and update count (members).' })
  list(@Param('groupId') groupId: string) {
    return this.activities.list(groupId);
  }

  @Patch('activities/:activityId/status')
  @GroupRoles([GroupRole.ADMIN])
  @ApiOperation({ summary: 'Set UPCOMING / CURRENT / COMPLETED (admin). A new CURRENT completes the previous one.' })
  setStatus(
    @Param('groupId') groupId: string,
    @Param('activityId', ParseUUIDPipe) activityId: string,
    @Body() dto: SetActivityStatusDto,
    @CurrentMembership() membership: GroupMember,
  ) {
    return this.activities.setStatus(groupId, membership, activityId, dto.status);
  }

  @Get('activities/:activityId/updates')
  @ApiOperation({ summary: "An activity's updates, newest first (members)." })
  listUpdates(
    @Param('groupId') groupId: string,
    @Param('activityId', ParseUUIDPipe) activityId: string,
    @Query() query: ListActivityUpdatesQueryDto,
    @CurrentMembership() membership: GroupMember,
  ) {
    return this.activities.listUpdates(groupId, membership, activityId, query);
  }

  @Post('activities/:activityId/updates')
  @ApiOperation({ summary: 'Post a text update about an activity (any member).' })
  addUpdate(
    @Param('groupId') groupId: string,
    @Param('activityId', ParseUUIDPipe) activityId: string,
    @Body() dto: CreateActivityUpdateDto,
    @CurrentMembership() membership: GroupMember,
  ) {
    return this.activities.addUpdate(groupId, membership, activityId, dto);
  }

  @Patch('activity-updates/:updateId')
  @ApiOperation({ summary: 'Edit the text of your own update.' })
  editUpdate(
    @Param('groupId') groupId: string,
    @Param('updateId', ParseUUIDPipe) updateId: string,
    @Body() dto: EditActivityUpdateDto,
    @CurrentMembership() membership: GroupMember,
  ) {
    return this.activities.editUpdate(groupId, membership, updateId, dto.text);
  }

  @Delete('activity-updates/:updateId')
  @ApiOperation({ summary: 'Delete an update (its author, or an admin).' })
  deleteUpdate(
    @Param('groupId') groupId: string,
    @Param('updateId', ParseUUIDPipe) updateId: string,
    @CurrentMembership() membership: GroupMember,
  ) {
    return this.activities.deleteUpdate(groupId, membership, updateId);
  }
}
