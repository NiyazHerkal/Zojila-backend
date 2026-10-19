import { Transform } from 'class-transformer';

/**
 * Trims and lowercases email input so `Rider@x.com` and `rider@x.com` are the same account.
 * Values without an `@` (e.g. a phone number in the login `identifier`) are only trimmed.
 */
export function NormalizeEmail() {
  return Transform(({ value }: { value: unknown }) => {
    if (typeof value !== 'string') return value;
    const trimmed = value.trim();
    return trimmed.includes('@') ? trimmed.toLowerCase() : trimmed;
  });
}
