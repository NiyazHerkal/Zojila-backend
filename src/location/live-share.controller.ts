import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import type { JwtPayload } from '../auth/strategies/jwt.strategy.js';
import { perMinute, RATE_LIMITS } from '../security/rate-limit.js';
import { StartLiveShareDto } from './dto/location.dto.js';
import { LiveShareService } from './live-share.service.js';

/** The sharer's side of live location for people outside the app (change request v1.0, change 10). */
@ApiTags('live location sharing')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('location-share/sessions')
export class LiveShareController {
  constructor(private readonly liveShare: LiveShareService) {}

  @Post()
  @ApiOperation({
    summary: 'Start sharing my live location with someone outside the app. Returns the link (shown once). Max 5 active.',
  })
  start(@CurrentUser() user: JwtPayload, @Body() dto: StartLiveShareDto) {
    return this.liveShare.start(user.sub, dto.duration, dto.recipientLabel);
  }

  @Get()
  @ApiOperation({ summary: 'My active live location links, with time left and whether they were opened.' })
  list(@CurrentUser() user: JwtPayload) {
    return this.liveShare.list(user.sub);
  }

  @Delete(':sessionId')
  @ApiOperation({ summary: 'Stop a live location link now. The recipient loses access at once.' })
  stop(@CurrentUser() user: JwtPayload, @Param('sessionId', ParseUUIDPipe) sessionId: string) {
    return this.liveShare.stop(user.sub, sessionId);
  }
}

/**
 * What the recipient's web page calls (no account, the link's token is the key). Built by the
 * web team; the backend only provides this data.
 */
@ApiTags('live location sharing')
@Controller('public/live')
export class PublicLiveShareController {
  constructor(private readonly liveShare: LiveShareService) {}

  @Get(':token')
  @Throttle(perMinute(RATE_LIMITS.liveShareView))
  @ApiOperation({ summary: "Recipient: the sharer's latest position. 404 unknown link, 410 ended. Poll every 10 s, or use the /live socket." })
  view(@Param('token') token: string) {
    return this.liveShare.view(token);
  }
}
