import { Body, Controller, Delete, Get, HttpStatus, Param, ParseUUIDPipe, Post, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import type { JwtPayload } from '../auth/strategies/jwt.strategy.js';
import { SavePlaceDto } from './saved-places.dto.js';
import { SavedPlacesService } from './saved-places.service.js';

/** The caller's saved places (backend handover 2026-10-22, P-07). Private to each user. */
@ApiTags('saved-places')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('me/saved-places')
export class SavedPlacesController {
  constructor(private readonly savedPlaces: SavedPlacesService) {}

  @Get()
  @ApiOperation({ summary: 'My saved places, newest first.' })
  list(@CurrentUser() user: JwtPayload) {
    return this.savedPlaces.list(user.sub);
  }

  @Post()
  @ApiOperation({ summary: 'Save a place: 201 when new, 200 with the existing save if it is already saved.' })
  async save(@CurrentUser() user: JwtPayload, @Body() dto: SavePlaceDto, @Res({ passthrough: true }) res: Response) {
    const { created, place } = await this.savedPlaces.save(user.sub, dto);
    res.status(created ? HttpStatus.CREATED : HttpStatus.OK);
    return place;
  }

  @Delete(':savedPlaceId')
  @ApiOperation({ summary: 'Remove a saved place.' })
  remove(@CurrentUser() user: JwtPayload, @Param('savedPlaceId', ParseUUIDPipe) id: string) {
    return this.savedPlaces.remove(user.sub, id);
  }
}
