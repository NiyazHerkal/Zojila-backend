import { applyDecorators } from '@nestjs/common';
import { IsStrongPassword, MaxLength } from 'class-validator';

export const PASSWORD_RULES_DESCRIPTION =
  '8–72 characters with at least one uppercase letter, one lowercase letter, one number and one symbol';

/**
 * Password strength policy (PDF §2.1 "password creation with strength validation"),
 * shared by signup and reset-password. Max 72 because bcrypt ignores bytes past that.
 */
export function IsPasswordPolicy() {
  return applyDecorators(
    IsStrongPassword(
      { minLength: 8, minLowercase: 1, minUppercase: 1, minNumbers: 1, minSymbols: 1 },
      { message: `Password must be ${PASSWORD_RULES_DESCRIPTION}` },
    ),
    MaxLength(72, { message: 'Password must be at most 72 characters' }),
  );
}
