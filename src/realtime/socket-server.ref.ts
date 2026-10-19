import { Injectable } from '@nestjs/common';
import type { Server, Socket } from 'socket.io';

export const userRoom = (userId: string) => `user:${userId}`;

/** Set on every socket by the gateway's auth middleware. */
export interface SocketData {
  userId: string;
  exp: number;
}

export const socketUserId = (socket: Socket): string => (socket.data as SocketData).userId;

/**
 * Holds the socket.io server once the gateway has started. Services use this instead of
 * injecting the gateway itself, so the gateway can depend on services (presence) without an
 * injection cycle.
 */
@Injectable()
export class SocketServerRef {
  server: Server | null = null;
}
