import { Controller, Get, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { perMinute, RATE_LIMITS } from '../security/rate-limit.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import type { JwtPayload } from '../auth/strategies/jwt.strategy.js';
import { InvitesService } from './invites.service.js';

/** Invitee side of invitations. Admin-side endpoints live under /groups/:groupId/invites. */
@ApiTags('invites')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('invites')
export class InvitesController {
  constructor(private readonly invitesService: InvitesService) {}

  @Get()
  @ApiOperation({ summary: 'List pending SMS/email invitations addressed to the current user.' })
  listMine(@CurrentUser() user: JwtPayload) {
    return this.invitesService.listMine(user.sub);
  }

  @Post(':inviteId/accept')
  @ApiOperation({ summary: 'Accept an invitation — joins the group as a Viewer.' })
  accept(@CurrentUser() user: JwtPayload, @Param('inviteId', ParseUUIDPipe) inviteId: string) {
    return this.invitesService.respond(user.sub, inviteId, true);
  }

  @Post(':inviteId/reject')
  @ApiOperation({ summary: 'Reject an invitation.' })
  reject(@CurrentUser() user: JwtPayload, @Param('inviteId', ParseUUIDPipe) inviteId: string) {
    return this.invitesService.respond(user.sub, inviteId, false);
  }

  @Get('link/:token')
  @Throttle(perMinute(RATE_LIMITS.inviteLink))
  @ApiOperation({ summary: 'Preview the group behind a share link or short invite code (e.g. 7K2Q-MX4P) before joining.' })
  previewLink(@CurrentUser() user: JwtPayload, @Param('token') token: string) {
    return this.invitesService.previewLink(user.sub, token);
  }

  @Post('link/:token/accept')
  @Throttle(perMinute(RATE_LIMITS.inviteLink))
  @ApiOperation({ summary: 'Join a group via share link or short invite code — joins as a Viewer.' })
  acceptLink(@CurrentUser() user: JwtPayload, @Param('token') token: string) {
    return this.invitesService.acceptLink(user.sub, token);
  }
}
