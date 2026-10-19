import { Controller, Get, Headers, Param, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import type { GroupMember } from '../database/entities/index.js';
import { CurrentMembership } from '../groups/decorators/current-membership.decorator.js';
import { GroupMemberGuard } from '../groups/guards/group-member.guard.js';
import { OfflineService } from './offline.service.js';

/** Offline support (PDF §2.8): one bundle with everything the app caches for a trip. */
@ApiTags('offline')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, GroupMemberGuard)
@Controller('groups/:groupId/offline-bundle')
export class OfflineController {
  constructor(private readonly offline: OfflineService) {}

  @Get()
  @ApiOperation({
    summary:
      'Everything to cache for offline use: group, members, itinerary (+ draft for admins), statuses, expenses + summary, recent chat, active alerts, offline map region.',
  })
  @ApiHeader({ name: 'If-None-Match', required: false, description: 'The ETag from your last bundle: 304 if nothing changed' })
  @ApiResponse({ status: 304, description: 'Nothing changed since the ETag you sent' })
  async bundle(
    @Param('groupId') groupId: string,
    @CurrentMembership() me: GroupMember,
    @Headers('if-none-match') ifNoneMatch: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { etag, body } = await this.offline.bundle(groupId, me);
    res.setHeader('ETag', etag);
    res.setHeader('Cache-Control', 'private, no-cache');
    if (ifNoneMatch && ifNoneMatch.split(',').some((tag) => tag.trim().replace(/^W\//, '') === etag)) {
      res.status(304);
      return;
    }
    return body;
  }
}
