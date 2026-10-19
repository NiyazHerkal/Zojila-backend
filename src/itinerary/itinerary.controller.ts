import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiProduces, ApiQuery, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import type { JwtPayload } from '../auth/strategies/jwt.strategy.js';
import { UsageService } from '../analytics/usage.service.js';
import { GroupRole, UsageMetric } from '../database/entities/index.js';
import { GroupMemberGuard, GroupRoles } from '../groups/guards/group-member.guard.js';
import { CreateWaypointDto } from './dto/create-waypoint.dto.js';
import { ReorderWaypointsDto } from './dto/reorder-waypoints.dto.js';
import { UpdateWaypointDto } from './dto/update-waypoint.dto.js';
import { ItineraryService } from './itinerary.service.js';

const ADMIN = [GroupRole.ADMIN];

const IF_MATCH_DOC = {
  name: 'If-Match',
  required: false,
  description: 'The draft `revision` your edit is based on. If another admin changed the draft since, you get 412.',
};

/** If-Match: `3`, `"3"` or `W/"3"` → 3. Absent → undefined (no check). */
function revisionFrom(ifMatch: string | undefined): number | undefined {
  if (ifMatch === undefined || ifMatch.trim() === '') return undefined;
  const match = /^(?:W\/)?"?(\d+)"?$/.exec(ifMatch.trim());
  if (!match) throw new BadRequestException('If-Match must be the draft revision number, e.g. If-Match: 3');
  return Number(match[1]);
}

/**
 * Group itinerary (PDF §2.3.2–2.3.3). Members read finalized versions; admins work on the
 * draft. Every write returns the full itinerary, since start/mid/end roles shift as pins move.
 */
@ApiTags('itinerary')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, GroupMemberGuard)
@Controller('groups/:groupId/itinerary')
export class ItineraryController {
  constructor(
    private readonly itineraryService: ItineraryService,
    private readonly usage: UsageService,
  ) {}

  // --- finalized versions (members) ---

  @Get()
  @ApiOperation({ summary: 'Latest finalized itinerary (members). 404 until the admin finalizes one.' })
  getLatest(@Param('groupId') groupId: string) {
    return this.itineraryService.getLatest(groupId);
  }

  @Get('versions')
  @ApiOperation({ summary: 'All finalized versions, newest first (members).' })
  listVersions(@Param('groupId') groupId: string) {
    return this.itineraryService.listVersions(groupId);
  }

  @Get('versions/:version')
  @ApiOperation({ summary: 'A specific finalized version (members).' })
  getVersion(@Param('groupId') groupId: string, @Param('version', ParseIntPipe) version: number) {
    return this.itineraryService.getVersion(groupId, version);
  }

  @Get('route')
  @ApiQuery({ name: 'version', required: false, description: 'Defaults to the latest finalized version' })
  @ApiOperation({
    summary:
      'Map line joining the stops in order, along roads where possible (members): GeoJSON LineString + per-leg distance/time.',
  })
  getRoute(
    @Param('groupId') groupId: string,
    @Query('version', new ParseIntPipe({ optional: true })) version?: number,
  ) {
    return this.itineraryService.getRoute(groupId, version);
  }

  @Get('pdf')
  @ApiProduces('application/pdf')
  @ApiQuery({ name: 'version', required: false, description: 'Defaults to the latest finalized version' })
  @ApiOperation({ summary: 'Download a finalized itinerary as a PDF (members).' })
  async exportPdf(
    @Param('groupId') groupId: string,
    @CurrentUser() user: JwtPayload,
    @Query('version', new ParseIntPipe({ optional: true })) version?: number,
  ) {
    const { file, filename } = await this.itineraryService.exportPdf(groupId, version);
    this.usage.record(UsageMetric.ITINERARY_PDF_EXPORTED, user.sub, groupId);
    return new StreamableFile(file, {
      type: 'application/pdf',
      disposition: `attachment; filename="${filename}"`,
      length: file.length,
    });
  }

  @Post('refresh')
  @GroupRoles(ADMIN)
  @ApiOperation({
    summary: 'Re-fetch elevation + weather on the latest finalized version (admin). Doesn’t change the plan itself.',
  })
  refreshLatest(@Param('groupId') groupId: string) {
    return this.itineraryService.refreshEnrichment(groupId, 'latest');
  }

