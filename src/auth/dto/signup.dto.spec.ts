import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { SignupDto } from './signup.dto.js';

const signup = (contacts: Record<string, unknown>) => plainToInstance(SignupDto, {
  username: 'rider', name: 'Rider', password: 'Str0ng!Pass', ...contacts,
});

describe('signup contact validation', () => {
  it.each([undefined, null, '', '   '])('accepts an email-only signup with absent phone %j', async (phone) => {
    expect(await validate(signup({ email: 'rider@example.com', phone }))).toEqual([]);
  });

  it.each([undefined, null, '', '   '])('accepts a phone-only signup with absent email %j', async (email) => {
    expect(await validate(signup({ email, phone: '+919876543210' }))).toEqual([]);
  });

  it.each([
    { email: '', phone: '   ' },
    { email: 'invalid', phone: '+919876543210' },
    { email: 'rider@example.com', phone: 'invalid' },
  ])('rejects missing or malformed supplied contacts: %j', async (contacts) => {
    expect((await validate(signup(contacts))).length).toBeGreaterThan(0);
  });
});
