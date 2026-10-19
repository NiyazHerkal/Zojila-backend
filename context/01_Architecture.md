# TravelGo Backend — Architecture

Source requirements: `../TravelGo_Implementation_Plan.pdf` (Sections 2–5 for scope, Section 3–4 for architecture/NFRs), **amended by** `../TRAVELG0.pdf` (Technical Change Request v1.0, 2026-10-01: 10 changes, see `02_Build_Plan.md` "Change Request v1.0"). **The two PDFs are the source of truth** (the change request wins where they differ) — this doc describes how the backend implements them; where the code differs, the difference is called out and logged in `03_Progress_Tracker.md`.

## 1. Stack decision

**Node.js + TypeScript on NestJS + PostgreSQL (TypeORM) + Redis**, deployed on a managed platform (AWS/GCP with RDS + ElastiCache, or Fly.io/Render for lower ops overhead).

Why this over the alternatives:
- **vs. Go**: Go wins on raw concurrency for the location/chat fan-out path, but costs more boilerplate on the CRUD-heavy modules (groups, itinerary, expenses) — not worth a polyglot split for a 2-person backend team at MVP scale.
- **vs. Firebase/Supabase (BaaS)**: fastest to MVP, and matches the PRD's "cloud backend with real-time sync" wording, but the expense-splitting engine, PDF export, and offline-conflict resolution still need custom logic, and you inherit vendor lock-in + Firestore's query-model limits for reporting later.
- Single language across REST, WebSocket gateways, and background jobs keeps a small team fast; NestJS's module system gives domain separation (see below) without a full microservices split.
- **ORM — TypeORM over Prisma**: switched from an initial Prisma pick to **TypeORM**, since that's what the team already has hands-on experience with — familiarity with the Repository pattern, decorators, and migration workflow outweighs Prisma's DX edge at this team size. (Logged in `03_Progress_Tracker.md` decisions log, 2026-09-23.)

**Deviation from the PDF — needs management sign-off (Phase 1):** PDF §3.1 specifies a "cloud-based backend with real-time sync", which reads as a BaaS. We implement the same capability (real-time sync via WebSocket gateways + Redis pub/sub, cloud object storage for images/PDFs) on a custom NestJS backend instead, for the reasons above.

Revisit this decision only if: location/chat traffic grows well past MVP group sizes, or the team gains Go expertise that changes the calculus.

## 2. Services (NestJS modules, monolith-first)

