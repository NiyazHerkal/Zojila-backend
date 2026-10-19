import * as Sentry from '@sentry/nestjs';

/**
 * Crash / error reporting (PDF §4 reliability, build plan Phase 12) with Sentry. Off until
 * SENTRY_DSN is set. Only unexpected errors (5xx and crashes) are reported, never 4xx. No
 * request data is sent (no bodies, headers, cookies, query strings or user info): see below.
 */
export function initSentry(env: NodeJS.ProcessEnv = process.env): boolean {
  const dsn = env.SENTRY_DSN?.trim();
  if (!dsn) return false;
  Sentry.init({
    dsn,
    environment: env.SENTRY_ENVIRONMENT?.trim() || env.NODE_ENV || 'development',
    release: env.SENTRY_RELEASE?.trim() || undefined,
    // Sentry collects request data by default. Turn it all off: bodies can hold passwords, codes
    // and locations; headers hold tokens; user info and query strings can identify people.
    dataCollection: { userInfo: false, cookies: false, httpHeaders: false, httpBodies: [], urlQueryParams: false },
    tracesSampleRate: Number(env.SENTRY_TRACES_SAMPLE_RATE) || 0,
  });
  return true;
}

/** For errors caught outside the HTTP filter (socket handlers, background jobs). */
export function reportError(err: unknown, context?: string): void {
  Sentry.captureException(err, context ? { tags: { context } } : undefined);
}
