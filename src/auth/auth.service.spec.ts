import 'reflect-metadata';
import { HttpException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import type { Repository } from 'typeorm';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { User } from '../database/entities/index.js';
import { codeOf, ErrorCode } from '../errors/error-codes.js';
import type { OtpDeliveryService } from '../notifications/otp-delivery.service.js';
import { AuthService } from './auth.service.js';
import type { AvatarService } from './avatar.service.js';

function errorCode(error: unknown) {
  if (!(error instanceof HttpException)) throw new Error('Expected an HTTP exception', { cause: error });
  return codeOf(error);
}

describe('login and self-profile contacts', () => {
  const password = 'Str0ng!Pass';
  const jwt = new JwtService();
  const config = new ConfigService({
    JWT_ACCESS_SECRET: 'unit-test-access-secret',
    JWT_REFRESH_SECRET: 'unit-test-refresh-secret',
  });
  let passwordHash: string;
  let user: User;
  let auth: AuthService;
  const users = { findOne: vi.fn(), update: vi.fn(), save: vi.fn(), create: vi.fn(), existsBy: vi.fn() };
  const delivery = { sendEmail: vi.fn(), sendSms: vi.fn() };
  const avatars = { put: vi.fn(), remove: vi.fn() };

  beforeAll(async () => {
    passwordHash = await bcrypt.hash(password, 4);
  });

  beforeEach(() => {
    vi.resetAllMocks();
    user = Object.assign(new User(), {
      id: '1ebaf3bb-fbe0-4a4b-b94a-a77071e92b0e',
      username: 'rider',
      name: 'Rider',
      email: 'rider@example.com',
      phone: null,
      avatarUrl: null,
      emailVerified: true,
      phoneVerified: false,
      deletedAt: null,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      passwordHash,
    });
    users.findOne.mockImplementation(async () => user);
    users.save.mockImplementation(async (value: User) => value);
    avatars.put.mockImplementation(async (value: User) => value);
    avatars.remove.mockResolvedValue(false);
    auth = new AuthService(
      users as unknown as Repository<User>,
      jwt,
      config,
      delivery as unknown as OtpDeliveryService,
      avatars as unknown as AvatarService,
    );
  });

  it.each([undefined, null, '', '   '])('stores an absent signup phone (%j) as NULL', async (phone) => {
    users.findOne.mockResolvedValue(null);
    users.existsBy.mockResolvedValue(false);
    users.create.mockImplementation((value) => Object.assign(new User(), value, { id: user.id }));
    await auth.signup({ email: ' Rider@Example.com ', phone: phone as string | undefined,
      username: 'rider', name: 'Rider', password });
    expect(users.create).toHaveBeenCalledWith(expect.objectContaining({ email: 'rider@example.com', phone: null }));
    expect(delivery.sendEmail).toHaveBeenCalledWith('rider@example.com', expect.stringMatching(/^\d{6}$/));
    expect(delivery.sendSms).not.toHaveBeenCalled();
  });

  it('stores an absent signup email as NULL for phone-only accounts', async () => {
    users.findOne.mockResolvedValue(null);
    users.existsBy.mockResolvedValue(false);
    users.create.mockImplementation((value) => Object.assign(new User(), value, { id: user.id }));
    await auth.signup({ email: '   ', phone: '+919876543210', username: 'rider', name: 'Rider', password });
    expect(users.create).toHaveBeenCalledWith(expect.objectContaining({ email: null, phone: '+919876543210' }));
    expect(delivery.sendEmail).not.toHaveBeenCalled();
    expect(delivery.sendSms).toHaveBeenCalledWith('+919876543210', expect.stringMatching(/^\d{6}$/));
  });

  it('rejects signup with only blank contacts before saving', async () => {
    await expect(auth.signup({ email: ' ', phone: '', username: 'rider', name: 'Rider', password }))
      .rejects.toThrow('email or phone is required');
    expect(users.create).not.toHaveBeenCalled();
  });

  it.each(['email-only', 'phone-only', 'both contacts', 'legacy empty phone'])(
    'logs in and returns safe profile contacts for %s accounts',
    async (kind) => {
      if (kind === 'phone-only') {
        Object.assign(user, { email: null, phone: '+919876543210', emailVerified: false, phoneVerified: true });
      } else if (kind === 'both contacts') {
        user.phone = '+919876543210';
      } else if (kind === 'legacy empty phone') {
        user.phone = '';
      }
      const storedEmail = user.email;
      const storedPhone = user.phone;
      const tokens = await auth.login({ identifier: user.email || user.phone!, password });
      const payload = await jwt.verifyAsync(tokens.accessToken, { secret: config.getOrThrow('JWT_ACCESS_SECRET') });
      expect(payload.sub).toBe(user.id);
      expect(tokens.refreshToken).toBeTruthy();
      expect(users.update).toHaveBeenCalledWith(user.id, { refreshTokenHash: expect.stringMatching(/^[a-f0-9]{64}$/) });
      const profile = await auth.getProfile(payload.sub);
      expect(profile).toEqual({
        id: user.id, username: user.username, name: user.name,
        email: storedEmail ?? '', phone: storedPhone ?? '', avatarUrl: null,
        emailVerified: user.emailVerified, phoneVerified: user.phoneVerified, createdAt: user.createdAt,
      });
      expect(user.email).toBe(storedEmail);
      expect(user.phone).toBe(storedPhone);
    },
  );

  it('keeps missing contacts consistent after editing a profile or changing an avatar', async () => {
    const edited = await auth.updateProfile(user.id, { name: 'Renamed' });
    const uploaded = await auth.putAvatar(user.id, undefined);
    const removed = await auth.removeAvatar(user.id);
    for (const result of [edited, uploaded, removed]) {
      expect(result.profile.phone).toBe('');
      expect(result.profile.email).toBe(user.email);
      expect(result.profile).not.toHaveProperty('passwordHash');
      expect(result.profile).not.toHaveProperty('refreshTokenHash');
    }
    expect(user.phone).toBeNull();
  });

  it.each(['', '   ', '\t\n'])('rejects a blank identifier before looking up legacy empty fields (%j)', async (identifier) => {
    user.phone = '';
    const error = await auth.login({ identifier, password }).catch((err: unknown) => err);
    expect(errorCode(error)).toBe(ErrorCode.INVALID_CREDENTIALS);
    expect(users.findOne).not.toHaveBeenCalled();
    expect(users.update).not.toHaveBeenCalled();
  });

  it('still rejects wrong passwords and unverified accounts', async () => {
    const wrong = await auth.login({ identifier: user.email!, password: 'wrong' }).catch((err: unknown) => err);
    expect(errorCode(wrong)).toBe(ErrorCode.INVALID_CREDENTIALS);
    user.emailVerified = false;
    const unverified = await auth.login({ identifier: user.email!, password }).catch((err: unknown) => err);
    expect(errorCode(unverified)).toBe(ErrorCode.ACCOUNT_NOT_VERIFIED);
    expect(users.update).not.toHaveBeenCalled();
  });
});
