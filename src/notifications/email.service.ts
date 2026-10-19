import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface EmailMessage {
  to: string;
  subject: string;
  /** Plain-text version (always sent, for clients that don't render HTML). */
  text: string;
  html: string;
}

const BREVO_SEND_URL = 'https://api.brevo.com/v3/smtp/email';
const TIMEOUT_MS = 5000;

/**
 * Transactional email through Brevo's HTTP API (free plan: 300 emails/day). Used for signup
 * codes, password-reset codes and email invites.
 *
 * Without BREVO_API_KEY it only logs, so dev and tests work without an account. A failed send
 * is logged and never fails the request: the user can ask for a new code.
 * The sender (EMAIL_FROM_ADDRESS) must be a verified sender or domain in Brevo.
 */
@Injectable()
export class EmailService implements OnModuleInit {
  private readonly logger = new Logger(EmailService.name);
  private readonly apiKey: string | null;
  private readonly from: { email: string; name: string };

  constructor(config: ConfigService) {
    this.apiKey = config.get<string>('BREVO_API_KEY')?.trim() || null;
    this.from = {
      email: config.get<string>('EMAIL_FROM_ADDRESS')?.trim() || 'noreply@travelgo.app',
      name: config.get<string>('EMAIL_FROM_NAME')?.trim() || 'TravelGo',
    };
  }

  get configured(): boolean {
    return this.apiKey !== null;
  }

  onModuleInit(): void {
    if (!this.configured) this.logger.warn('Brevo not configured: emails will be logged, not sent');
  }

  /** Returns true if Brevo accepted the email. */
  async send(message: EmailMessage): Promise<boolean> {
    if (!this.apiKey) return false;
    try {
      const res = await fetch(BREVO_SEND_URL, {
        method: 'POST',
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { 'api-key': this.apiKey, 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({
          sender: this.from,
          to: [{ email: message.to }],
          subject: message.subject,
          textContent: message.text,
          htmlContent: message.html,
        }),
      });
      if (!res.ok) {
        this.logger.error(`Brevo rejected email to ${message.to}: HTTP ${res.status} ${await res.text()}`);
        return false;
      }
      return true;
    } catch (err) {
      this.logger.error(`Brevo email to ${message.to} failed: ${(err as Error).message}`);
      return false;
    }
  }
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Minimal branded wrapper shared by all emails. `inner` must already be escaped HTML. */
export function emailLayout(inner: string): string {
  return (
    '<div style="font-family:Arial,Helvetica,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#1f2937">' +
    '<h2 style="margin:0 0 16px;color:#0f766e">TravelGo</h2>' +
    inner +
    '<p style="margin-top:32px;font-size:12px;color:#6b7280">You received this email because of activity on your TravelGo account. ' +
    'If this wasn\'t you, you can ignore it.</p></div>'
  );
}
