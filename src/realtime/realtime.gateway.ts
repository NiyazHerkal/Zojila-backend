import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { UsageService } from '../analytics/usage.service.js';
import type { JwtPayload } from '../auth/strategies/jwt.strategy.js';
import { UsageMetric } from '../database/entities/index.js';
import { PresenceService } from './presence.service.js';
import { SocketServerRef, userRoom, type SocketData } from './socket-server.ref.js';

export { userRoom };

/**
 * Real-time channel for the app (socket.io on the API's port, path `/socket.io`).
 *
 * Connect with the access token: `io(url, { auth: { token: accessToken } })`. Bad or missing
 * tokens are refused (`connect_error: "Unauthorized"`). Each socket joins a private
 * `user:<id>` room. Group events are sent to the rooms of the group's *current* members (see
 * RealtimeService), so no group-room bookkeeping is needed when membership changes.
 *
 * When the access token expires the server sends `session:expired` and disconnects; the app
 * refreshes its token and reconnects.
 *
 * Connecting / disconnecting also drives presence (online / offline, see PresenceService).
 * Chat's inbound events live in ChatGateway, which shares this server and its auth middleware.
 */
@WebSocketGateway({ cors: { origin: '*' } })
export class RealtimeGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server!: Server;
  private readonly logger = new Logger(RealtimeGateway.name);

  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly ref: SocketServerRef,
    private readonly presence: PresenceService,
    private readonly usage: UsageService,
  ) {}

  afterInit(server: Server): void {
    this.ref.server = server;
    server.use(async (socket, next) => {
      const token = this.extractToken(socket);
      if (!token) return next(new Error('Unauthorized'));
      try {
        const payload = await this.jwt.verifyAsync<JwtPayload & { exp: number }>(token, {
          secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
        });
        (socket.data as SocketData) = { userId: payload.sub, exp: payload.exp };
        next();
      } catch {
        next(new Error('Unauthorized'));
      }
    });
  }

  async handleConnection(socket: Socket): Promise<void> {
    const { userId, exp } = socket.data as SocketData;
    await socket.join(userRoom(userId));
    this.usage.record(UsageMetric.APP_CONNECTED, userId); // daily active users

    const timer = setTimeout(() => {
      socket.emit('session:expired');
      socket.disconnect(true);
    }, Math.max(exp * 1000 - Date.now(), 0));
    socket.once('disconnect', () => clearTimeout(timer));

    socket.emit('ready', { userId });
    this.logger.debug(`Socket ${socket.id} connected for user ${userId}`);
    await this.presence
      .userConnected(userId)
      .catch((err: Error) => this.logger.warn(`Presence update for ${userId} failed: ${err.message}`));
  }

  handleDisconnect(socket: Socket): void {
    const data = socket.data as SocketData | undefined;
    if (data?.userId) this.presence.userDisconnected(data.userId);
  }

  // Token from the socket.io `auth` payload (preferred) or an `Authorization: Bearer` header.
  private extractToken(socket: Socket): string | null {
    const fromAuth = (socket.handshake.auth as { token?: unknown } | undefined)?.token;
    if (typeof fromAuth === 'string' && fromAuth) return fromAuth.replace(/^Bearer\s+/i, '');
    const header = socket.handshake.headers.authorization;
    return header?.startsWith('Bearer ') ? header.slice(7) : null;
  }
}
