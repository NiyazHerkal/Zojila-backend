# TravelGo backend: security checklist

**Status as of:** 2026-10-05 (Phase 12). **Sign-off needed from:** the project lead, before beta.

Each line is ✅ done (with where it's enforced), 🟡 partly done, or ❌ open. PDF §4 requirements are marked **[PDF]**.

## Access control
- ✅ **[PDF] Group data only for members.** Every `/groups/:groupId/…` route goes through `GroupMemberGuard` (`src/groups/guards/`). Non-members get `404`, so group ids can't be probed. Role rules (Admin vs Viewer) via `@GroupRoles()`, `403` otherwise.
- ✅ Sockets: the JWT is checked in the handshake. Group events go only to **current** members, looked up at send time, so removal takes effect at once.
- ✅ Chat send/read, alerts, expenses, receipts, location and the offline bundle all re-check membership. Covered by the e2e suites (`test/*.e2e-spec.ts`, 102 tests).
- ✅ Edit rights inside a group: expenses (whoever recorded it, or an admin), repayments, SOS resolve (sender or admin), itinerary draft (admins).
- ✅ Closed trips are read-only (`409`) in the guard, in chat and in invite acceptance.

## Authentication and sessions
- ✅ Passwords: bcrypt (cost 10), policy of 8–72 characters with upper, lower, number and symbol.
- ✅ Access tokens last 15 min. Refresh tokens are single-use and rotated, stored as SHA-256 hashes, and revoked on logout and password reset.
- ✅ OTP / reset codes: hashed, expire in 10 / 15 min, 5 wrong guesses cancel the code, at most one send per 60 s.
- ✅ No account enumeration on OTP request, forgot-password and resend (always the same answer).
- 🟡 After logout, password reset or account deletion, an **access token stays valid for up to 15 min** (no denylist). Group routes still refuse it after deletion (no memberships left), and so do `/auth/me` routes. Acceptable for now; add a denylist if needed.
- ✅ **[PDF] Secure on-device token storage**: the app must use `flutter_secure_storage` (documented in `API_DOCUMENTATION.md` §3.1). App-side, to verify in app QA.

## Abuse protection
- ✅ **Rate limits per IP** (`@nestjs/throttler`, `src/security/rate-limit.ts`): 5/min for endpoints that send SMS/email, 10/min for code entry and signup, 20/min for login, 120/min elsewhere. `429` with `Retry-After`.
- ✅ SOS is deliberately **never** rate-limited.
- ✅ Chat over the socket: 20 messages / 10 s per user.
- ✅ Real client IPs behind a proxy: `TRUST_PROXY` (default: trust only proxies on the same machine, e.g. ngrok).
- 🟡 Limits are kept in memory, so they're per server. With several API servers, move them to Redis (`ThrottlerStorageRedisService`).
- ✅ Upload limits: receipts, cover images and profile pictures max 5 MB, voice 2 MB, type checked from the file's bytes, not its name. JSON bodies max 100 kB (Express default).

## Transport and headers
- ❌ **[PDF] TLS for all API traffic**: the dev server is plain HTTP (ngrok gives HTTPS in front). **Production must terminate TLS** at the load balancer or proxy, and the app must use `https://` only. HSTS is already sent.
- ✅ Security headers via `helmet`: HSTS, `X-Content-Type-Options: nosniff`, `X-Frame-Options`, `Referrer-Policy: no-referrer`; `X-Powered-By` removed.
- 🟡 CORS is open (`*`). Fine for a mobile app (no cookies). Restrict it if a web client is added.

## Data protection
- 🟡 **[PDF] Encrypt sensitive data at rest.** Passwords, codes and refresh tokens are hashed. **Not yet:** the database disk, Redis (live positions) and receipt files. In production, use a managed Postgres with encrypted storage, Redis with TLS and encryption, and object storage with server-side encryption.
- ✅ No location history is stored: only the latest position while sharing, deleted when sharing ends.
- ✅ Other members' email and phone are never returned by the API.
- 🟡 **Profile pictures are public by URL** (`GET /users/:userId/avatar`, no token, added 2026-10-14) so image widgets and the live-share web page can load them. The URL carries a random uuid (`?v=`), so it can't be guessed, but anyone it's forwarded to can open it. Switch the route to `JwtAuthGuard` if the lead wants them private (the live-share page would then show initials). Cover images, receipts and voice stay members-only.
- 🟡 Uploaded images (cover, profile) are stored as sent: no server-side re-encode, so EXIF (e.g. GPS) is kept unless the app re-encodes before upload, as `API_DOCUMENTATION.md` asks.
- ✅ CSV export is protected against formula injection.
- ✅ Error reports (Sentry) carry no request bodies, headers, cookies, query strings or user info (`src/security/sentry.ts`).

## Privacy / GDPR **[PDF]**
- ✅ Data export: `GET /auth/me/export`.
- ✅ Account deletion: `DELETE /auth/me` (password required). Personal data is scrubbed, the user leaves every group, and admin rights are handed over.
- ✅ Group data deleted on closure: `POST /groups/:id/close`, deleted 30 days later by the retention job.
- ✅ Retention job (`src/privacy/retention.service.ts`, hourly): closed trips, accounts never verified after 7 days, invites expired over 30 days ago.
- ❌ Privacy policy and permission justifications: **drafts** in `docs/PRIVACY_POLICY_DRAFT.md` and `docs/PERMISSIONS_JUSTIFICATION.md`, waiting on legal review.

## Configuration and secrets
- ✅ The server **refuses to start in production** with missing, short, identical or example JWT secrets, or with rate limits disabled (`src/security/production-checks.ts`).
- ❌ Generate real secrets for staging and production. The dev `.env` still uses the example ones.
- ✅ `.env`, `secrets/` and service-account files are git-ignored. The Brevo key lives only in `.env`.
- ✅ Schema managed by **migrations** only (`src/database/migrations/`), applied at start-up; `synchronize` removed (2026-10-05).
- ✅ Team-only `/ops/*` routes need `X-Ops-Key` (compared in constant time) and return 404 when `OPS_API_KEY` isn't set; production requires ≥ 32 characters.

## Dependencies
- 🟡 `npm audit --omit=dev` (2026-10-05): 0 critical, 0 high, **8 moderate**, all via `firebase-admin` → an old `uuid` (a bounds-check issue in a function this code doesn't call). The fix is `firebase-admin` 14 (a major upgrade). Do it when the Firebase key arrives, so push can be tested on the new version.

## Monitoring
- 🟡 Crash and error reporting with Sentry is wired up; it's off until `SENTRY_DSN` is set.
- ❌ Uptime monitoring and alerting (Phase 13).

## Still to do before launch
1. TLS in production; real secrets.
2. Encryption at rest (managed DB, Redis TLS, bucket encryption) and object storage for receipts.
3. A Sentry DSN, uptime alerts.
4. `firebase-admin` 14.
5. Legal review of the privacy policy and permission texts.
6. An external penetration test or review, if the budget allows.
