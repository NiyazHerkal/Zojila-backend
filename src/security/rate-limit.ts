import { ExecutionContext, Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

/** Per-IP request limits (PDF §4 security). Values are requests per minute. */
export const RATE_LIMITS = {
  default: 120,
  usernameCheck: 60,
  signup: 10,
  login: 20,
  codeEntry: 10, // verify, otp/login, reset-password: guessing codes is the risk
  codeSend: 5, // otp/request, forgot-password, resend-verification: each one sends an SMS/email
  refresh: 30,
  // SOS deliberately has no stricter limit: an emergency must never be refused (repeat taps
  // already return the same active SOS).
  alerts: 20,
  upload: 30,
  accountDeletion: 5,
  feedback: 10,
  liveShareView: 30, // a recipient's page polls every 10 s (6/min); several viewers can share an IP
  places: 30, // each call may reach OpenStreetMap's public Overpass server
  placeSearch: 20, // search on submit, not per keystroke; the public Nominatim allows 1 req/s in total
  routes: 60, // Journey map: one batch per member move (~50 m); pairs are cached ~5 min
} as const;

export const MINUTE_MS = 60_000;

/** `@Throttle(perMinute(n))` → n requests per minute per IP for that route. */
export function perMinute(limit: number) {
  return { default: { limit, ttl: MINUTE_MS } };
}

/**
 * The stock ThrottlerGuard reads an HTTP request; as a global guard it would also run for
 * socket events and fail there. Sockets are limited separately (see SlidingWindowLimiter).
 * Set RATE_LIMIT_DISABLED=true to switch limits off (tests, load tests).
 */
@Injectable()
export class HttpThrottlerGuard extends ThrottlerGuard {
  override async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http' || process.env.RATE_LIMIT_DISABLED === 'true') return true;
    return super.canActivate(context);
  }
}

/**
 * In-memory "at most N events per window" per key (e.g. chat messages per user). Single
 * instance only, like the rest of the socket layer; use Redis if the API runs on several servers.
 */
export class SlidingWindowLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  /** Records a hit and returns false if the key is over its limit. */
  allow(key: string, now = Date.now()): boolean {
    if (process.env.RATE_LIMIT_DISABLED === 'true') return true;
    const recent = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (recent.length >= this.limit) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(now);
    this.hits.set(key, recent);
    if (this.hits.size > 10_000) this.prune(now);
    return true;
  }

  private prune(now: number): void {
    for (const [key, times] of this.hits) {
      if (times.every((t) => now - t >= this.windowMs)) this.hits.delete(key);
    }
  }
}
