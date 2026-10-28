import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { cert, getApps, initializeApp, type App, type ServiceAccount } from 'firebase-admin/app';
import { getMessaging, type Messaging } from 'firebase-admin/messaging';
import { In, Repository } from 'typeorm';
import { DeviceToken } from '../database/entities/index.js';
import { FEED_PUSH_TYPES, NotificationFeedService } from './notification-feed.service.js';

export interface PushMessage {
  title: string;
  body: string;
  /** Extra key/values for the app, e.g. { type: 'LOCATION_SHARE_EXPIRED', groupId }. Strings only (FCM rule). */
  data?: Record<string, string>;
}

// FCM error codes meaning the token is dead (app uninstalled, token rotated): delete it.
const DEAD_TOKEN_ERRORS = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
  'messaging/invalid-argument',
]);
const FIREBASE_APP_NAME = 'travelgo';
const FCM_MULTICAST_LIMIT = 500;

/**
 * Push notifications through Firebase Cloud Messaging (Android + iOS via APNs), using the
 * HTTP v1 API with a service account. Setup: see backend/docs/FIREBASE_SETUP.md.
 *
 * Without FIREBASE_SERVICE_ACCOUNT_FILE / _JSON it logs `[DEV PUSH]` lines instead of sending
 * (same idea as the OTP stub), so everything else works before Firebase exists.
 */
@Injectable()
export class PushService implements OnModuleInit {
  private readonly logger = new Logger(PushService.name);
  private messaging: Messaging | null = null;

  constructor(
    private readonly config: ConfigService,
    @InjectRepository(DeviceToken) private readonly devices: Repository<DeviceToken>,
    private readonly feed: NotificationFeedService,
  ) {}

  onModuleInit(): void {
    const account = this.loadServiceAccount();
    if (!account) {
      this.logger.warn('Firebase not configured: push notifications will be logged, not sent (see docs/FIREBASE_SETUP.md)');
      return;
    }
    const app: App =
      getApps().find((a) => a.name === FIREBASE_APP_NAME) ??
      initializeApp({ credential: cert(account) }, FIREBASE_APP_NAME);
    this.messaging = getMessaging(app);
    this.logger.log(`Firebase push enabled for project ${account.projectId}`);
  }

  get configured(): boolean {
    return this.messaging !== null;
  }

  /** Sends to every registered device of the user. Never throws; push is best-effort. */
  sendToUser(userId: string, message: PushMessage): Promise<void> {
    return this.sendToUsers([userId], message);
  }

  /**
   * Sends to every registered device of these users (e.g. a whole group). Never throws.
   * Alert, trip and expense pushes (FEED_PUSH_TYPES) also go into each user's notifications feed,
   * even for users with no device registered.
   */
  async sendToUsers(userIds: string[], message: PushMessage): Promise<void> {
    if (!userIds.length) return;
    const type = message.data?.type;
    if (type && FEED_PUSH_TYPES.has(type)) await this.feed.record(userIds, { type, ...message });
    try {
      const tokens = (await this.devices.find({ where: { userId: In(userIds) }, select: { token: true } })).map(
        (d) => d.token,
      );
      if (!tokens.length) return;

      if (!this.messaging) {
        this.logger.warn(
          `[DEV PUSH] to ${userIds.length} user(s) (${tokens.length} device(s)): ${message.title} — ${message.body}`,
        );
        return;
      }
      for (let i = 0; i < tokens.length; i += FCM_MULTICAST_LIMIT) {
        const batch = tokens.slice(i, i + FCM_MULTICAST_LIMIT);
        const res = await this.messaging.sendEachForMulticast({
          tokens: batch,
          notification: { title: message.title, body: message.body },
          data: message.data,
          android: { priority: 'high' },
          apns: { payload: { aps: { sound: 'default' } } },
        });
        const dead = res.responses
          .map((r, j) => (!r.success && r.error && DEAD_TOKEN_ERRORS.has(r.error.code) ? batch[j] : null))
          .filter((t): t is string => t !== null);
        if (dead.length) await this.devices.delete({ token: In(dead) });
      }
    } catch (err) {
      this.logger.warn(`Push to ${userIds.length} user(s) failed: ${(err as Error).message}`);
    }
  }

  // FIREBASE_SERVICE_ACCOUNT_FILE (path to the JSON, e.g. ./secrets/firebase-service-account.json)
  // or FIREBASE_SERVICE_ACCOUNT_JSON (the JSON itself, handy on hosting platforms).
  private loadServiceAccount(): ServiceAccount | null {
    const inline = this.config.get<string>('FIREBASE_SERVICE_ACCOUNT_JSON')?.trim();
    const file = this.config.get<string>('FIREBASE_SERVICE_ACCOUNT_FILE')?.trim();
    try {
      const raw = inline || (file ? readFileSync(resolve(file), 'utf8') : null);
      if (!raw) return null;
      const json = JSON.parse(raw) as { project_id: string; client_email: string; private_key: string };
      return { projectId: json.project_id, clientEmail: json.client_email, privateKey: json.private_key };
    } catch (err) {
      this.logger.error(`Could not read the Firebase service account: ${(err as Error).message}`);
      return null;
    }
  }
}
