import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsLatitude,
  IsLongitude,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { MessageKind } from '../../database/entities/index.js';
import { VOICE_MAX_DURATION_MS } from '../voice-file.js';

const trim = () => Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value));

export const MESSAGE_MAX_LENGTH = 2000;

// --- socket payloads (validated with validateWsPayload) ---

/** A place shared in chat. */
export class SharedLocationDto {
  @IsLatitude({ message: 'location.lat must be a valid latitude' })
  lat!: number;

  @IsLongitude({ message: 'location.lng must be a valid longitude' })
  lng!: number;

  @IsOptional()
  @IsNumber({}, { message: 'location.accuracy must be a number (metres)' })
  @Min(0)
  accuracy?: number;

  // e.g. "Hotel Snow Valley" or "Parking at Rohtang"
  @IsOptional()
  @trim()
  @IsString({ message: 'location.label must be a string' })
  @MaxLength(100, { message: 'location.label must be at most 100 characters' })
  label?: string;
}

/**
 * `chat:send`. `kind` TEXT (default; emoji are just text) needs `body`; LOCATION needs
 * `location`, and `body` is an optional caption. Voice messages are uploaded over HTTP.
 * Forwarding sends only `forwardFromMessageId`: the server copies that message.
 */
export class SendMessageDto {
  @IsUUID(undefined, { message: 'groupId must be a UUID' })
  groupId!: string;

  @IsOptional()
  @IsIn([MessageKind.TEXT, MessageKind.LOCATION], {
    message: 'kind must be TEXT or LOCATION (voice messages are uploaded: POST /groups/:groupId/messages/voice)',
  })
  kind?: MessageKind.TEXT | MessageKind.LOCATION;

  // Required for TEXT (checked in ChatService, after trimming); an optional caption for LOCATION.
  @ValidateIf(
    (o: SendMessageDto) => (o.kind !== MessageKind.LOCATION && o.forwardFromMessageId === undefined) || o.body !== undefined,
  )
  @trim()
  @IsString({ message: 'body must be a string' })
  @MaxLength(MESSAGE_MAX_LENGTH, { message: `body must be at most ${MESSAGE_MAX_LENGTH} characters` })
  body?: string;

  @ValidateIf((o: SendMessageDto) => o.kind === MessageKind.LOCATION || o.location !== undefined)
  @ValidateNested({ message: 'location is required for a LOCATION message' })
  @Type(() => SharedLocationDto)
  @IsNotEmpty({ message: 'location is required for a LOCATION message' })
  location?: SharedLocationDto;

  // The app's own id for the message (e.g. a UUID it generates), echoed back so it can match
  // its "sending…" bubble. Resending the same value returns the original message.
  @IsOptional()
  @IsString({ message: 'clientMsgId must be a string' })
  @Length(1, 64, { message: 'clientMsgId must be 1–64 characters' })
  clientMsgId?: string;

  // The message this one answers (same group).
  @IsOptional()
  @IsUUID(undefined, { message: 'replyToMessageId must be a UUID' })
  replyToMessageId?: string;

  // A message to forward, from any group the sender is in. Nothing else is sent with it.
  @IsOptional()
  @IsUUID(undefined, { message: 'forwardFromMessageId must be a UUID' })
  forwardFromMessageId?: string;
}

/** `chat:typing` */
export class TypingDto {
  @IsUUID(undefined, { message: 'groupId must be a UUID' })
  groupId!: string;

  @IsBoolean({ message: 'isTyping must be true or false' })
  isTyping!: boolean;
}

// --- HTTP ---

/** Multipart fields that come with a voice message's `file`. */
export class SendVoiceDto {
  @ApiProperty({ example: 14500, description: 'Length of the recording in milliseconds (max 2 minutes)' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(VOICE_MAX_DURATION_MS, { message: 'A voice message can be at most 2 minutes long' })
  durationMs!: number;

  @ApiPropertyOptional({ maxLength: 64, description: 'Your own id for the message; resending it returns the original' })
  @IsOptional()
  @IsString()
  @Length(1, 64)
  clientMsgId?: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'The message this voice message answers (same group)' })
  @IsOptional()
  @IsUUID()
  replyToMessageId?: string;
}

export class MarkReadDto {
  @ApiProperty({ description: 'The newest message the member has seen; everything up to it counts as read' })
  @IsUUID(undefined, { message: 'messageId must be a UUID' })
  messageId!: string;
}

/** `chat:read` (socket) = MarkReadDto + groupId */
export class MarkReadWsDto extends MarkReadDto {
  @IsUUID(undefined, { message: 'groupId must be a UUID' })
  groupId!: string;
}

export class MessagesQueryDto {
  @ApiPropertyOptional({ description: 'Paging cursor: pass the previous page’s `nextBefore` (a message id) for older messages' })
  @IsOptional()
  @IsUUID()
  before?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({ description: 'Only messages containing this text (case-insensitive), 2–100 characters' })
  @IsOptional()
  @trim()
  @IsString()
  @Length(2, 100)
  search?: string;
}
