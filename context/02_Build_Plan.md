# TravelGo Backend — Build Plan

Phase numbering matches `../TravelGo_Implementation_Plan.pdf` Section 6 (14 phases, ~30 weeks). **The PDF is the source of truth for scope**, amended by the Change Request v1.0 (`../TRAVELG0.pdf`, section at the end) — each entry below is what the **backend** specifically owns that phase, with the PDF section it traces to. Client-only work (Flutter screens, UI kit, wireframes, orientation/layout) is out of scope for this repo and not listed.

Each phase's **Definition of Done (DoD)** is copied from the PDF; the backend part of a phase is done when its endpoints/jobs make that DoD possible for the Flutter app.

## Phase 1 — Discovery & Planning (W1–2)
- Provision vendor accounts: Google Maps, FCM/APNs, SMS/email provider, weather + elevation API (PDF §7)
- Confirm TripAdvisor/Google review API access terms (PDF §7)
- Sign off data model (`01_Architecture.md` §3) and stack decision (§1), including the custom-backend-vs-BaaS deviation (`01_Architecture.md` §1)
- **DoD:** plan approved · vendor accounts provisioned · wireframes & data model signed off

## Phase 2 — Core Infrastructure & Backend Setup (W3–5)
- NestJS project scaffold, CI/CD pipeline, lint/format config, dev/staging environments
- Provision PostgreSQL + Redis (dev/staging)
- Cloud/object storage for images and PDFs (PDF §3.2)
- Auth service skeleton
- API conventions / OpenAPI spec baseline
- **DoD:** repos & pipelines live · backend environments (dev/staging) provisioned

## Phase 3 — Authentication & User Management (W6–7) — PDF §2.1
- Signup (email/phone) with **password strength validation** (PDF §2.1 — not just min length)
- Email/SMS OTP verification required for account activation
- Login (password + OTP), JWT access + refresh tokens, "remember me"
- Password reset flow via email/SMS, profile setup endpoints (name, optional avatar)
- **DoD:** users can register, verify, log in and manage their profile end-to-end

## Phase 4 — Groups & Membership (W8–9) — PDF §2.2
- Group CRUD — name, description and trip dates required; private only, no public discovery
- **Admin can edit group details**
- **Add registered users directly by username/email** (no invite round-trip)
- Invite via unique shareable link (signed/expiring token), SMS, email
- Pending invitations with accept/reject workflow, auto-add on accept
- Admin/Viewer roles, change role (Admin ↔ Viewer), member removal, no member-count limit
- Group-scoped authorization (members-only access) reused by every later module
- **DoD:** a group can be created, populated with members, and role-managed

## Phase 5 — Itinerary Builder: Chatbot Flow (W10–12) — PDF §2.3.1 — **DEFERRED (2026-09-28)**

> Not in the current release, as confirmed by the frontend developer (likely "coming soon"). Kept below for when it returns. The itinerary foundations move to Phase 6. See the `03_Progress_Tracker.md` decisions log.

- Chatbot-flow state machine API (start → next point → transport mode [bike/car/bus/walking] → add-more)
- Waypoint detail endpoints: accommodation (name, phone, directions, menu, pricing), activities/sightseeing, dining, special events
- Admin-only writes; viewers read-only
- **DoD:** admin can build a multi-stop itinerary conversationally, end to end

## Phase 6 — Itinerary Builder: Map, Attributes & PDF Export (W13–15) — PDF §2.3.2–2.3.3
> Scope changed 2026-09-28: Phase 5 is deferred and **chatbot-only features are excluded**, so there's no transport mode and no accommodation/activities/dining/events details. This phase now also owns the itinerary foundations. See the `03_Progress_Tracker.md` decisions log.

- Itinerary per group: draft (admin-only) → finalized/locked version visible to the whole group; viewers read-only
- Pin CRUD (lat/lng + place name) + drag-reorder endpoint; start / end / mid-waypoint designation
- Per-pin attributes: date/day, notes, and external enrichment — elevation (with oxygen-level context), weather forecast for that day, TripAdvisor/Google reviews (cached per waypoint)
- Finalize/lock itinerary, versioning
- PDF export background job (BullMQ) → object storage → signed URL; PDF includes waypoints, map overview, dates, weather, elevation, notes
- **DoD:** a map-built itinerary can be finalized and exported/shared as a PDF

## Phase 7 — Real-Time Location Tracking (W16–18) — PDF §2.4
- WebSocket gateway for live-location ingest/broadcast; visible to group members only, only while sharing is active
- Redis-backed TTL sharing sessions (1h/4h/8h/Always), remaining-time exposed to client, auto-expiry job
- **Push/in-app notification when a share auto-expires**
- Member map feed: name/avatar, location, last-updated timestamp, per-member status
- Fan-out to group members at configurable 5–30s interval
- Foreground + background handling support (API contract for client)
- **DoD:** group members can see each other's live location for a chosen duration, foreground & background

## Phase 8 — Chat, Notifications & SOS (W19–20) — PDF §2.5
- Chat WebSocket gateway (messages with sender + timestamp, read receipts, typing, searchable history)
- Alert types: general, critical (weather/road closures/safety), emergency SOS
- SOS broadcast + acknowledgement tracking for critical/SOS messages
- Push notification integration (FCM/APNs) for critical/SOS/chat
- SOS disclaimer copy agreed (group-notification feature, not emergency dispatch — PDF §8 risk)
- **DoD:** group can chat in real time and trigger/acknowledge SOS and critical alerts

