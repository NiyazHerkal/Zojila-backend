import { Injectable, Logger } from '@nestjs/common';
import { EmailService, emailLayout, escapeHtml } from './email.service.js';

/**
 * Delivers group invitations. Email goes through Brevo (EmailService); SMS is still a stub that
 * logs the message (no SMS vendor yet, same as OtpDeliveryService).
 */
@Injectable()
export class InviteDeliveryService {
  private readonly logger = new Logger(InviteDeliveryService.name);

  constructor(private readonly email: EmailService) {}

  async sendSms(phone: string, message: string): Promise<void> {
    this.logger.warn(`[DEV INVITE] SMS to ${phone}: ${message}`);
  }

  async sendEmail(email: string, subject: string, body: string): Promise<void> {
    this.logger.warn(`[DEV INVITE] Email to ${email}: ${subject} — ${body}`);
    await this.email.send({ to: email, subject, text: body, html: emailLayout(`<p>${escapeHtml(body)}</p>`) });
  }
}
