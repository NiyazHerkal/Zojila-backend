# TravelGo Backend — API Reference

Live, always-current API docs are generated from code via Swagger:

- **Local dev**: `http://localhost:3000/docs` (or `http://<your-LAN-IP>:3000/docs` for a phone on the same WiFi)
- Interactive — every endpoint can be tried directly from the browser, including authenticated ones (use "Authorize" with a Bearer access token from `/auth/login`)

For a readable, shareable guide with request/response examples, see [`../API_DOCUMENTATION.md`](../API_DOCUMENTATION.md) (keep it in sync when endpoints change). Real captured requests/responses (HTTP, socket and pushes) for every endpoint are in [`../API_RESPONSES.md`](../API_RESPONSES.md), regenerated with `npm run capture:api-responses` (last: 2026-10-08, 235 steps, incl. cover image). A ready-to-run request script is in [`../api-requests.http`](../api-requests.http).

This file is a quick index of what's built; the Swagger UI is the source of truth for exact request/response shapes.

## Auth (`/auth`) — Phase 3, done (2026-09-25)

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/auth/username-available?username=` | – | `{ username, available }` — for live validation on the signup form. |
| POST | `/auth/signup` | – | Register with username + email or phone + password. Sends a 6-digit verification code (emailed via Brevo; SMS codes are only logged to the server console, SMS not needed for now). |
| POST | `/auth/verify` | – | Confirm the signup code (by `userId`, `email` or `phone`). Returns `{ accessToken, refreshToken }`. |
| POST | `/auth/resend-verification` | – | New signup code for an unverified account (`email` or `phone`). At most once per 60 s. |
| POST | `/auth/login` | – | Log in with username/email/phone (`identifier`) + password. `rememberMe: true` issues a longer-lived refresh token. |
| POST | `/auth/otp/request` | – | Request a login OTP via SMS (phone-based login). |
| POST | `/auth/otp/login` | – | Log in with phone + OTP code. |
| POST | `/auth/refresh` | – | Exchange a refresh token for a new token pair (rotates the refresh token). |
| POST | `/auth/logout` | Bearer | Revokes the current refresh token. |
| POST | `/auth/forgot-password` | – | Request a password reset code via email/SMS. |
| POST | `/auth/reset-password` | – | Reset password using the emailed/texted code. |
| GET | `/auth/me` | Bearer | Get the current user's profile. |
| PATCH | `/auth/me` | Bearer | Update username/name/avatar. 409 if the username is taken. Sends `user:profile_updated` when something visible changed; an `avatarUrl` replaces (deletes) an uploaded picture. Served by `ProfileModule` since 2026-10-14. |
| POST | `/auth/me/avatar` | Bearer | Profile picture (added 2026-10-14). Multipart `file`: JPEG/PNG/WebP, ≤ 5 MB (checked by content). Sets `avatarUrl` to `/users/:id/avatar?v=<uuid>` (absolute, from `PUBLIC_API_URL`), so every existing `avatarUrl` field shows it. Returns the profile. |
| DELETE | `/auth/me/avatar` | Bearer | Remove the picture (uploaded or URL). Returns the profile. |
| GET | `/users/:userId/avatar` | – | The picture, **no auth** (unguessable `?v=` URL; image widgets and the live-share page load it directly), `Cache-Control: public, immutable`. 404 if none / account deleted. |

**Input rules** (enforced server-side — show them in the signup/reset UI):
- **Password**: 8–72 characters, with at least one uppercase letter, one lowercase letter, one number and one symbol. Applies to `signup` and `reset-password`.
- **Username**: required at signup. 3–30 characters: lowercase letters, numbers, `.` and `_`, starting and ending with a letter or number. Case-insensitive: stored and matched lowercase, so `Jordan_R` becomes `jordan_r`. Signup returns 409 "Username is already taken" if it's in use.
- **Email**: case-insensitive — stored and matched lowercase.
- **Phone**: E.164 format with country code, e.g. `+919876543210`. Fictional numbers like `+1555…` are rejected.
- **`rememberMe`**: 90-day refresh token instead of 30 days, and it stays 90 days across refreshes.
- **Codes**: 5 wrong guesses cancel a code (**429**), so request a new one. New codes can be sent at most once per 60 s (show a countdown).
- **Refresh tokens are single-use**: each `/auth/refresh` returns a new pair and the old refresh token stops working — always store the new one.

**Auth flow for the mobile app**: `signup` → `verify` (returns tokens) → store `accessToken`/`refreshToken` securely on-device → attach `Authorization: Bearer <accessToken>` on protected calls → call `refresh` when the access token expires (~15 min) → `logout` clears the refresh token server-side.

**Known gap**: email codes are sent for real via Brevo (since 2026-10-01). SMS codes are only logged to the server console (`OtpDeliveryService` in `src/notifications/`); no SMS provider for now (user decision 2026-10-06), so read phone codes off the server log during testing.

## Groups (`/groups`) — Phase 4, done (2026-09-28)

All endpoints need a Bearer token. `:groupId` routes are **members only**: non-members get **404**, as if the group didn't exist. Routes marked *admin* return **403** for Viewers.

| Method | Path | Who | Description |
|---|---|---|---|
| POST | `/groups` | any user | Create a group (name, description, tripStart, tripEnd all required; optional `currency`, ISO 4217, default INR, fixed once the group has expenses). Creator becomes Admin. |
| GET | `/groups` | any user | My groups, each with `myRole` and `memberCount`. |
| GET | `/groups/:groupId` | member | Group details + `myRole`, `memberCount`. |
| PATCH | `/groups/:groupId` | admin | Edit name/description/trip dates. |
| DELETE | `/groups/:groupId` | admin | Delete the group and everything in it. |
| POST | `/groups/:groupId/cover-image` | admin | Set/replace the trip cover (added 2026-10-08). Multipart `file`: JPEG/PNG/WebP, ≤ 5 MB (checked by content). Returns the group. Local disk (`UPLOAD_DIR`) until object storage. |
| GET | `/groups/:groupId/cover-image` | member | The image, cached for good (`?v=` changes on each upload). Clients use the group's `coverImageUrl` (absolute, from `PUBLIC_API_URL`; `null` if none). |
| DELETE | `/groups/:groupId/cover-image` | admin | Remove the cover. Returns the group. |

**Since 2026-10-14:** `PATCH`, cover upload/remove, close and reopen send `group:updated` `{ groupId, group (without myRole), changedBy, timestamp }` to every member (Edit Trip screen).
| GET | `/groups/:groupId/members` | member | Members (`userId`, `username`, `name`, `avatarUrl`, `role`, `joinedAt`), admins first. |
| POST | `/groups/:groupId/members` | admin | Add a **registered** user directly by `username`, `email` or `phone` (optional `role`, default Viewer). 404 if no such user, 409 if already a member. |
| PATCH | `/groups/:groupId/members/:userId` | admin | Change role (`ADMIN` / `VIEWER`). Any number of admins; at least one always. Live `member:role_changed` (CR v1.0 change 5). |
| DELETE | `/groups/:groupId/members/:userId` | admin, or self | Remove a member, or leave the group by passing your own `userId`. |
| POST | `/groups/:groupId/invites` | admin | Create an invite, see below. |
| GET | `/groups/:groupId/invites` | admin | Pending, unexpired invites and links. |
| DELETE | `/groups/:groupId/invites/:inviteId` | admin | Revoke a pending invite or share link. |

## Invites (`/invites`) — Phase 4, done (2026-09-28)

The invitee side. All need a Bearer token, so an invitee must sign up / log in first.

| Method | Path | Description |
|---|---|---|
| GET | `/invites` | My pending email/SMS invitations (with group summary and who invited me). |
| POST | `/invites/:inviteId/accept` | Accept → joins the group as Viewer. |
| POST | `/invites/:inviteId/reject` | Reject. |
| GET | `/invites/link/:token` | Preview the group behind a share link (`group`, `invitedBy`, `expiresAt`, `alreadyMember`). |
| POST | `/invites/link/:token/accept` | Join via share link as Viewer. Safe to call twice. |

**Invite types** (`POST /groups/:groupId/invites`, body `{ channel, email?, phone?, expiresInDays? }`):
- **`LINK`**: returns `token` and `link` (`INVITE_LINK_BASE_URL/<token>`). **The token is shown only once**, because the server stores just a hash. The link works for anyone who opens it, any number of times, until it expires (`expiresInDays` 1–30, default 7) or an admin revokes it. The app should open the link, make the user log in or sign up, show the preview, then call accept.
- **`EMAIL`** (`email` required) / **`SMS`** (`phone` required): sends an invitation to one person (email sent via Brevo; SMS stubbed to the server console, like SMS OTPs). It appears in their `GET /invites` once they're logged in with that **verified** email/phone, including if they sign up after being invited. 409 if they're already a member or already have a pending invite.

**Rules the UI should reflect:**
- A group always keeps **at least one Admin**. Demoting, removing or leaving as the last Admin returns **409**, so promote someone first (or delete the group).
- `tripEnd` must not be before `tripStart` (400).
- Everyone who joins via an invite or link starts as **Viewer**. An Admin can promote them afterwards.
- Member lists don't expose other members' email or phone.
- **Since 2026-10-05 (CR v1.0 change 5):** live `member:joined` (direct add, invite, link), `member:removed` (also to the person removed) and `member:role_changed` (incl. the automatic hand-over on account deletion).

## Itinerary (`/groups/:groupId/itinerary`) — Phase 6 (2026-09-29, waiting on API keys)

Members only (non-members get 404). Every draft write returns the **whole itinerary**, because start/mid/end roles shift when pins move. See `../API_DOCUMENTATION.md` §9 for shapes. **Since 2026-10-05:** the draft has a `revision` (bumped on every edit); pin writes and finalize accept `If-Match: <revision>` and return 412 if the draft changed since (offline/concurrent admin edits).

| Method | Path | Who | Description |
|---|---|---|---|
| GET | `/groups/:groupId/itinerary` | member | Latest finalized version (404 until one exists). |
| GET | `…/itinerary/versions` | member | Finalized versions, newest first. |
| GET | `…/itinerary/versions/:version` | member | A specific finalized version. |
| GET | `…/itinerary/route?version=` | member | Map line through the stops in order, along roads (added 2026-10-14): GeoJSON `LineString` (`[lng, lat]`), total + per-leg `distanceMeters` / `durationSeconds` / `routed`, `status` OK / PARTIAL / UNAVAILABLE / NOT_CONFIGURED. OSRM (`ROUTING_URL`), cached in `itineraries.route_json` until a pin moves. |
| GET | `…/itinerary/pdf?version=` | member | Download as PDF (latest by default). The map draws the road route when there is one. |
| POST | `…/itinerary/refresh` | admin | Re-fetch elevation + weather on the latest version. |
| GET | `…/itinerary/draft` | admin | The working draft. |
| GET | `…/itinerary/draft/route` | admin | Road route through the draft's pins (preview while editing). |
| POST | `…/itinerary/draft` | admin | Start a draft (copy of latest version, or empty). 409 if one exists. |
| DELETE | `…/itinerary/draft` | admin | Discard the draft. |
| POST | `…/itinerary/draft/finalize` | admin | Lock the draft as the next version (needs ≥ 2 pins). Sends `itinerary:updated` `{ groupId, version, lockedAt }`. |
| POST | `…/itinerary/draft/refresh` | admin | Re-fetch elevation + weather on the draft. |
| POST | `…/itinerary/draft/waypoints` | admin | Drop a pin `{ name, lat, lng, date?, notes?, position? }`. |
| PUT | `…/itinerary/draft/waypoints/order` | admin | Reorder `{ waypointIds: [...] }` (all pins). |
| PATCH | `…/itinerary/draft/waypoints/:waypointId` | admin | Edit a pin. `null` clears date/notes. |
| DELETE | `…/itinerary/draft/waypoints/:waypointId` | admin | Delete a pin. |

Waypoints carry `outsideTripDates` (date outside the trip's UTC days, e.g. after the trip dates were edited); stop dates are flagged, not rejected.

**Enrichment status:** elevation comes from Open-Meteo, weather from MET Norway (both need no key, switched 2026-10-08), the PDF map from OpenStreetMap tiles, and road routes from OSRM (public demo server by default: dev only; set `ROUTING_URL` for production). **Reviews are not in the API** (open question).

## Trip status (`/groups/:groupId/status`) — Phase 9, done (2026-09-29)

Members only (Admins and Viewers alike). `POST` accepts `recordedAt` (≤ 7 days back) and `clientId` (retry-safe) for statuses set offline (2026-10-05).

| Method | Path | Description |
|---|---|---|
| POST | `/groups/:groupId/status` | Set my status `{ status: ARRIVED/STOPPED/NEED_HELP/IN_TRANSIT, note? }`. Pushed live as `status:updated`. |
| GET | `/groups/:groupId/status` | Every current member with their latest status (`null` if none). |
| GET | `/groups/:groupId/status/history?userId=&limit=&before=` | History, newest first. Page with `before = nextBefore`. |

## Live location (`/groups/:groupId/location`) — Phase 7 (2026-09-29; verified against live Redis 2026-10-01)

Members only. Each member controls their own sharing. Needs Redis (503 without it).

| Method | Path | Description |
|---|---|---|
| GET | `/groups/:groupId/location` | Map feed: every member with `tripStatus`, `sharing` (timer) and live `location`. |
| POST | `/groups/:groupId/location` | Send my position(s) `{ points: [{ lat, lng, accuracy?, heading?, speed?, recordedAt? }] }`. 409 if not sharing. |
| GET | `/groups/:groupId/location/share` | My sharing state + `remainingSeconds` + `updateIntervalSeconds` (10). |
| PUT | `/groups/:groupId/location/share` | Start / change `{ duration: ONE_HOUR/FOUR_HOURS/EIGHT_HOURS/ALWAYS }`. |
| DELETE | `/groups/:groupId/location/share` | Stop sharing. |

## Devices (`/devices`) — push registration

| Method | Path | Description |
|---|---|---|
| POST | `/devices` | Register this device's FCM token `{ token, platform: ANDROID/IOS/WEB }`. |
| DELETE | `/devices` | Unregister `{ token }` (call before logout). |

Setup for real pushes: `../docs/FIREBASE_SETUP.md`.

## Chat (`/groups/:groupId/messages` + socket) — Phase 8 (2026-09-30)

Members only. **Sending is over the socket**: `chat:send { groupId, body, clientMsgId? }`, `chat:typing { groupId, isTyping }`, `chat:read { groupId, messageId }`. Each replies via the ack callback with `{ ok, data | error: { status, message } }`.

| Method | Path | Description |
|---|---|---|
| GET | `/groups/:groupId/messages?before=&limit=&search=` | History (messages + alerts), oldest first per page. `before` = a message id (`nextBefore`). |
| GET | `/groups/:groupId/messages/unread` | `{ unreadCount, lastReadMessageId, lastReadAt }`. |
| POST | `/groups/:groupId/messages/read` | `{ messageId }`: read marker forward (HTTP twin of `chat:read`). |
| GET | `/groups/:groupId/messages/:messageId/reads` | `{ readBy, notReadYet }`. |

## Alerts & SOS (`/groups/:groupId/alerts`) — Phase 8 (2026-09-30)

| Method | Path | Description |
|---|---|---|
| POST | `/groups/:groupId/alerts` | **Admin.** `{ type: GENERAL/CRITICAL, category? (CRITICAL: WEATHER/ROAD_CLOSURE/SAFETY/OTHER), body }`. |
| POST | `/groups/:groupId/alerts/sos` | **Any member.** `{ body?, lat?, lng?, accuracy? }`; falls back to live-location position. One active SOS per member. |
| GET | `/groups/:groupId/alerts?active=&type=&before=&limit=` | Newest first. `active=true` = unresolved CRITICAL/SOS (banners). |
| GET | `/groups/:groupId/alerts/:alertId` | Alert + `acknowledgements` + `pending`. |
| POST | `/groups/:groupId/alerts/:alertId/ack` | Acknowledge CRITICAL/SOS (not your own). Idempotent. |
| POST | `/groups/:groupId/alerts/:alertId/resolve` | SOS: sender or admin. CRITICAL: admin. |

## Presence (`/groups/:groupId/presence`) — Phase 8 (2026-09-30)

| Method | Path | Description |
|---|---|---|
| GET | `/groups/:groupId/presence` | Every member with `online` + `lastSeenAt`, online first. Live: `presence:updated`. |

## Expenses (`/groups/:groupId/expenses`) — Phase 10 (2026-10-05)

Members only. Any member adds expenses; edit/delete/receipt = whoever recorded it or an admin. Amounts are numbers with ≤ 2 decimals in the group currency; maths in paise. Live: `expense:created` / `expense:updated` / `expense:deleted` (with the expense) and `expense:settlement_recorded` / `expense:settlement_deleted` (replaced `expense:changed` on 2026-10-05, CR v1.0 change 6). **Several payers** per expense since 2026-10-05: `payments` list on the expense.

| Method | Path | Description |
|---|---|---|
| POST | `/groups/:groupId/expenses` | `{ amount, category, date, description?, paidBy? or payments? ([{ userId, amount }], must add up), splitType: EQUAL/CUSTOM, splitBetween? (EQUAL, default all), shares? (CUSTOM, must add up) }`. Response has `paidBy` (main payer) + `payments`. |
| GET | `/groups/:groupId/expenses?category=&paidBy=&involving=&from=&to=&limit=&before=` | Newest day first, paged with `before = nextBefore`. |
| GET | `/groups/:groupId/expenses/:expenseId` | One expense with splits, `myShare`, `canEdit`. |
| PATCH | `/groups/:groupId/expenses/:expenseId` | Partial edit. EQUAL re-splits on amount change; CUSTOM needs new shares; several payers need new `payments`. |
| DELETE | `/groups/:groupId/expenses/:expenseId` | Deletes it and its receipt. |
| PUT | `/groups/:groupId/expenses/:expenseId/receipt` | Multipart `file`: JPEG/PNG/WebP/HEIC/PDF, ≤ 5 MB (checked by content). Local disk (`UPLOAD_DIR`) until object storage. |
| GET / DELETE | `/groups/:groupId/expenses/:expenseId/receipt` | Download (any member) / remove. |
| GET | `/groups/:groupId/expenses/summary` | Total, `byCategory`, per-member paid/share/repaid/received/balance (ex-members with a balance included), `settleUp` (greedy, fewest payments), `myBalance`. |
| POST | `/groups/:groupId/expenses/settlements` | Record a repayment `{ fromUserId? (default me), toUserId, amount, date?, note? }`. Payer, receiver or admin. |
| GET | `/groups/:groupId/expenses/settlements` | Repayments, newest first. |
| DELETE | `/groups/:groupId/expenses/settlements/:settlementId` | Recorder or admin. |
| GET | `/groups/:groupId/expenses/report?format=pdf|csv` | Exportable report (PDF default, CSV for spreadsheets). |

## Location across groups (`/location`) — CR v1.0 change 2 (2026-10-05)

| Method | Path | Description |
|---|---|---|
| POST | `/location` | `{ points: [1–100] }` to **every** group I share with right now (one loop for the app). 409 if sharing nowhere. |
| GET | `/location/sharing` | Groups I share with now, with duration / `expiresAt` / `remainingSeconds`. |

`location:sharing-stopped` now also has `reason: REMOVED` (member removed, left, or deleted their account while sharing).

## Chat voice + location messages — CR v1.0 change 8 (2026-10-05)

| Method | Path | Description |
|---|---|---|
| POST | `/groups/:groupId/messages/voice` | Multipart `file` (AAC/M4A or Ogg, ≤ 2 MB, checked by content, no video track) + `durationMs` (≤ 120 000) + `clientMsgId?`. Posts a `kind: VOICE` message. |
| GET | `/groups/:groupId/messages/:messageId/voice` | The recording (members). |

Messages gain `kind` (TEXT / LOCATION / VOICE) and `voice: { durationMs, contentType } | null`. Locations go over the socket: `chat:send { groupId, kind: "LOCATION", location: { lat, lng, accuracy?, label? }, body? }`. No image/file/video messages (CR: do not add). Files under `voice/<groupId>/` in `StorageService`, deleted with the group.

## Nearby places (`/location/fuel-stations|restaurants|garages`) — CR v1.0 change 1 (2026-10-05)

| Method | Path | Description |
|---|---|---|
| GET | `/location/fuel-stations?lat=&lng=&radius=&limit=` | OSM `amenity=fuel`. |
| GET | `/location/restaurants?…` | OSM restaurant / fast_food / cafe / food_court. |
| GET | `/location/garages?…` | OSM car_repair / motorcycle_repair / tyres. |

Signed-in users. `radius` meters (100–25,000, default 5,000), `limit` 1–50 (default 20). Nearest first with `distanceMeters`, `name` (may be null), `kind`, `address`, `openingHours` (OSM text), `phone`, `website`, `brand`; no ratings. `attribution` must be shown. Redis cache 10 min per ~100 m. 503 when the source fails. Source = `PlacesProvider` (`OverpassPlacesProvider`, `OVERPASS_URL`).

## Live location for loved ones (`/location-share`, `/public/live`) — CR v1.0 change 10 (2026-10-05)

| Method | Path | Who | Description |
|---|---|---|---|
| POST | `/location-share/sessions` | user | `{ duration: FIFTEEN_MINUTES/ONE_HOUR/EIGHT_HOURS, recipientLabel? }` → link + token (**shown once**). Max 5 active (409). |
| GET | `/location-share/sessions` | user | My active links (no token), `firstViewedAt`. |
| DELETE | `/location-share/sessions/:sessionId` | user | Stop now; recipients told + disconnected. |
| GET | `/public/live/:token` | anyone with the link | Sharer name/avatar, times, latest `location`. 404 unknown, 410 ended. 30/min per IP. |

Positions come from `POST /location` (returns `liveLinks`). Recipient socket: namespace `/live`, `auth: { token }`, events `ready`, `location:update`, `location_share:stopped`. Sharer's own devices: `location_share:started` / `location_share:stopped`. Pushes `LIVE_SHARE_VIEWED` (first open), `LIVE_SHARE_EXPIRED`. Latest position only (Redis `travelgo:loc:user:<id>`), link rows deleted 30 days after they end. The recipient web page is the web team's.

## Activities (`/groups/:groupId/activities`) — CR v1.0 changes 3–4 (2026-10-05)

An activity = a stop of the latest finalized itinerary, identified by `activityId` (on every waypoint; stays the same across versions). Waypoints also carry `activity: { status, statusUpdatedAt, statusUpdatedBy, updateCount }`. Live: `activity:status_updated`, `activity:update_added`, `activity:update_edited`, `activity:update_deleted`.

| Method | Path | Who | Description |
|---|---|---|---|
| GET | `/groups/:groupId/activities` | member | Latest version's stops with status + update count. 404 if nothing finalized. |
| PATCH | `/groups/:groupId/activities/:activityId/status` | admin | `{ status: UPCOMING/CURRENT/COMPLETED }`. One CURRENT at a time (the previous one is completed). |
| GET | `/groups/:groupId/activities/:activityId/updates?limit=&before=` | member | Newest first, paged. |
| POST | `/groups/:groupId/activities/:activityId/updates` | member | `{ text (1–1000), clientId? }`. Only stops in the latest version. |
| PATCH | `/groups/:groupId/activity-updates/:updateId` | author | Edit text (`editedAt`). |
| DELETE | `/groups/:groupId/activity-updates/:updateId` | author or admin | Soft delete, text wiped. |

## Closed beta — Phase 13 (2026-10-05)

| Method | Path | Who | Description |
|---|---|---|---|
| POST | `/feedback` | user | Bug report / idea `{ category: BUG/IDEA/OTHER, message, rating?, screen?, groupId?, appVersion?, platform?, osVersion?, deviceModel? }`. Emailed to `FEEDBACK_EMAIL`. 10/min. |
| GET | `/feedback/mine` | user | My reports with `status` + `opsNote`. |
| PUT | `/feedback/:id/screenshot` | reporter | Multipart `file`, image ≤ 5 MB. |
| GET | `/ops/stats?since=` | team (`X-Ops-Key`) | PDF §9 KPIs: users/active/week-1 retention, groups, invites, chat, location adoption, expenses, exports, safety, offline, feedback. |
| GET | `/ops/trips` | team | Per-trip feature checklist + `endToEnd` (Phase 13 DoD). |
| GET / PATCH | `/ops/feedback`, `/ops/feedback/:id` | team | List (status/category filters, paged) / triage `{ status, opsNote }`. |
| GET | `/ops/feedback/:id/screenshot` | team | The screenshot. |

`/ops/*` answers 404 unless `OPS_API_KEY` is set. `GET /health` now also reports `redis`, `version`, `uptimeSeconds`, and returns 503 when the database is down. Usage counters (`usage_daily`) record app opens, location shares started, PDF/report exports and offline bundle fetches for the KPIs. See `../docs/BETA_TEST_PLAN.md`, `../docs/DEPLOYMENT.md`.

## Privacy & security — Phase 12 (2026-10-05)

| Method | Path | Description |
|---|---|---|
| GET | `/auth/me/export` | GDPR: everything stored about me, as a JSON download. |
| DELETE | `/auth/me` | Delete my account `{ password }`: personal data scrubbed ("Deleted user"), leaves all groups (last admin → earliest member promoted), sole-member groups deleted, sockets closed. |
| POST | `/groups/:groupId/close` | **Admin.** Trip becomes read-only (409 on writes, chat, invites) and is deleted after `GROUP_DELETE_AFTER_CLOSE_DAYS` (30). Push `GROUP_CLOSED`. |
| POST | `/groups/:groupId/reopen` | **Admin.** Undo before deletion. |

Group object gains `closedAt`, `deleteAfter`. Rate limits per IP (`429` + `Retry-After`; SOS never limited), chat 20 msgs / 10 s per user. Retention job hourly (closed trips, unverified accounts > 7 days, invites expired > 30 days). See `../docs/SECURITY_CHECKLIST.md`.

## Offline (`/groups/:groupId/offline-bundle`) — Phase 11 (2026-10-05)

| Method | Path | Description |
|---|---|---|
| GET | `/groups/:groupId/offline-bundle` | Everything to cache a trip: group, members, finalized itinerary (+ draft for admins), statuses, expenses + summary + repayments, latest 100 chat messages + unread, active alerts, latest 200 activity updates. `ETag` / `If-None-Match` → 304. (The offline map region was removed 2026-10-05: no offline map downloads.) |

Retry-safe offline writes: chat `clientMsgId`, expense `clientId`, status `clientId` + `recordedAt`, location batches, draft `If-Match`. Rules in `../API_DOCUMENTATION.md` §3.8.

## Realtime (socket.io) — since 2026-09-29

Connect to the API's base URL with `io(baseUrl, { auth: { token: accessToken } })`. Server → app events: `ready`, `status:updated`, `location:updated`, `location:sharing-started`, `location:sharing-stopped`, `location:share-expired` (to the sharer), `chat:message`, `chat:typing`, `chat:read`, `alert:raised`, `alert:acknowledged`, `alert:resolved`, `presence:updated`, `expense:created`, `expense:updated`, `expense:deleted`, `expense:settlement_recorded`, `expense:settlement_deleted`, `member:joined`, `member:removed` (also to the removed person), `member:role_changed`, `group:updated`, `itinerary:updated`, `user:profile_updated` (to co-members and your own devices), `activity:status_updated`, `activity:update_added`, `activity:update_edited`, `activity:update_deleted`, `session:expired` (the token expired, so refresh and reconnect). Only current group members receive a group's events. See `../API_DOCUMENTATION.md` §13–17.

## Not yet built

Itinerary reviews (pending decision), chatbot itinerary flow (deferred), multi-currency (image/file/video chat messages are out of scope) — see `02_Build_Plan.md` for what's coming and in what order.
