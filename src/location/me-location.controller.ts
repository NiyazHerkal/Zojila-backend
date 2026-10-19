import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import type { JwtPayload } from '../auth/strategies/jwt.strategy.js';
import { LocationUpdateDto } from './dto/location.dto.js';
import { LocationService } from './location.service.js';

/**
 * The user's own location across all groups (change request v1.0, change 2). Sharing is still
 * switched on per group (`PUT /groups/:groupId/location/share`); this sends one feed to all of them.
 */
@ApiTags('location')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('location')
export class MeLocationController {
  constructor(private readonly locationService: LocationService) {}

  @Post()
  @ApiOperation({
    summary: 'Send my position(s) to every group I share with (1 point or a background batch). 409 if I share with none.',
  })
  record(@CurrentUser() user: JwtPayload, @Body() dto: LocationUpdateDto) {
    return this.locationService.recordEverywhere(user.sub, dto.points);
  }

  @Get('sharing')
  @ApiOperation({ summary: 'The groups I share my location with right now, with remaining time.' })
  mySharing(@CurrentUser() user: JwtPayload) {
    return this.locationService.mySharing(user.sub);
  }
}
