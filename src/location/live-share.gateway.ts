import { HttpException, Logger } from '@nestjs/common';
import { OnGatewayConnection, OnGatewayInit, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import type { Namespace, Socket } from 'socket.io';
import { LIVE_SHARE_EVENTS, LiveNamespaceRef, LiveShareService, liveRoom } from './live-share.service.js';

interface LiveSocketData {
  linkId: string;
  expiresAt: number;
}

/**
 * Socket namespace `/live` for people watching a shared live location (change request v1.0,
 * change 10). They have no account: they connect with the link's token,
 * `io(apiUrl + '/live', { auth: { token } })`, and receive `location:update` while the share
 * lasts, then `location_share:stopped` (and are disconnected). An unknown token is refused with
 * `connect_error` "Not found", an ended share with "Gone". The app's own namespace (JWT) is separate.
 */
@WebSocketGateway({ namespace: '/live', cors: { origin: '*' } })
export class LiveShareGateway implements OnGatewayInit, OnGatewayConnection {
  @WebSocketServer() namespace!: Namespace;
  private readonly logger = new Logger(LiveShareGateway.name);

  constructor(
    private readonly liveShare: LiveShareService,
    private readonly ref: LiveNamespaceRef,
  ) {}

  afterInit(namespace: Namespace): void {
    this.ref.namespace = namespace;
    namespace.use(async (socket, next) => {
      const token = (socket.handshake.auth as { token?: unknown } | undefined)?.token;
      if (typeof token !== 'string' || !token) return next(new Error('Not found'));
      try {
        const link = await this.liveShare.activeByToken(token);
        (socket.data as LiveSocketData) = { linkId: link.id, expiresAt: link.expiresAt.getTime() };
        next();
      } catch (err) {
        next(new Error(err instanceof HttpException && err.getStatus() === 410 ? 'Gone' : 'Not found'));
      }
    });
  }

  async handleConnection(socket: Socket): Promise<void> {
    const { linkId, expiresAt } = socket.data as LiveSocketData;
    await socket.join(liveRoom(linkId));
    // Safety net: the sweep normally ends the share and disconnects everyone at expiry.
    const timer = setTimeout(() => socket.disconnect(true), Math.max(expiresAt - Date.now(), 0) + 60_000);
    socket.once('disconnect', () => clearTimeout(timer));
    socket.emit('ready', { sessionId: linkId });
    this.logger.debug(`Live-share viewer ${socket.id} joined ${linkId}`);
  }
}

export { LIVE_SHARE_EVENTS };
