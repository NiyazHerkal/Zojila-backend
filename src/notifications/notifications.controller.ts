import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import type { JwtPayload } from '../auth/strategies/jwt.strategy.js';
import { NotificationFeedService } from './notification-feed.service.js';

export class ListNotificationsQueryDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 30 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({ description: "The previous page's `nextBefore`" })
  @IsOptional()
  @IsUUID()
  before?: string;
}

export class MarkReadDto {
  @ApiPropertyOptional({ type: [String], description: 'Notification ids to mark read. Leave out to mark all read.' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @IsUUID('all', { each: true })
  ids?: string[];
}

/** The caller's notifications feed (backend handover 2026-10-22, Q2). */
@ApiTags('notifications')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly feed: NotificationFeedService) {}

  @Get()
  @ApiOperation({ summary: 'My notifications, newest first, with the unread count. Kept 90 days.' })
  list(@CurrentUser() user: JwtPayload, @Query() query: ListNotificationsQueryDto) {
    return this.feed.list(user.sub, query.limit, query.before);
  }

  @Get('unread-count')
  @ApiOperation({ summary: 'Just the unread count, for the badge.' })
  async unread(@CurrentUser() user: JwtPayload) {
    return { unreadCount: await this.feed.unreadCount(user.sub) };
  }

  @Post('read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark notifications read (`ids`), or all of them. Returns the new unread count.' })
  markRead(@CurrentUser() user: JwtPayload, @Body() dto: MarkReadDto) {
    return this.feed.markRead(user.sub, dto.ids);
  }
}
