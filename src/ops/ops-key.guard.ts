import { createHash, timingSafeEqual } from 'node:crypto';
import { CanActivate, ExecutionContext, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Team-only routes (/ops/*): beta metrics and feedback triage. Needs the `X-Ops-Key` header to
 * match OPS_API_KEY. Without OPS_API_KEY the routes answer 404, as if they didn't exist.
 */
@Injectable()
export class OpsKeyGuard implements CanActivate {
  private readonly key: Buffer | null;

  constructor(config: ConfigService) {
    const key = config.get<string>('OPS_API_KEY')?.trim();
    this.key = key ? digest(key) : null;
  }

  canActivate(ctx: ExecutionContext): boolean {
    if (!this.key) throw new NotFoundException();
    const sent = ctx.switchToHttp().getRequest<{ headers: Record<string, string | undefined> }>().headers['x-ops-key'];
    // Compare fixed-length digests in constant time, so the key can't be guessed by timing.
    if (!sent || !timingSafeEqual(digest(sent), this.key)) throw new UnauthorizedException('Invalid ops key');
    return true;
  }
}

function digest(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}
