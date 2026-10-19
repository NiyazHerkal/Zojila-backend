import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import type { JwtPayload } from '../auth/strategies/jwt.strategy.js';
import { RECEIPT_MAX_BYTES } from '../expenses/receipt-file.js';
import { perMinute, RATE_LIMITS } from '../security/rate-limit.js';
import { CreateFeedbackDto } from './dto/feedback.dto.js';
import { FeedbackService, type UploadedImage } from './feedback.service.js';

/** In-app feedback / bug reports from beta testers (any signed-in user). */
@ApiTags('feedback')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('feedback')
export class FeedbackController {
  constructor(private readonly feedback: FeedbackService) {}

  @Post()
  @Throttle(perMinute(RATE_LIMITS.feedback))
  @ApiOperation({ summary: 'Send feedback or a bug report (with app/device details). The team is emailed.' })
  create(@CurrentUser() user: JwtPayload, @Body() dto: CreateFeedbackDto) {
    return this.feedback.create(user.sub, dto);
  }

  @Get('mine')
  @ApiOperation({ summary: 'My reports, newest first, with their status and the team’s note.' })
  mine(@CurrentUser() user: JwtPayload) {
    return this.feedback.listMine(user.sub);
  }

  @Put(':feedbackId/screenshot')
  @HttpCode(200)
  @Throttle(perMinute(RATE_LIMITS.upload))
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } }, required: ['file'] } })
  @ApiOperation({ summary: 'Attach a screenshot to my report: JPEG/PNG/WebP/HEIC, max 5 MB, field `file`.' })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: RECEIPT_MAX_BYTES + 1, files: 1 } }))
  screenshot(
    @CurrentUser() user: JwtPayload,
    @Param('feedbackId', new ParseUUIDPipe({ version: '4' })) id: string,
    @UploadedFile() file: UploadedImage | undefined,
  ) {
    return this.feedback.attachScreenshot(user.sub, id, file);
  }
}
