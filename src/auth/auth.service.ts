import { createHash, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService, type JwtSignOptions } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { FindOptionsWhere, Not, QueryFailedError, Repository } from 'typeorm';
import { OtpPurpose, User } from '../database/entities/index.js';
import { OtpDeliveryService } from '../notifications/otp-delivery.service.js';
import { AvatarService, type UploadedAvatar } from './avatar.service.js';
import type { ForgotPasswordDto } from './dto/forgot-password.dto.js';
import type { LoginDto } from './dto/login.dto.js';
import type { OtpLoginDto } from './dto/otp-login.dto.js';
import type { OtpRequestDto } from './dto/otp-request.dto.js';
import type { ResendVerificationDto } from './dto/resend-verification.dto.js';
import type { ResetPasswordDto } from './dto/reset-password.dto.js';
import type { SignupDto } from './dto/signup.dto.js';
import type { UpdateProfileDto } from './dto/update-profile.dto.js';
import type { VerifyDto } from './dto/verify.dto.js';
import { ErrorCode, withCode } from '../errors/error-codes.js';

const OTP_TTL_MINUTES = 10;
const PASSWORD_RESET_TTL_MINUTES = 15;
const BCRYPT_ROUNDS = 10;
// Brute-force guard: a code is cancelled after this many wrong guesses (a new one must be requested)…
const MAX_CODE_ATTEMPTS = 5;
// …and a new code can be sent at most once per this many seconds per account.
const RESEND_COOLDOWN_SECONDS = 60;

interface RefreshPayload {
  sub: string;
  rm?: boolean; // "remember me" — carried so refresh keeps the original session lifetime
}

interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly otpDelivery: OtpDeliveryService,
    private readonly avatars: AvatarService,
  ) {}

  async signup(dto: SignupDto) {
    if (!dto.email && !dto.phone) {
      throw new BadRequestException('email or phone is required');
    }

    const existing = await this.users.findOne({
      where: this.identifierWhere(dto.email, dto.phone),
    });
    if (existing) {
      throw withCode(new ConflictException('An account with this email/phone already exists'), ErrorCode.ACCOUNT_EXISTS);
    }
    if (await this.users.existsBy({ username: dto.username })) {
      throw withCode(new ConflictException('Username is already taken'), ErrorCode.USERNAME_TAKEN);
    }

    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);
    const user = await this.saveUnique(
      this.users.create({
        email: dto.email,
        phone: dto.phone,
        username: dto.username,
        passwordHash,
        name: dto.name,
      }),
      'An account with this email/phone/username already exists',
    );

    const code = await this.issueOtp(user.id, OtpPurpose.SIGNUP_VERIFICATION);
    if (dto.email) await this.otpDelivery.sendEmail(dto.email, code);
    if (dto.phone) await this.otpDelivery.sendSms(dto.phone, code);

    return { userId: user.id, message: 'Verification code sent' };
  }

  async verify(dto: VerifyDto): Promise<TokenPair> {
    const user = await this.users.findOne({
      where: dto.userId ? { id: dto.userId } : this.identifierWhere(dto.email, dto.phone),
    });
    if (!user) throw withCode(new BadRequestException('Invalid account or code'), ErrorCode.INVALID_CODE);

    await this.assertOtp(user, OtpPurpose.SIGNUP_VERIFICATION, dto.code);

    await this.users.update(user.id, {
      emailVerified: !!user.email,
      phoneVerified: !!user.phone,
      otpCodeHash: null,
      otpExpiresAt: null,
      otpPurpose: null,
    });

    return this.issueTokenPair(user.id, false);
  }

  /** New signup code for an unverified account (the first one was lost or expired). */
  async resendVerification(dto: ResendVerificationDto): Promise<{ message: string }> {
    if (!dto.email && !dto.phone) throw new BadRequestException('email or phone is required');
    const generic = { message: 'If an unverified account exists, a new code has been sent' };

    const user = await this.users.findOne({ where: this.identifierWhere(dto.email, dto.phone) });
    if (!user || user.emailVerified || user.phoneVerified || !this.otpCooldownPassed(user)) return generic;

    const code = await this.issueOtp(user.id, OtpPurpose.SIGNUP_VERIFICATION);
    if (dto.email) await this.otpDelivery.sendEmail(dto.email, code);
    else if (dto.phone) await this.otpDelivery.sendSms(dto.phone, code);
    return generic;
  }

  async login(dto: LoginDto): Promise<TokenPair> {
    const user = await this.users.findOne({
      where: [
        { email: dto.identifier },
        { phone: dto.identifier },
        { username: dto.identifier.toLowerCase() },
      ],
    });
    if (!user || !(await bcrypt.compare(dto.password, user.passwordHash))) {
      throw withCode(new UnauthorizedException('Invalid credentials'), ErrorCode.INVALID_CREDENTIALS);
    }
    if (!user.emailVerified && !user.phoneVerified) {
      throw withCode(new UnauthorizedException('Account not verified'), ErrorCode.ACCOUNT_NOT_VERIFIED);
    }

    return this.issueTokenPair(user.id, !!dto.rememberMe);
  }

  async requestOtpLogin(dto: OtpRequestDto): Promise<{ message: string }> {
    const user = await this.users.findOne({ where: { phone: dto.phone } });
    if (!user) {
      // Don't reveal account existence.
      return { message: 'If that phone number is registered, a code has been sent' };
    }
    if (this.otpCooldownPassed(user)) {
      const code = await this.issueOtp(user.id, OtpPurpose.LOGIN);
      await this.otpDelivery.sendSms(dto.phone, code);
    }
    return { message: 'If that phone number is registered, a code has been sent' };
  }

  async loginWithOtp(dto: OtpLoginDto): Promise<TokenPair> {
    const user = await this.users.findOne({ where: { phone: dto.phone } });
    if (!user) throw withCode(new UnauthorizedException('Invalid phone or code'), ErrorCode.INVALID_CODE);

    await this.assertOtp(user, OtpPurpose.LOGIN, dto.code);
    // The code went to this phone, so entering it proves the user owns it: that verifies the phone.
    await this.users.update(user.id, { otpCodeHash: null, otpExpiresAt: null, otpPurpose: null, phoneVerified: true });

    return this.issueTokenPair(user.id, false);
  }

  async refresh(refreshToken: string): Promise<TokenPair> {
    let payload: RefreshPayload;
    try {
      payload = await this.jwt.verifyAsync(refreshToken, {
        secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'),
      });
    } catch {
      throw withCode(new UnauthorizedException('Invalid or expired refresh token'), ErrorCode.REFRESH_TOKEN_INVALID);
    }

    const user = await this.users.findOne({ where: { id: payload.sub } });
    if (!user?.refreshTokenHash || !this.matchesRefreshHash(refreshToken, user.refreshTokenHash)) {
      throw withCode(new UnauthorizedException('Refresh token has been revoked'), ErrorCode.REFRESH_TOKEN_REVOKED);
    }

    return this.issueTokenPair(user.id, !!payload.rm);
  }

  async logout(userId: string): Promise<void> {
    await this.users.update(userId, { refreshTokenHash: null });
  }

  async forgotPassword(dto: ForgotPasswordDto): Promise<{ message: string }> {
    if (!dto.email && !dto.phone) throw new BadRequestException('email or phone is required');

    const user = await this.users.findOne({ where: this.identifierWhere(dto.email, dto.phone) });
    const generic = { message: 'If that account exists, a reset code has been sent' };
    if (!user) return generic;
    if (!this.cooldownPassed(user.passwordResetExpiresAt, PASSWORD_RESET_TTL_MINUTES)) return generic;

    const code = String(randomInt(100000, 1000000));
    const codeHash = await bcrypt.hash(code, BCRYPT_ROUNDS);
    await this.users.update(user.id, {
      passwordResetTokenHash: codeHash,
      passwordResetExpiresAt: new Date(Date.now() + PASSWORD_RESET_TTL_MINUTES * 60_000),
      passwordResetAttempts: 0,
    });

    if (dto.email) await this.otpDelivery.sendEmail(dto.email, code, 'PASSWORD_RESET');
    if (dto.phone) await this.otpDelivery.sendSms(dto.phone, code);

    return generic;
  }

  async resetPassword(dto: ResetPasswordDto): Promise<{ message: string }> {
    if (!dto.email && !dto.phone) throw new BadRequestException('email or phone is required');

    const user = await this.users.findOne({ where: this.identifierWhere(dto.email, dto.phone) });
    if (!user?.passwordResetTokenHash || !user.passwordResetExpiresAt || user.passwordResetExpiresAt < new Date()) {
      throw withCode(new BadRequestException('Invalid or expired reset code'), ErrorCode.INVALID_CODE);
    }
    if (!(await bcrypt.compare(dto.code, user.passwordResetTokenHash))) {
      const attempts = user.passwordResetAttempts + 1;
      if (attempts >= MAX_CODE_ATTEMPTS) {
        await this.users.update(user.id, {
          passwordResetTokenHash: null,
          passwordResetExpiresAt: null,
          passwordResetAttempts: 0,
        });
        throw this.tooManyAttempts();
      }
      await this.users.update(user.id, { passwordResetAttempts: attempts });
      throw withCode(new BadRequestException('Invalid or expired reset code'), ErrorCode.INVALID_CODE);
    }

    const passwordHash = await bcrypt.hash(dto.newPassword, BCRYPT_ROUNDS);
    await this.users.update(user.id, {
      passwordHash,
      passwordResetTokenHash: null,
      passwordResetExpiresAt: null,
      passwordResetAttempts: 0,
      refreshTokenHash: null, // force re-login everywhere after a password reset
    });

    return { message: 'Password updated' };
  }

  // An access token outlives account deletion by up to ~15 min; the profile routes refuse it.
  private async activeUser(userId: string): Promise<User> {
    const user = await this.users.findOne({ where: { id: userId } });
    if (!user || user.deletedAt) throw withCode(new UnauthorizedException('This account has been deleted'), ErrorCode.ACCOUNT_DELETED);
    return user;
  }

  async getProfile(userId: string) {
    const user = await this.activeUser(userId);
    return this.toPublicProfile(user);
  }

  /** `changed`: whether what other members see (username, name, picture) changed. */
  async updateProfile(userId: string, dto: UpdateProfileDto): Promise<ProfileChange> {
    const user = await this.activeUser(userId);
    const { username, name, avatarUrl } = user;
    if (dto.username !== undefined && dto.username !== user.username) {
      if (await this.users.existsBy({ username: dto.username, id: Not(userId) })) {
        throw withCode(new ConflictException('Username is already taken'), ErrorCode.USERNAME_TAKEN);
      }
      user.username = dto.username;
    }
    if (dto.name !== undefined) user.name = dto.name;
    if (dto.avatarUrl !== undefined && dto.avatarUrl !== user.avatarUrl) {
      await this.avatars.dropUploadedFile(user); // an external URL replaces an uploaded picture
      user.avatarUrl = dto.avatarUrl;
    }
    const saved = await this.saveUnique(user, 'Username is already taken');
    const changed = saved.username !== username || saved.name !== name || saved.avatarUrl !== avatarUrl;
    return { profile: this.toPublicProfile(saved), changed };
  }

  /** POST /auth/me/avatar: upload or replace the profile picture. */
  async putAvatar(userId: string, file: UploadedAvatar | undefined): Promise<ProfileChange> {
    const user = await this.avatars.put(await this.activeUser(userId), file);
    return { profile: this.toPublicProfile(user), changed: true };
  }

  /** DELETE /auth/me/avatar: back to initials. */
  async removeAvatar(userId: string): Promise<ProfileChange> {
    const user = await this.activeUser(userId);
    const changed = await this.avatars.remove(user);
    return { profile: this.toPublicProfile(user), changed };
  }

  async usernameAvailable(username: string) {
    return { username, available: !(await this.users.existsBy({ username })) };
  }

  // --- internals ---

  // The pre-checks above give friendly 409s; this catches the race where two requests claim the
  // same email/phone/username at once and the DB unique constraint is what stops the second.
  private async saveUnique(user: User, conflictMessage: string): Promise<User> {
    try {
      return await this.users.save(user);
    } catch (err) {
      if (err instanceof QueryFailedError && (err.driverError as { code?: string }).code === '23505') {
        const code = conflictMessage.startsWith('Username') ? ErrorCode.USERNAME_TAKEN : ErrorCode.ACCOUNT_EXISTS;
        throw withCode(new ConflictException(conflictMessage), code);
      }
      throw err;
    }
  }

  private identifierWhere(email?: string, phone?: string): FindOptionsWhere<User>[] {
    const conditions: FindOptionsWhere<User>[] = [];
    if (email) conditions.push({ email });
    if (phone) conditions.push({ phone });
    return conditions;
  }

  private async issueOtp(userId: string, purpose: OtpPurpose): Promise<string> {
    const code = String(randomInt(100000, 1000000));
    const otpCodeHash = await bcrypt.hash(code, BCRYPT_ROUNDS);
    await this.users.update(userId, {
      otpCodeHash,
      otpPurpose: purpose,
      otpExpiresAt: new Date(Date.now() + OTP_TTL_MINUTES * 60_000),
      otpAttempts: 0,
    });
    return code;
  }

  private otpCooldownPassed(user: Pick<User, 'otpExpiresAt'>): boolean {
    return this.cooldownPassed(user.otpExpiresAt, OTP_TTL_MINUTES);
  }

  // A code's send time = its expiry minus its TTL, so no separate "sent at" column is needed.
  private cooldownPassed(expiresAt: Date | null, ttlMinutes: number): boolean {
    if (!expiresAt) return true;
    const sentAt = expiresAt.getTime() - ttlMinutes * 60_000;
    return Date.now() - sentAt >= RESEND_COOLDOWN_SECONDS * 1000;
  }

  private tooManyAttempts(): HttpException {
    return withCode(
      new HttpException('Too many incorrect attempts. Request a new code.', HttpStatus.TOO_MANY_REQUESTS),
      ErrorCode.TOO_MANY_ATTEMPTS,
    );
  }

  private async assertOtp(
    user: Pick<User, 'id' | 'otpCodeHash' | 'otpExpiresAt' | 'otpPurpose' | 'otpAttempts'>,
    purpose: OtpPurpose,
    code: string,
  ): Promise<void> {
    if (user.otpPurpose !== purpose || !user.otpCodeHash || !user.otpExpiresAt || user.otpExpiresAt < new Date()) {
      throw withCode(new BadRequestException('Invalid or expired code'), ErrorCode.INVALID_CODE);
    }
    if (!(await bcrypt.compare(code, user.otpCodeHash))) {
      const attempts = user.otpAttempts + 1;
      if (attempts >= MAX_CODE_ATTEMPTS) {
        await this.users.update(user.id, { otpCodeHash: null, otpExpiresAt: null, otpPurpose: null, otpAttempts: 0 });
        throw this.tooManyAttempts();
      }
      await this.users.update(user.id, { otpAttempts: attempts });
      throw withCode(new BadRequestException('Invalid or expired code'), ErrorCode.INVALID_CODE);
    }
  }

  private async issueTokenPair(userId: string, rememberMe: boolean): Promise<TokenPair> {
    const accessExpiresIn = this.config.get<string>('JWT_ACCESS_EXPIRES_IN', '15m');
    const refreshExpiresIn = rememberMe
      ? '90d'
      : this.config.get<string>('JWT_REFRESH_EXPIRES_IN', '30d');

    const accessToken = await this.jwt.signAsync(
      { sub: userId },
      {
        secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
        expiresIn: accessExpiresIn as JwtSignOptions['expiresIn'],
      },
    );
    const refreshToken = await this.jwt.signAsync(
      { sub: userId, rm: rememberMe, jti: randomUUID() } satisfies RefreshPayload & { jti: string },
      {
        secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'),
        expiresIn: refreshExpiresIn as JwtSignOptions['expiresIn'],
      },
    );

    await this.users.update(userId, { refreshTokenHash: this.hashRefreshToken(refreshToken) });

    return { accessToken, refreshToken };
  }

  // SHA-256, not bcrypt: bcrypt only reads the first 72 bytes, and every JWT for a user shares
  // those (header + start of payload), so a rotated-out token would still match. Refresh tokens
  // are high-entropy, so a fast hash is safe here.
  private hashRefreshToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private matchesRefreshHash(token: string, storedHash: string): boolean {
    const candidate = Buffer.from(this.hashRefreshToken(token), 'hex');
    const stored = Buffer.from(storedHash, 'hex');
    return candidate.length === stored.length && timingSafeEqual(candidate, stored);
  }

  private toPublicProfile(user: User): PublicProfile {
    const { id, username, email, phone, name, avatarUrl, emailVerified, phoneVerified, createdAt } = user;
    return { id, username, email, phone, name, avatarUrl, emailVerified, phoneVerified, createdAt };
  }
}

export type PublicProfile = Pick<
  User,
  'id' | 'username' | 'email' | 'phone' | 'name' | 'avatarUrl' | 'emailVerified' | 'phoneVerified' | 'createdAt'
>;

export interface ProfileChange {
  profile: PublicProfile;
  changed: boolean;
}