## Phase 9 — Trip Status Management (W21) — PDF §2.6
- Status broadcast endpoint (Arrived / Stopped-Halted / Need Help / In Transit), real time to the group
- Status history log per member per trip
- **DoD:** every member's current and historical status is visible to the group

## Phase 10 — Expense Management & Billing (W22–23) — PDF §2.7
- Expense CRUD + receipt image upload; amount, category and date required, free-text description
- Split engine: equal across selected members + custom amounts; automatic per-person share
- Settlement calculation ("who owes whom"), category breakdown
- Exportable expense report
- Single currency only (multi-currency is future roadmap, PDF §11)
- **DoD:** group can log shared expenses and see a correct settlement summary

## Phase 11 — Offline Maps & Responsive UI (W24–25) — PDF §2.8
- Sync/conflict-resolution endpoints (admin-authoritative for itinerary)
- Offline itinerary bundle endpoint (everything the app needs to cache a trip)
- Accept batched offline GPS pings on reconnect
- Offline map tile download/caching support
- **DoD:** core planning & navigation features work with no connectivity

## Phase 12 — QA, Security Hardening & Performance (W26–27) — PDF §4
- Load test WebSocket paths (location, chat) against NFR targets (chat <2s, 5–30s location updates)
- Security review: token storage, TLS, access control, rate limiting, encryption of sensitive data
- Data privacy: configurable data/location-history retention job, group data deletion on closure, GDPR export/delete endpoints
- Crash/error reporting integration (Sentry)
- Permission-justification + privacy policy drafts submitted early (PDF §8 risk)
- **DoD:** NFR targets met; security checklist signed off; crash-free session baseline established

## Phase 13 — Closed Beta Testing (W28–29)
- Monitoring/alerting on real usage
- Bug fixes from beta cohort feedback (2–3 real travel groups)
- **DoD:** beta cohort completes at least one real trip end-to-end on the app

## Phase 14 — Store Submission & Launch (W30)
- Production scaling review
- On-call runbook
- **DoD:** TravelGo is live on both stores

## Change Request v1.0 — `../TRAVELG0.pdf` (dated 2026-10-01, received 2026-10-05)

Ten changes on top of the phases above, built in this order (CR priority first; step 3 is the base for step 4). Paths and names follow this API's conventions (naming map in `01_Architecture.md` §3). Every step also covers, where it applies: a migration (dev DB backed up first), e2e tests, `API_DOCUMENTATION.md` + `04_API_Reference.md`, and the new data in data export, account deletion, the retention job, the offline bundle and `/ops` metrics.

| Step | CR change | Priority | Backend work |
|---|---|---|---|
| 0 | — | — | Docs + decisions (this section, naming map, tracker) |
| 1 | #5 Multiple admins | High | Already allowed (≥1 admin rule only). Add live `member:role_changed`, plus `member:joined` / `member:removed` |
| 1 | #6 Flexible expense splitting | High | Per-expense participants already built (`splitBetween` / `shares`). Add **several payers** per expense (`payments`), CR event names `expense:created/updated/deleted`. `splitBetween` stays optional (defaults to everyone; the app shows member checkboxes) |
| 2 | #3 Activity status | High | Activity = itinerary stop. Stable `stop_key` carried across versions; status `upcoming/current/completed` per stop of the latest finalized version, **admins only**, one `current` at a time; `activity:status_updated` |
| 2 | #4 Activity updates | Medium | `activity_updates` table keyed by stop; any member posts, author edits, author or admin deletes (soft); `activity:update_added/_updated/_deleted`; no push |
| 3 | #2 Group member locations | High | Mostly built (Phase 7). Add one user-level ingest `POST /location` that feeds every group the user shares with (and step 4's links); emit `location:sharing-stopped` when a sharing member is removed. Sharing stays opt-in; the app derives initials from `name` |
| 4 | #10 Live location for loved ones | Medium | `location_share_links` (owner, recipient label, token hash, 15m/1h/8h, stop/expiry, first viewed); max 5 active; owner endpoints + a **public recipient API** by token (410 after expiry/stop, rate-limited) with polling and/or a token-only socket; push to the sharer when first opened; no location history. **The recipient web page is the frontend/web team's** (framework not chosen yet), so the backend only provides APIs, live data, recipient authorization and CORS for the page's origin |
| 5 | #1 Places | Medium | `GET /places/fuel-stations|restaurants|garages?lat&lng&radius` from OSM Overpass (default 5 km, max 25), name/address/coords/distance + opening hours if known, no ratings, Redis cache 10 min. Production needs a hosted Overpass/places provider |
| 6 | #8 Chat scope | Low | Message `kind` TEXT / LOCATION / VOICE. Voice: upload (AAC/M4A, ≤ 2 min, ≤ 2 MB, checked by content) then `chat:send`, members-only playback. Location: `{ lat, lng, label? }`. **No** file/image/video messages |
| — | #7 Remove gallery, #9 Profile | Low | UI only; no gallery exists in the backend. Check with the frontend whether "Saved Places", "Preferences" and "Profile statistics" need endpoints |

## Out of scope for MVP (PDF §5.2, §11)
Voice/video calling, offline chat queue, shared photo album, automated settlement suggestions, trip discovery / public groups, booking integrations, AI itinerary suggestions, multi-currency conversion, real-time translation. New requests go to this backlog, not into an MVP phase (PDF §8 scope-creep risk).
