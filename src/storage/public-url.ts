import type { ConfigService } from '@nestjs/config';

/** Where clients reach this API (PUBLIC_API_URL), used to build absolute file URLs. No trailing slash. */
export function publicApiUrl(config: ConfigService): string {
  return (
    config.get<string>('PUBLIC_API_URL')?.trim() || `http://localhost:${config.get<string>('PORT') ?? 3000}`
  ).replace(/\/+$/, '');
}
