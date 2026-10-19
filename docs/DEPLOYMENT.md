# Deploying the TravelGo backend (staging / closed beta)

**For:** whoever sets up the beta server. It works on any host that runs a Docker container (a VM, AWS ECS/Lightsail, GCP Cloud Run, Azure Container Apps, Render, Railway, Fly.io…). **Which host to use hasn't been decided yet**; the steps below are the same everywhere.

## What you need

| Piece | Notes |
|---|---|
| **The API container** | Built from `backend/Dockerfile` (`docker build -t travelgo-api backend/`). Listens on `PORT` (3000). Runs as a non-root user. |
| **PostgreSQL 15+** | A managed database with **daily backups** and encryption at rest. The app creates and updates the schema itself (migrations). |
| **Redis 6+** | For live location and timers. Managed if possible, with TLS (`rediss://` in `REDIS_URL`). |
| **HTTPS in front** | A load balancer or reverse proxy that terminates TLS (the PDF requires TLS for all API traffic). The app sends HSTS. Point the app's base URL at `https://…` only. |
| **A persistent disk for uploads** | Mounted at `/app/uploads` (`UPLOAD_DIR`). Receipts, voice messages, trip cover images, profile pictures and feedback screenshots live here until object storage replaces it. **Without a volume they're deleted on every redeploy.** Run **one** API instance while uploads are on local disk. |

## Environment variables

Copy `.env.example` and set at least:

| Variable | Value |
|---|---|
| `NODE_ENV` | `production` |
| `DATABASE_URL` | `postgresql://user:pass@host:5432/travelgo` |
| `REDIS_URL` | `rediss://…` (or `redis://`) |
| `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` | **New, different** random values, ≥ 32 characters each: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`. The server refuses to start with the example ones. |
| `TRUST_PROXY` | How many proxies sit in front, usually `1`. Needed for correct per-IP rate limits. |
| `BREVO_API_KEY`, `EMAIL_FROM_ADDRESS`, `EMAIL_FROM_NAME` | Email. The sender must be verified in Brevo; authenticate the domain (SPF/DKIM) to stay out of spam. |
| `FIREBASE_SERVICE_ACCOUNT_JSON` (or `_FILE`) | Push notifications (`docs/FIREBASE_SETUP.md`). |
| `INVITE_LINK_BASE_URL` | The app's deep-link domain. |
| `LIVE_SHARE_LINK_BASE_URL` | Where the web team hosts the live-location recipient page (links are `<base>/<token>`). Optionally `LIVE_SHARE_MAX_ACTIVE` (default 5). |
| `OPS_API_KEY` | ≥ 32 random characters. Enables the team's `/ops/*` endpoints (beta metrics, feedback). |
| `FEEDBACK_EMAIL` | Comma-separated addresses that receive in-app feedback. |
| `SENTRY_DSN`, `SENTRY_ENVIRONMENT` (`staging`), `APP_VERSION` (git tag or build number) | Error reporting and release tracking. `APP_VERSION` also shows in `/health`. |
| `OVERPASS_URL` | Nearby places (fuel / restaurants / garages). Use a hosted or own Overpass instance: the public one rate-limits after a few quick requests. |
| `PUBLIC_API_URL` | The API's public `https://` base URL. Cover image and profile picture URLs are built from it, so phones must be able to reach it. |
| `ROUTING_URL`, `ROUTING_PROFILE` | Road routes for the trip map: a self-hosted or hosted OSRM server (the default public demo server is for development only). `ROUTING_PROFILE` defaults to `driving`. `off` = straight lines between stops. |
| `MAP_TILE_URL`, `MAP_TILE_ATTRIBUTION` | Use a hosted tile provider, not the public OSM server. (Weather comes from MET Norway and needs no key; the server must be able to reach `api.met.no`.) |

Leave `RATE_LIMIT_DISABLED` unset (the server refuses `true` in production).

## Deploying a new version
1. Build and push the image, tagged with the version.
2. Start the new container. **Pending database migrations run automatically at start-up**, before it accepts requests (`DB_MIGRATIONS_RUN`, default `true`).
3. Watch `GET /health` until it returns `200` `{"status":"ok"}`.

Migrations are written so a crash halfway leaves the database consistent (each one runs in its own transaction). With more than one API instance, run migrations as a separate one-off step (`node node_modules/typeorm/cli.js migration:run -d dist/database/cli-data-source.js`) and set `DB_MIGRATIONS_RUN=false` on the instances.

**Rolling back:** redeploy the previous image. If the new version added a migration that the old code can't work with, first run `migration:revert` (with the **new** image) once per migration to undo. **Take a database backup before every deploy that contains a migration.**

## Monitoring
- **Uptime:** point an uptime monitor (UptimeRobot, Better Stack, your cloud's monitor…) at `https://<api>/health` every minute. Alert on non-200 (`503` = database down). `status: "degraded"` with `redis: "unreachable"` means live location is off; alert on that too.
- **Errors:** Sentry, once `SENTRY_DSN` is set. The app should report its own crashes (Sentry/Crashlytics in the app) for the "crash-free sessions" KPI.
- **Beta metrics and feedback:** the `/ops/*` endpoints with the `X-Ops-Key` header (see `BETA_TEST_PLAN.md`).
- **Logs:** the container logs to stdout. Keep at least 14 days.

## Backups and data
- Daily automatic database backups, kept ≥ 7 days; test a restore once before the beta.
- Back up the uploads volume too (or move receipts to object storage first).
- The hourly retention job deletes closed trips after 30 days, never-verified accounts after 7, old invites, usage counts after 180 days and feedback after 365 (`.env.example`).

## Before inviting beta testers
- [ ] HTTPS works, and the app's base URL is `https://…`
- [ ] Real JWT secrets, `OPS_API_KEY`, `NODE_ENV=production`
- [ ] Brevo domain authenticated; Firebase key set; push tested on a real phone
- [ ] Uploads volume mounted and backed up
- [ ] Database backups on, and one restore tested
- [ ] Uptime monitor and Sentry alerts reach someone
- [ ] A load test on staging-sized hardware still meets the targets (`npm run test:load` currently starts its own in-process server; pointing it at a remote URL is a follow-up)
