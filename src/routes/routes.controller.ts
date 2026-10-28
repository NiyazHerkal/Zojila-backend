import { BadRequestException, Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsNumber, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { GroupMemberGuard } from '../groups/guards/group-member.guard.js';
import { perMinute, RATE_LIMITS } from '../security/rate-limit.js';
import { RoutesService } from './routes.service.js';

export const MAX_ROUTED_MEMBERS = 6; // the app routes at most 6 members (15 pairs)

export class MemberRoutesQueryDto {
  @ApiProperty({
    type: String,
    example: '7b4d…,9c1e…',
    description: `Comma-separated member ids, 2–${MAX_ROUTED_MEMBERS}. Every pair is routed once.`,
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.split(',').map((s) => s.trim()).filter(Boolean) : value,
  )
  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(MAX_ROUTED_MEMBERS)
  @IsUUID('all', { each: true })
  userIds!: string[];
}

export class PointToPointQueryDto {
  @ApiProperty({ example: 32.2432, description: "Start: usually the caller's own position" })
  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  fromLat!: number;

  @ApiProperty({ example: 77.1892 })
  @Type(() => Number)
  @IsNumber()
  @Min(-180)
  @Max(180)
  fromLng!: number;

  @ApiPropertyOptional({ description: 'Route to this member (they must be sharing). Or send toLat + toLng.' })
  @IsOptional()
  @IsUUID()
  toUserId?: string;

  @ApiPropertyOptional({ example: 32.5715 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  toLat?: number;

  @ApiPropertyOptional({ example: 77.0326 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-180)
  @Max(180)
  toLng?: number;
}

/** Road routes between members for the Journey map (backend handover 2026-10-22, P-05). Members only. */
@ApiTags('routes')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, GroupMemberGuard)
@Controller('groups/:groupId/routes')
export class RoutesController {
  constructor(private readonly routes: RoutesService) {}

  @Get('members')
  @Throttle(perMinute(RATE_LIMITS.routes))
  @ApiOperation({
    summary:
      'Road routes between every pair of the given members, from their live positions. A pair without a ' +
      'real road route has geometry null (status NO_ROUTE / UNAVAILABLE / NOT_CONFIGURED / LOCATION_UNAVAILABLE).',
  })
  members(@Param('groupId') groupId: string, @Query() query: MemberRoutesQueryDto) {
    return this.routes.memberRoutes(groupId, query.userIds);
  }

  @Get('point-to-point')
  @Throttle(perMinute(RATE_LIMITS.routes))
  @ApiOperation({ summary: 'Road route from a point (e.g. my position) to a sharing member or to toLat/toLng.' })
  pointToPoint(@Param('groupId') groupId: string, @Query() query: PointToPointQueryDto) {
    const hasPoint = query.toLat !== undefined || query.toLng !== undefined;
    if (query.toUserId ? hasPoint : query.toLat === undefined || query.toLng === undefined) {
      throw new BadRequestException('Send either toUserId, or toLat and toLng');
    }
    const from = { lat: query.fromLat, lng: query.fromLng };
    return this.routes.pointToPoint(
      groupId,
      from,
      query.toUserId ? { userId: query.toUserId } : { lat: query.toLat!, lng: query.toLng! },
    );
  }
}
