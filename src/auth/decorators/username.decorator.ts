import { applyDecorators } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsString, Matches } from 'class-validator';

export const USERNAME_RULES_DESCRIPTION =
  '3–30 characters: lowercase letters, numbers, "." and "_", starting and ending with a letter or number. Case-insensitive.';

/**
 * Username policy, shared by signup, profile update and "add member by username" (PDF §2.2).
 * Trimmed + lowercased first so `Jordan_R` and `jordan_r` are the same handle. No `@` or `+`
 * allowed, so a username can never be mistaken for an email or phone in the login identifier.
 */
export function IsUsernamePolicy() {
  return applyDecorators(
    Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toLowerCase() : value)),
    IsString(),
    Matches(/^[a-z0-9][a-z0-9._]{1,28}[a-z0-9]$/, { message: `Username must be ${USERNAME_RULES_DESCRIPTION}` }),
  );
}
