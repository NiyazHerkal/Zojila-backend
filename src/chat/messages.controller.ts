import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiProduces, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import type { JwtPayload } from '../auth/strategies/jwt.strategy.js';
import type { GroupMember } from '../database/entities/index.js';
import { CurrentMembership } from '../groups/decorators/current-membership.decorator.js';
import { GroupMemberGuard } from '../groups/guards/group-member.guard.js';
import { perMinute, RATE_LIMITS } from '../security/rate-limit.js';
import { ChatService } from './chat.service.js';
import { MarkReadDto, MessagesQueryDto, SendVoiceDto } from './dto/chat.dto.js';
import { VOICE_MAX_BYTES } from './voice-file.js';

/**
 * Group chat over HTTP: history, search and read markers. Sending is over the socket
 * (`chat:send`); see ChatGateway.
 */
@ApiTags('chat')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, GroupMemberGuard)
@Controller('groups/:groupId/messages')
export class MessagesController {
  constructor(private readonly chat: ChatService) {}

  @Get()
  @ApiOperation({
    summary:
      'Chat history (messages + alerts), oldest first within a page. Page to older messages with `before` = `nextBefore`. Optional `search`.',
  })
  list(@Param('groupId') groupId: string, @CurrentUser() user: JwtPayload, @Query() query: MessagesQueryDto) {
    return this.chat.list(groupId, user.sub, query);
  }

  @Get('unread')
  @ApiOperation({ summary: 'My unread count and read marker in this group (for badges).' })
  unread(@Param('groupId') groupId: string, @CurrentMembership() membership: GroupMember) {
    return this.chat.unread(groupId, membership);
  }

  @Post('read')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Mark everything up to `messageId` as read (same as the `chat:read` socket event). Markers only move forward.',
  })
  markRead(@Param('groupId') groupId: string, @CurrentMembership() membership: GroupMember, @Body() dto: MarkReadDto) {
    return this.chat.markRead(groupId, membership, dto.messageId);
  }

  @Post('voice')
  @Throttle(perMinute(RATE_LIMITS.upload))
  @ApiOperation({
    summary: 'Send a voice message: multipart `file` (AAC/M4A or Ogg, ≤ 2 MB) + `durationMs` (≤ 2 min). Appears in the chat like any message.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file', 'durationMs'],
      properties: {
        file: { type: 'string', format: 'binary' },
        durationMs: { type: 'integer' },
        clientMsgId: { type: 'string' },
        replyToMessageId: { type: 'string', format: 'uuid' },
      },
    },
  })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: VOICE_MAX_BYTES + 1, files: 1 } }))
  sendVoice(
    @Param('groupId') groupId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: SendVoiceDto,
    @UploadedFile() file: { buffer: Buffer; size: number } | undefined,
  ) {
    return this.chat.sendVoice(groupId, user.sub, file, dto.durationMs, dto.clientMsgId, dto.replyToMessageId);
  }

  @Delete(':messageId')
  @ApiOperation({
    summary:
      'Delete my own message (text, location or voice; not alerts). It stays in the chat as deleted, and the group gets `chat:message_deleted`.',
  })
  deleteMessage(
    @Param('groupId') groupId: string,
    @CurrentUser() user: JwtPayload,
    @Param('messageId', ParseUUIDPipe) messageId: string,
  ) {
    return this.chat.deleteMessage(groupId, user.sub, messageId);
  }

  @Get(':messageId/voice')
  @ApiProduces('audio/mp4', 'audio/aac', 'audio/ogg')
  @ApiOperation({ summary: "Play a voice message's recording (members)." })
  async voice(@Param('groupId') groupId: string, @Param('messageId', ParseUUIDPipe) messageId: string) {
    const { data, contentType, filename } = await this.chat.getVoice(groupId, messageId);
    return new StreamableFile(data, { type: contentType, disposition: `inline; filename="${filename}"` });
  }

  @Get(':messageId/reads')
  @ApiOperation({ summary: 'Read receipts for one message: members who have read it and who have not.' })
  readers(@Param('groupId') groupId: string, @Param('messageId', ParseUUIDPipe) messageId: string) {
    return this.chat.readers(groupId, messageId);
  }
}
