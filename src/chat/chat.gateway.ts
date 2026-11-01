import { HttpException, HttpStatus, Logger } from '@nestjs/common';
import { ConnectedSocket, MessageBody, SubscribeMessage, WebSocketGateway } from '@nestjs/websockets';
import type { Socket } from 'socket.io';
import { socketUserId } from '../realtime/socket-server.ref.js';
import { SlidingWindowLimiter } from '../security/rate-limit.js';
import { reportError } from '../security/sentry.js';
import { validateWsPayload, wsAck } from '../realtime/ws-validation.js';
import { ChatService } from './chat.service.js';
import { MarkReadWsDto, SendMessageDto, TypingDto } from './dto/chat.dto.js';

/**
 * Inbound chat events. Shares the socket.io server (and its JWT handshake) with
 * RealtimeGateway, so `socket.data.userId` is always the authenticated user.
 *
 * Every event answers through the socket.io acknowledgement callback with
 * `{ ok: true, data }` or `{ ok: false, error: { status, message, code } }`:
 *
 *   socket.emit('chat:send', { groupId, body, clientMsgId }, (res) => …)
 *
 * Non-members get `status: 404, "Group not found"`, same as the REST API.
 */
@WebSocketGateway({ cors: { origin: '*' } })
export class ChatGateway {
  private readonly logger = new Logger(ChatGateway.name);

  // Spam guard: at most 20 messages per 10 s per user (typing and read events aren't limited).
  private readonly sendLimiter = new SlidingWindowLimiter(20, 10_000);

  constructor(private readonly chat: ChatService) {}

  /** Send a message. The saved message comes back in the ack and goes to the group as `chat:message`. */
  @SubscribeMessage('chat:send')
  send(@ConnectedSocket() socket: Socket, @MessageBody() payload: unknown) {
    return wsAck(async () => {
      if (!this.sendLimiter.allow(socketUserId(socket))) {
        throw new HttpException("You're sending messages too fast. Wait a few seconds.", HttpStatus.TOO_MANY_REQUESTS);
      }
      const dto = await validateWsPayload(SendMessageDto, payload);
      return this.chat.sendMessage(dto.groupId, socketUserId(socket), dto, dto.clientMsgId);
    }, this.onError('chat:send'));
  }

  /** Typing on/off, relayed to the rest of the group as `chat:typing`. */
  @SubscribeMessage('chat:typing')
  typing(@ConnectedSocket() socket: Socket, @MessageBody() payload: unknown) {
    return wsAck(async () => {
      const dto = await validateWsPayload(TypingDto, payload);
      return this.chat.typing(dto.groupId, socketUserId(socket), dto.isTyping);
    }, this.onError('chat:typing'));
  }

  /** Read up to a message. The group gets `chat:read` if the marker moved. */
  @SubscribeMessage('chat:read')
  read(@ConnectedSocket() socket: Socket, @MessageBody() payload: unknown) {
    return wsAck(async () => {
      const dto = await validateWsPayload(MarkReadWsDto, payload);
      const membership = await this.chat.requireMember(dto.groupId, socketUserId(socket));
      return this.chat.markRead(dto.groupId, membership, dto.messageId);
    }, this.onError('chat:read'));
  }

  private onError(event: string) {
    return (err: Error) => {
      this.logger.error(`${event} failed: ${err.message}`, err.stack);
      reportError(err, event);
    };
  }
}