  // --- draft (admins) ---

  @Get('draft')
  @GroupRoles(ADMIN)
  @ApiOperation({ summary: 'The working draft (admin).' })
  getDraft(@Param('groupId') groupId: string) {
    return this.itineraryService.getDraft(groupId);
  }

  @Get('draft/route')
  @GroupRoles(ADMIN)
  @ApiOperation({ summary: 'Map line for the draft (admin), to preview the route while editing stops.' })
  getDraftRoute(@Param('groupId') groupId: string) {
    return this.itineraryService.getDraftRoute(groupId);
  }

  @Post('draft')
  @GroupRoles(ADMIN)
  @ApiOperation({
    summary: 'Start a draft (admin): a copy of the latest finalized version, or empty. 409 if one exists.',
  })
  createDraft(@Param('groupId') groupId: string, @CurrentUser() user: JwtPayload) {
    return this.itineraryService.createDraft(groupId, user.sub);
  }

  @Delete('draft')
  @GroupRoles(ADMIN)
  @ApiOperation({ summary: 'Discard the draft (admin). Finalized versions are untouched.' })
  discardDraft(@Param('groupId') groupId: string) {
    return this.itineraryService.discardDraft(groupId);
  }

  @Post('draft/finalize')
  @GroupRoles(ADMIN)
  @ApiOperation({
    summary: 'Finalize the draft (admin): locks it as the next version, visible to the group. Needs ≥ 2 pins.',
  })
  @ApiHeader(IF_MATCH_DOC)
  finalize(@Param('groupId') groupId: string, @Headers('if-match') ifMatch?: string) {
    return this.itineraryService.finalize(groupId, revisionFrom(ifMatch));
  }

  @Post('draft/refresh')
  @GroupRoles(ADMIN)
  @ApiOperation({ summary: 'Re-fetch elevation + weather for every pin in the draft (admin).' })
  refreshDraft(@Param('groupId') groupId: string) {
    return this.itineraryService.refreshEnrichment(groupId, 'draft');
  }

  @Post('draft/waypoints')
  @GroupRoles(ADMIN)
  @ApiOperation({ summary: 'Drop a pin (admin). Appends as the new end point unless `position` is given.' })
  @ApiHeader(IF_MATCH_DOC)
  addWaypoint(@Param('groupId') groupId: string, @Body() dto: CreateWaypointDto, @Headers('if-match') ifMatch?: string) {
    return this.itineraryService.addWaypoint(groupId, dto, revisionFrom(ifMatch));
  }

  @Put('draft/waypoints/order')
  @GroupRoles(ADMIN)
  @ApiOperation({ summary: 'Reorder pins, i.e. drag-and-drop (admin). First = start, last = end.' })
  @ApiHeader(IF_MATCH_DOC)
  reorder(@Param('groupId') groupId: string, @Body() dto: ReorderWaypointsDto, @Headers('if-match') ifMatch?: string) {
    return this.itineraryService.reorder(groupId, dto.waypointIds, revisionFrom(ifMatch));
  }

  @Patch('draft/waypoints/:waypointId')
  @GroupRoles(ADMIN)
  @ApiOperation({ summary: 'Edit a pin: name, location, date, notes (admin).' })
  @ApiHeader(IF_MATCH_DOC)
  updateWaypoint(
    @Param('groupId') groupId: string,
    @Param('waypointId', ParseUUIDPipe) waypointId: string,
    @Body() dto: UpdateWaypointDto,
    @Headers('if-match') ifMatch?: string,
  ) {
    return this.itineraryService.updateWaypoint(groupId, waypointId, dto, revisionFrom(ifMatch));
  }

  @Delete('draft/waypoints/:waypointId')
  @GroupRoles(ADMIN)
  @ApiOperation({ summary: 'Delete a pin (admin).' })
  @ApiHeader(IF_MATCH_DOC)
  removeWaypoint(
    @Param('groupId') groupId: string,
    @Param('waypointId', ParseUUIDPipe) waypointId: string,
    @Headers('if-match') ifMatch?: string,
  ) {
    return this.itineraryService.removeWaypoint(groupId, waypointId, revisionFrom(ifMatch));
  }
}