| Module | Responsibility |
|---|---|
| Auth | Signup/verification (email/SMS OTP), login, JWT access + refresh tokens, password reset. `AvatarService` stores profile pictures (`avatars/<userId>/<uuid>.<ext>` in `StorageService`) |
| Profile | `src/profile/` (2026-10-14): `PATCH /auth/me` and the profile picture routes (`POST`/`DELETE /auth/me/avatar`, public `GET /users/:userId/avatar`). Announces `user:profile_updated` to co-members. Separate from Auth because Realtime imports Auth (an Auth → Realtime import would be a cycle) |
| Groups | Group CRUD, invite links (signed/expiring tokens), SMS/email dispatch, accept/reject, role mgmt (any number of admins, ≥1 always). Live member events (`member:joined` / `member:removed` / `member:role_changed`) via `GroupEventsService`. `GroupsModule` ↔ `RealtimeModule` import each other (`forwardRef`) |
| Itinerary | Chatbot-flow state machine, pin-drop CRUD + reorder, per-location attribute enrichment, finalize/lock, versioning |
| Enrichment | Third-party per-stop data behind swappable providers (`src/enrichment/`): elevation (Open-Meteo) + oxygen context, weather (MET Norway Locationforecast, no key, cached per location until its `Expires`), OSM map tiles for the PDF route map, road routes between stops (OSRM, `RoutingProvider`, `ROUTING_URL`; straight-line fallback per leg). Best-effort |
| PDF Export | Renders a finalized itinerary + map + attributes to PDF. Currently synchronous per request (`pdfkit`). Target: BullMQ job → object storage → signed URL once Redis/storage exist |
| Location | Per-group sharing sessions (Postgres) + live positions (Redis), HTTP ingest (single/batch, per group or `POST /location` for all of a user's groups and live links) → `location:updated` via Realtime, BullMQ expiry jobs + sweep, map feed |
| Chat & SOS | `src/chat/`: `ChatGateway` (socket `chat:send` for text and location / `chat:typing` / `chat:read`, replies via ack), voice messages uploaded over HTTP (AAC/M4A/Ogg, ≤ 2 MB / 2 min, in `StorageService` under `voice/<groupId>/`), no image/file/video messages (CR v1.0 change 8), history + search + read markers over HTTP, alerts (GENERAL / CRITICAL admin-only, SOS any member) over HTTP with acks + resolve, pushes (chat → offline members only; alerts → everyone) |
| Realtime | socket.io gateway (`src/realtime/`): JWT handshake, per-user rooms, `emitToGroup()` to current members, presence (online = ≥1 socket, offline after a 5 s grace, `users.last_seen_at`). Other gateways (chat) share the same server via `SocketServerRef`. Single instance now; Redis adapter when scaling out |
| Status | Status broadcast (`status:updated` via Realtime) + append-only history log |
| Expense | Expense CRUD + receipt upload, per-expense participants (split engine equal/custom) and one or several payers, settlement calc, export. Live `expense:created/updated/deleted` + `expense:settlement_*` |
| Notification | FCM push (HTTP v1, service account; iOS via APNs-in-Firebase) + device registration. Logs `[DEV PUSH]` when unconfigured. `sendToUsers()` fans out to many users in one query. Used by location expiry, chat, alerts/SOS, NEED_HELP status |
| Sync/Offline | Reconciles client-queued writes on reconnect (last-write-wins + admin-authoritative conflict rule for itinerary) |
| Activities | `src/activities/` (CR v1.0 changes 3–4): status UPCOMING/CURRENT/COMPLETED per stop of the latest finalized itinerary (admins, one CURRENT at a time) and text updates (any member; author edits; author or admin deletes). Keyed by the waypoint's `stop_key` (API: `activityId`), copied into every new draft, so both survive re-finalizing. Live `activity:*` events |
| Places | `src/places/` (CR v1.0 change 1): nearby fuel stations / restaurants / garages from OSM via Overpass (`PlacesProvider` → `OverpassPlacesProvider`, `OVERPASS_URL`), Redis cache 10 min per ~100 m area (optional), distance-sorted. No DB table: no POI data is stored |
| Live location for loved ones | In `src/location/` (CR v1.0 change 10): `LiveShareService` + owner controller (`/location-share/sessions`), public recipient endpoint (`/public/live/:token`, no auth, throttled) and the `/live` socket namespace (`LiveShareGateway`, token handshake, separate from the JWT namespace). Fed by `POST /location`; latest position in Redis `travelgo:loc:user:<id>` (expires with the last link); expiry via the existing minutely sweep. The recipient web page is built by the frontend/web team |

## 3. Data model (high level)

The authoritative version is the entity classes in `src/database/entities/` — this is a summary; keep both in sync when either changes. Dev DB schema is auto-synced from entities (`synchronize: true` in non-production, see `src/database/database.module.ts`); switch to TypeORM migrations before there's real data worth keeping.

```
User(id, username (unique, lowercase), email, phone, password_hash, name, avatar_url, avatar_key, avatar_content_type, created_at, last_seen_at,
     email_verified, phone_verified, otp_code_hash, otp_expires_at, otp_purpose[signup_verification|login|password_reset], otp_attempts,
     password_reset_token_hash, password_reset_expires_at, password_reset_attempts, refresh_token_hash,
     deleted_at)   -- account deletion anonymises the row ("Deleted user") so shared history stays valid
Group(id, name, description, trip_start, trip_end, currency, cover_image_key, cover_image_content_type, created_by, created_at, closed_at, delete_after)   -- admin rights live in GroupMember.role; ≥1 admin always; closed = read-only, deleted at delete_after
GroupMember(group_id, user_id, role[admin|viewer], joined_at)
Invite(id, group_id, channel[link|sms|email], status[pending|accepted|rejected|revoked], token_hash (link only),
       invitee_email, invitee_phone, invitee_user_id, invited_by, expires_at, responded_at, created_at)
Itinerary(id, group_id, status[draft|locked], version (set on lock), based_on_version, revision (draft edit counter, If-Match), route_json (cached road route + key of the pins it was built from), created_by, locked_at, created_at)
     -- ≤1 draft per group; locked versions immutable (except elevation/weather refresh)
Waypoint(id, itinerary_id, stop_key (API activityId; same in every version, unique per itinerary), order (0 = start, last = end), name, lat, lng, date (YYYY-MM-DD), notes,
         elevation (m), weather_json {status, forecast?, availableFrom?, fetchedAt}, reviews_json (reserved, unused))
ActivityProgress(group_id, stop_key, status[upcoming|current|completed], updated_by, updated_at)   -- no row = upcoming; admins only
ActivityUpdate(id, group_id, stop_key, user_id, text ≤1000, client_id (unique per user), created_at, edited_at, deleted_at, deleted_by)   -- soft delete wipes text
WaypointDetail(id, waypoint_id, type[accommodation|activity|dining|event], payload_json)   -- unused: chatbot flow deferred
LocationShare(id, group_id, user_id, duration[1h|4h|8h|always], started_at, expires_at (null = always))
     -- one row per member per group while sharing; FK (group_id,user_id) → group_members ON DELETE CASCADE
     -- live positions: Redis hash travelgo:loc:<groupId> (userId → {lat,lng,accuracy,heading,speed,recordedAt}); no history
LocationPing(id, user_id, group_id, lat, lng, recorded_at)   -- UNUSED (live-only); reserved for a future trail feature
LocationShareLink(id, user_id, recipient_label, token_hash (unique, SHA-256), duration[15m|1h|8h], started_at, expires_at, ended_at, end_reason[stopped|expired], first_viewed_at, last_viewed_at)
     -- live location for people outside the app; max 5 active per user; rows deleted 30 days after they end
     -- the sharer's latest position: Redis key travelgo:loc:user:<userId> while ≥1 link is active; no history
DeviceToken(id, user_id, token (unique), platform[android|ios|web], created_at, updated_at)   -- FCM push targets
Message(id, group_id, sender_id, body, type[normal|general|critical|sos], kind[text|location|voice], category[weather|road_closure|safety|other] (critical only),
        client_msg_id (unique per sender), location jsonb {lat,lng,accuracy,recordedAt,source,label?} (sos + location messages),
        voice_key, voice_content_type, voice_duration_ms (voice messages),
        resolved_at, resolved_by, created_at timestamptz(3))   -- chat + alerts in one timeline
MessageAck(message_id, user_id, acked_at)   -- critical/sos acknowledgements
MessageRead(group_id, user_id, last_read_message_id, last_read_at)   -- one read marker per member (forward-only);
     -- FK (group_id,user_id) → group_members ON DELETE CASCADE; "read by N" is derived from these
StatusUpdate(id, user_id, group_id, status[arrived|stopped|need_help|in_transit], note, client_id, created_at timestamptz(3) = recordedAt)   -- append-only; current = latest per user
Expense(id, group_id, payer_id, created_by, amount decimal(12,2), category enum, spent_on date, description,
        split_type[equal|custom], client_id, receipt_key, receipt_content_type, created_at, updated_at timestamptz(3))
ExpenseSplit(expense_id, user_id, share_amount)   -- who shares it; always sums to amount exactly (computed in paise)
ExpensePayment(expense_id, user_id, amount)   -- who paid it (one or several); always sums to amount; expenses.payer_id = the main (largest) payer
ExpenseSettlement(id, group_id, from_user_id, to_user_id, amount, paid_on date, note, created_by, created_at)   -- repayments
Feedback(id, user_id, group_id?, category[bug|idea|other], message, rating, screen, app_version, platform, os_version, device_model,
         screenshot_key, status[new|in_progress|done|wont_fix], ops_note, created_at, updated_at)   -- beta feedback
UsageDaily(id, day, metric, user_id, group_id?, count)   -- daily usage counters for the KPIs; unique per (day, metric, user, group)
```

Schema changes go here first, then into a migration (`src/database/migrations/`, see the backend README): keep this block in sync with the actual DB. Since 2026-10-05 the schema is managed only by migrations, never `synchronize`.

**Known schema gaps vs. the PDF** (to add in the phase that needs them — not in the DB yet):
- `Waypoint` has no `transport_mode`: parked with the deferred chatbot flow, as is `WaypointDetail`.

### Change request v1.0 naming map

`TRAVELG0.pdf` sketches its own paths and names; it says it "does not invent API contracts", so the API keeps its existing conventions and this table maps them:

| Change request | This API |
|---|---|
| trip, `tripId` | group, `groupId` |
| MEMBER role | `VIEWER` |
| `memberId` | `userId` |
| `/api/...` prefix | no prefix |
| `/api/trips/{tripId}/...`, `/api/expenses/{id}` | `/groups/:groupId/...`, `/groups/:groupId/expenses/:expenseId` |
| activity | itinerary stop (waypoint) |
| `member:location_updated`, `group:members_locations` | `location:updated`, `GET /groups/:groupId/location` (map feed) |
| `POST /api/locations/share` | `POST /location` (all groups + live links) |
| `/api/location-share/sessions`, `GET …/sessions/{id}/location` | `/location-share/sessions`, `GET /public/live/:token` (the secret token, not the session id, authorizes the recipient) |
| `POST /api/location-share/recipients` | one link per recipient: create another session |
| `location_share:started`, `location:update`, `location_share:stopped` | same names (sharer's devices on the main socket; recipients on `/live`) |
| payload `latitude` / `longitude` | `lat` / `lng` (as everywhere else) |
| `chat:message_sent` | `chat:message` |
| `expense:created/updated/deleted`, `member:role_changed` | same names (adopted 2026-10-05) |

## 4. Cross-cutting concerns

- **Security**: JWT access + rotating refresh tokens; password strength policy on signup/reset (PDF §2.1); refresh tokens stored as SHA-256 hashes (not bcrypt — it truncates at 72 bytes, which every JWT for a user shares); emails normalized to lowercase; group-scoped authorization on every endpoint via `GroupMemberGuard` + `@GroupRoles()` (`src/groups/guards/`) — non-members get 404, under-privileged members 403; TLS everywhere; encrypt sensitive fields at rest (location history, receipts).
- **Reliability**: retry-with-backoff for outbound third-party calls (Maps, weather, SMS); circuit breakers around review/weather providers; crash/error tracking (Sentry) from Phase 2 onward.
- **Data privacy**: configurable retention job for location history; cascade-delete on group closure; GDPR export/delete endpoints.
- **Scaling**: Redis pub/sub lets the WebSocket gateway run multiple stateless instances behind a load balancer without sticky sessions.

## 5. Third-party dependencies

Procure before Phase 1 closes: Google Maps API key & billing, push notification service (FCM/APNs), SMS/email delivery provider, weather + elevation data API. Confirm TripAdvisor/Google review data access against current API terms during Phase 1.

## 6. Local development environment

- **Postgres**: native PostgreSQL 18 Windows service (`postgresql-x64-18`) on `localhost:5432` — Docker is not installed on the dev machine. DB/user `travelgo` / `travelgo`, matching `DATABASE_URL` in `.env.example`.
- **Docker (optional)**: `docker-compose.yml` still works for anyone with Docker (Postgres + Redis + a containerized API build).
- **Redis**: runs in WSL (Ubuntu-24.04), reachable at `localhost:6379` from Windows. Needed for live location (Phase 7). Start it with `wsl -d Ubuntu-24.04 -u root service redis-server start`. The API still runs without it; location endpoints return 503.
- **Verify**: `npm run start:dev` → `GET http://localhost:3000/health` returns `{"status":"ok","db":"connected"}`; Swagger at `/docs`.
