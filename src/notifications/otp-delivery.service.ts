import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EmailService, emailLayout } from './email.service.js';

export type EmailCodePurpose = 'SIGNUP_VERIFICATION' | 'PASSWORD_RESET';

const EMAIL_COPY: Record<EmailCodePurpose, { subject: string; intro: string; minutes: number }> = {
  SIGNUP_VERIFICATION: { subject: 'Your TravelGo verification code', intro: 'Welcome to TravelGo! Use this code to verify your account:', minutes: 10 },
  PASSWORD_RESET: { subject: 'Reset your TravelGo password', intro: 'Use this code to reset your password:', minutes: 15 },
};

/**
 * Delivers one-time codes. Email goes through Brevo (EmailService). SMS is still a stub that
 * logs the code: no SMS vendor yet (Phase 1; Indian numbers also need DLT registration).
 *
 * Outside production the code is also logged as `[DEV OTP]`, so devs can test without
 * opening an inbox. Production never logs codes.
 */
@Injectable()
export class OtpDeliveryService {
  private readonly logger = new Logger(OtpDeliveryService.name);
  private readonly logCodes: boolean;

  constructor(
    private readonly email: EmailService,
    config: ConfigService,
  ) {
    this.logCodes = config.get<string>('NODE_ENV') !== 'production';
  }

  async sendSms(phone: string, code: string): Promise<void> {
    this.logger.warn(`[DEV OTP] SMS to ${phone}: ${code}`);
  }

  async sendEmail(email: string, code: string, purpose: EmailCodePurpose = 'SIGNUP_VERIFICATION'): Promise<void> {
    if (this.logCodes) this.logger.warn(`[DEV OTP] Email to ${email}: ${code}`);
    const copy = EMAIL_COPY[purpose];
    await this.email.send({
      to: email,
      subject: copy.subject,
      text: `${copy.intro} ${code}\n\nThe code expires in ${copy.minutes} minutes. Never share it with anyone.`,
      html: emailLayout(
        `<p>${copy.intro}</p>` +
          `<p style="font-size:32px;font-weight:bold;letter-spacing:6px;margin:16px 0">${code}</p>` +
          `<p>The code expires in ${copy.minutes} minutes. Never share it with anyone.</p>`,
      ),
    });
  }
}
