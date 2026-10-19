import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { GroupMemberGuard } from '../groups/guards/group-member.guard.js';
import { PresenceService } from './presence.service.js';

@ApiTags('presence')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, GroupMemberGuard)
@Controller('groups/:groupId/presence')
export class PresenceController {
  constructor(private readonly presence: PresenceService) {}

  @Get()
  @ApiOperation({
    summary:
      'Who in the group is online right now (online first), with `lastSeenAt` for offline members. Live changes arrive as `presence:updated`.',
  })
  list(@Param('groupId') groupId: string) {
    return this.presence.groupPresence(groupId);
  }
}
