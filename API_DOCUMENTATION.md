# TravelGo API Documentation

**For:** the TravelGo mobile app (Flutter)
**Version:** 1.3.0, updated 2026-10-14
**Covers:** 112 REST endpoints plus a realtime socket connection:
- Health check
- Authentication and profile (with a profile picture)
- Groups (with an optional cover image), members and invites
- Itinerary (map pins, versions, road route for the map, PDF)
- Activities (status of each stop, updates from the group)
- Nearby places (fuel stations, restaurants, garages)
- Trip status
- Live location (with your group, and by link with people outside the app)
- Push-notification devices
- Chat (text, emoji, location, voice), alerts & SOS, presence
- Expenses (splits, settle-up, receipts, report)
- Offline mode (trip bundle, safe retries)
- Privacy (download my data, delete my account, close a trip) and rate limits
- Beta feedback (in-app bug reports and ideas)

### What changed in 1.3.0 (2026-10-14)

Three frontend requests. **Nothing breaking**: only new endpoints, fields and socket events.

| Feature | What the app does | Where |
|---|---|---|
| **Edit Trip** | Edit buttons for the trip's details (`PATCH /groups/:groupId`, as before) and its stops (the draft endpoints, as before). New: every member's app hears about it live through **`group:updated`** (details, dates, cover, closed/reopened) and **`itinerary:updated`** (a new version was published). Pins gain **`outsideTripDates`** so the app can flag stops left outside edited trip dates | §6 "Editing a trip", §9, §13 |
| **Profile pictures** | Upload with **`POST /auth/me/avatar`**, remove with **`DELETE /auth/me/avatar`**. `avatarUrl` then points at **`GET /users/:userId/avatar`**, which needs **no token**, so `Image.network(avatarUrl)` just works. Every user object already has `avatarUrl` (members, chat, expenses, live map…): show the photo and fall back to initials when it's `null`. Live **`user:profile_updated`** when someone changes their photo or name | §5, §13 |
| **Route map** | **`GET /groups/:groupId/itinerary/route`**: the stops joined in order **along roads**, as a GeoJSON line with distance and driving time per leg. Draw it as a polyline under the pins. Admins can preview the draft's route with `GET …/itinerary/draft/route`. The PDF map now follows roads too | §9 "Route map" |

### What changed in 1.2.0 (2026-10-08)

**Weather works now** (from MET Norway, free, no key). Pins get real forecasts, so `weather.status` is `OK` when the pin's date is in range. Three small changes to the forecast (§9):
- `forecast.precipitationChancePercent` **can be `null`** when the weather service has no rain probability for that place. Hide the rain chance then.
- `forecast.provider` is `"met-norway"`, and forecasts reach about 9 days ahead (was 8), so `availableFrom` is the pin date minus 8 days.
- Show the credit **"Weather data: MET Norway"** wherever forecasts appear (their licence requires it). The PDF already prints it.

### What changed in 1.1.0 (2026-10-08)

**Trip cover image** (optional, nothing breaking). The group object has a new `coverImageUrl` field (`null` when there's no cover), and there are 3 new endpoints: `POST`, `GET` and `DELETE /groups/:groupId/cover-image` (§6, "Cover image"). `POST /groups` is unchanged: create the group first, then upload the cover with its `id`. The URL needs the same `Authorization` header as every other call.

### What changed in 1.0.1 (2026-10-08)

**No endpoint, request or response changes.** Status notes only: push notifications are now sent for real (Firebase), weather shows `UNAVAILABLE` until the weather account is upgraded, and SMS stays printed on the server for now. `API_RESPONSES.md` was re-captured and matches 1.0.0. (The backend also has 6 team-only `/ops/*` endpoints; they aren't for the app and aren't counted here.)

### What changed in 1.0.0 (2026-10-05)

From the Technical Change Request v1.0. **Breaking changes first**:

| Change | What the app must do |
|---|---|
| `expense:changed` socket event **removed** | Listen to `expense:created`, `expense:updated`, `expense:deleted`, `expense:settlement_recorded`, `expense:settlement_deleted` instead (§13). Created/updated carry the expense |
| Offline bundle has **no `map` section** any more | Drop the offline map download. Cache only the tiles the user views (§3.8) |

**New** (nothing else changed):

| Feature | Where |
|---|---|
| Any number of admins; live `member:joined`, `member:removed`, `member:role_changed` | §7, §13 |
| Several people can pay one expense (`payments`); each expense has its own participants | §17 |
| Activities: status of each itinerary stop (admins) + updates from members. Waypoints gain `activityId` and `activity` | §9, §20 |
| One position feed for all groups: `POST /location`, `GET /location/sharing`; `location:sharing-stopped` reason `REMOVED` | §11 |
| Live location for people outside the app (links, recipient API, `/live` socket) | §21 |
| Nearby fuel stations, restaurants, garages (homepage) | §22 |
| Chat location and voice messages; messages gain `kind` and `voice` | §14 |

Every one of these has real examples in `API_RESPONSES.md`.

---

## 1. Getting started

### What's ready

| Area | Status | Notes |
|---|---|---|
| Auth & profile | ✅ Ready | Codes are emailed for real. SMS codes are still only printed on the server. See "Getting verification codes" below. |
| Groups, members, invites | ✅ Ready | Invite emails are sent for real. SMS invites are still only printed on the server. |
| Itinerary (map pins, versions, PDF) | ✅ Ready | Elevation, weather (MET Norway) and the PDF map work. Reviews aren't built. |
| Live location for loved ones | ✅ Ready (backend) | Links for people outside the app, recipient API + `/live` socket (§21). The recipient web page is the web team's |
| Nearby places | ✅ Ready | Fuel stations, restaurants, garages from OpenStreetMap (§22). The public data server is for light use; production needs a hosted one |
| Activities | ✅ Ready | Status per itinerary stop (admins) and updates (everyone), live (§20) |
| Trip status | ✅ Ready | Live over the socket |
| Live location | ✅ Ready | Redis runs on the dev server since 2026-10-01. If it's ever down, these endpoints return `503`. The "sharing ended" push and the socket event both work. |
| Push notifications | ✅ Ready | Sent for real through Firebase (FCM) since 2026-10-06. The app must use the same Firebase project as the backend (§8). |
| Chat, alerts & SOS, presence | ✅ Ready | Text, emoji, location and voice messages (no images/files/video). Sending text/location is over the socket, voice over HTTP. Pushes are sent for real. SOS location from live sharing needs Redis; device coordinates always work. |
| Expenses | ✅ Ready | Equal/custom splits, balances, settle-up, receipts and PDF/CSV report. Receipts are stored on the dev server for now. |
| Offline | ✅ Ready | Trip bundle with ETag, retry-safe writes, itinerary conflict rule (§3.8, §18). No offline map download (dropped 2026-10-05). |
| Beta feedback | ✅ Ready | "Send feedback" with device details and a screenshot; testers see the team's reply (§19). |
| Privacy & limits | ✅ Ready | Download my data, delete my account, close a trip (read-only, deleted after 30 days). Requests are rate-limited (§2). |

### Connecting to the dev server

| Where the app runs | Base URL |
|---|---|
| Android emulator | `http://10.0.2.2:3000` (the emulator's alias for the host computer) |
| iOS simulator | `http://localhost:3000` |
| Real phone on the same Wi-Fi | `http://<backend computer's LAN IP>:3000`, e.g. `http://192.168.1.20:3000` |
| Anywhere, through the ngrok tunnel | The current `https://….ngrok-free.app` URL from the backend developer. It **changes every time ngrok restarts**, so keep it configurable. Add the header `ngrok-skip-browser-warning: true` to every request, or ngrok may return its HTML warning page instead of JSON. |

- **Phone can't connect?** Allow port 3000 through Windows Firewall on the backend computer.
- **Android:** plain `http://` needs `android:usesCleartextTraffic="true"`, or a network security config, in debug builds.
- **Browsable docs:** every endpoint can be tried at **`<base URL>/docs`** (Swagger).
- **Real examples:** `API_RESPONSES.md` has real requests and responses for every endpoint (235 steps), including socket acks, socket events and the push notifications each action sends. Re-captured on 2026-10-08 for 1.1.0 (adds the cover image steps).
- **Staging and production URLs** don't exist yet. Keep the base URL configurable.

### Getting verification codes

- **Email: really sent (since 2026-10-01).** Signup codes, password-reset codes and email invites arrive in the inbox from "TravelGo". Check spam if one doesn't show up within a minute. Use real addresses you can open when testing.
- **SMS: not sent (not needed for now).** Codes and invites for phone numbers (including the phone-only login OTP) are only **printed in the backend's terminal**, e.g. `[DEV OTP] SMS to +919812345601: 483920`. Ask the backend developer for the code.
- On the dev server, email codes are printed in the terminal too, as a fallback.

- **Code lost or expired?** Call `POST /auth/resend-verification`.
- **Too many wrong guesses?** After 5 wrong tries the code is cancelled (`429`); request a new one.

---

## 2. Basics

### Base URL
See §1 "Connecting to the dev server". Every path below is relative to it, e.g. `POST {baseUrl}/auth/login`.

### Requests
- Send bodies as JSON, with the header `Content-Type: application/json`.
- Endpoints marked 🔒 need the header `Authorization: Bearer <accessToken>`.
- Dates are ISO 8601 strings, e.g. `2026-10-10T00:00:00Z`.
- Ids are UUIDs. A malformed id in the path returns `400` "Validation failed (uuid is expected)". A malformed `groupId` returns `404` "Group not found".
- Unknown fields in a body are silently dropped, not rejected.

### Responses
- Successful `POST` requests return **201**. `GET`, `PUT`, `PATCH` and `DELETE` return **200**. Treat any 2xx as success.
- Some successful requests return an empty body: logout, the deletes, and member removal.
- Errors look like this (the one exception: a missing or invalid token gives `{ "message": "Unauthorized", "statusCode": 401 }`, with no `error` field):

```json
{ "statusCode": 409, "message": "Username is already taken", "error": "Conflict" }
```

For validation errors (400), `message` is a **list** of every problem found:

```json
{ "statusCode": 400, "message": ["Password must be 8–72 characters with ..."], "error": "Bad Request" }
```

### Status codes used
| Code | Meaning |
|---|---|
| 400 | Invalid input (missing field, wrong format, bad code) |
| 401 | Not logged in, token expired or wrong credentials |
| 403 | Logged in and a group member, but not allowed (e.g. a Viewer calling an Admin-only endpoint) |
| 404 | Not found, **or** you're not a member of that group. Groups are private, so non-members can't tell whether a group exists. |
| 304 | Not modified: the offline bundle hasn't changed since your `If-None-Match` ETag (empty body) |
| 409 | Conflict (already taken, already a member, last admin, etc.), or **the trip is closed** (read-only, see §6) |
| 410 | Email/SMS invite has expired (an expired share link returns `404`) |
| 412 | The itinerary draft changed since the revision you sent in `If-Match`. Reload it |
| 413 | Uploaded file is too big (receipts and cover images: max 5 MB) |
| 415 | Uploaded file type isn't allowed (receipts: JPEG, PNG, WebP, HEIC or PDF; cover images: JPEG, PNG or WebP) |
| 429 | Too many requests (rate limit, see below: wait `Retry-After` seconds), or too many wrong code guesses (request a new code) |
| 503 | A backing service is temporarily down (currently only live location, when Redis is unavailable). Retry later. |

### Input rules
| Field | Rule |
|---|---|
| `username` | 3–30 characters: lowercase letters, numbers, `.` and `_`. Must start and end with a letter or number. Case-insensitive (`Jordan_R` is saved as `jordan_r`). |
| `password` | 8–72 characters, with at least one uppercase letter, one lowercase letter, one number and one symbol. |
| `email` | Case-insensitive, saved in lowercase. |
| `phone` | International format with country code, e.g. `+919876543210`. |
| empty strings | On signup, verify, resend-verification, forgot-password and reset-password, an empty `email`/`phone` (`""`) counts as not provided. Elsewhere, leave optional fields out rather than sending `""`. |
| codes | 6 digits. Signup and login codes expire after 10 minutes, password reset codes after 15. **5 wrong guesses cancel the code** (`429`), so request a new one. A new code can be sent **at most once every 60 seconds**; show a countdown on the "resend" button. |

### Tokens
- **Access token:** sent with every 🔒 request. Lasts about 15 minutes.
- **Refresh token:** exchanged for a new pair when the access token expires. Lasts 30 days, or 90 days with "remember me".
- Refresh tokens are **single-use**. Each refresh returns a new pair, so always save the new refresh token.
- A user has **one active session**. Logging in again, or resetting the password, ends the previous one: its refresh token stops working, though its access token lasts until it expires.

### Rate limits
Requests are limited **per IP address, per minute**. Over the limit you get `429` "Too many requests. Please wait a minute and try again." with a `Retry-After` header (seconds). Every response carries `X-RateLimit-Limit`, `X-RateLimit-Remaining` and `X-RateLimit-Reset`.

| Endpoints | Per minute |
|---|---|
| `POST /auth/otp/request`, `/auth/forgot-password`, `/auth/resend-verification` (they send an SMS/email) | 5 |
| `POST /auth/signup` | 10 |
| `POST /auth/verify`, `/auth/otp/login`, `/auth/reset-password` (code entry) | 10 |
| `POST /auth/login` | 20 |
| `POST /auth/refresh` | 30 |
| `DELETE /auth/me` | 5 |
| `POST …/alerts` (admin alerts) | 20 |
| `PUT …/receipt`, `POST …/cover-image`, `POST /auth/me/avatar` | 30 |
| `GET /auth/username-available` | 60 |
| **SOS** (`POST …/alerts/sos`) | **never limited** |
| everything else | 120 |

Chat over the socket: at most **20 messages per 10 seconds per user**; the 21st gets the ack `{ ok: false, error: { status: 429 } }`. The per-code limits still apply too (5 wrong tries, one send per 60 s).


---

## 3. Mobile integration guide

The rules below prevent most integration bugs. The endpoint details follow in later sections.

### 3.1 Tokens and sessions
- **After login or verify**, store **both** tokens in secure storage (`flutter_secure_storage`).
- **On every 🔒 request**, send `Authorization: Bearer <accessToken>`. The access token lasts about **15 minutes**.
- **On a `401`:** call `POST /auth/refresh` with the refresh token, save the **new pair**, then retry the original request once. If the refresh also returns `401`, send the user to login.
- **Refresh tokens are single-use.** If two requests refresh at the same time, the second one fails and logs the user out. **Run only one refresh at a time**: queue other requests until it finishes. In Dio, a `QueuedInterceptor` does this.
- **One session per user.** Logging in on another device, or resetting the password, ends the old session: its next refresh returns `401`.
- **"Remember me"** (`rememberMe: true` on login) keeps the session for 90 days instead of 30.

### 3.2 Realtime socket
Use `socket_io_client`. Connect once after login, on the API's base URL:
```dart
final socket = IO.io(baseUrl, IO.OptionBuilder()
    .setTransports(['websocket'])
    .setAuth({'token': accessToken})
    .disableAutoConnect()
    .build());
socket.connect();
socket.on('ready', (_) { /* connected */ });
socket.on('status:updated', (data) { /* … */ });
socket.on('location:updated', (data) { /* move the pin */ });
socket.on('chat:message', (msg) { /* add to the timeline (match clientMsgId for your own) */ });
socket.on('alert:raised', (alert) { /* show the banner */ });
socket.on('presence:updated', (p) { /* online dot */ });
socket.on('session:expired', (_) async {
  final token = await refreshAccessToken();   // your refresh logic
  socket.auth = {'token': token};
  socket.connect();
});
socket.onConnectError((err) { /* "Unauthorized": refresh the token, then reconnect */ });
```
- **The server disconnects** the socket when the access token expires (`session:expired`). Reconnect with a fresh token.
- **One connection for everything:** it carries events for **all** your groups. Each event has `groupId`, so filter on the screen you're showing.
- **After a reconnect**, re-fetch the screen's data (e.g. `GET …/location`, `GET …/status`, `GET …/messages`, `GET …/alerts?active=true`), because events sent while you were offline are not replayed.
- **Sending over the socket** (chat, typing, read) uses acknowledgements: `socket.emitWithAck(event, payload)`. See §14.

### 3.3 Live location loop
1. The member turns sharing on with `PUT /groups/:groupId/location/share` and a `duration`.
2. Use `updateIntervalSeconds` from the response (10 s). Every 10 s, `POST /location` with `{ "points": [ … ] }`: one call reaches **every** group the user shares with (or `POST /groups/:groupId/location` for one group).
3. **Background:** your location plugin can collect points while the app is backgrounded and send them in **one** call (up to 100 points). Plain HTTP works in the background; the socket doesn't.
4. **Stop sending** when you get `409` (sharing is off or expired), `location:share-expired`, or the push "Live location sharing ended".
5. **Map screen:** load `GET /groups/:groupId/location` once, then apply socket events:
   - `location:updated`: move the pin
   - `location:sharing-started`: show the member
   - `location:sharing-stopped`: remove the pin (`reason`: `STOPPED`, `EXPIRED`, or `REMOVED` when the member was removed from the group or left)
   - **Initials on the pin:** build them from the member's `name` (e.g. "Bob Kumar" → "BK").
6. **Countdown:** compute it from `expiresAt`, and don't count down `remainingSeconds` locally for hours. `ALWAYS` has no countdown.
7. **`503` on location endpoints** means the server's live-location service is down. Show "Live location unavailable" and retry later.

### 3.4 Push notifications
Set up Firebase in the app with **the same Firebase project** the backend uses (ask the backend developer). Then:
1. After login, get the FCM token and call `POST /devices` with `{ "token": "…", "platform": "ANDROID" }` (or `"IOS"` / `"WEB"`).
2. Listen for token refreshes and register again.
3. **Before logout,** call `DELETE /devices` with the same `{ "token": "…" }`.
4. Notification `data.type` tells you what it's about: `LOCATION_SHARE_EXPIRED`, `CHAT_MESSAGE`, `GENERAL_ALERT`, `CRITICAL_ALERT`, `SOS`, `SOS_ACKNOWLEDGED`, `SOS_RESOLVED`, `STATUS_NEED_HELP`, `EXPENSE_ADDED`, `EXPENSE_SETTLEMENT`, `GROUP_CLOSED`. Every one has `groupId`. See §6, §14, §15 and §17.
5. **SOS and critical alerts** deserve a high-importance Android notification channel with sound.

### 3.5 Invite links (deep links)
- **Link format:** a share link looks like `https://travelgo.app/invite/<token>`. The domain is a **placeholder** until the real one is set up, so parse only the last path segment as the token.
- **Joining flow:**
  1. The user opens the link.
  2. The app makes sure they're logged in (signup/verify first if needed).
  3. `GET /invites/link/<token>` shows the group preview.
  4. The user taps Join, and the app calls `POST /invites/link/<token>/accept`.
- **Email and SMS invites** need no link. After login, `GET /invites` lists them. Show a badge, then accept or reject.

### 3.6 Dates, times and ids
- **Timestamps** in responses are UTC ISO 8601 (`2026-10-10T06:00:00.000Z`). Convert to the phone's local time for display.
- **Group trip dates** (`tripStart`, `tripEnd`): send midnight UTC for the chosen day (e.g. `2026-10-10T00:00:00Z`), and show the date part in UTC so the day never shifts.
- **Itinerary pin dates** are plain `YYYY-MM-DD` with no time or timezone.
- **Ids** are UUID strings.

### 3.7 Things the app can't do yet
- **Real SMS delivery:** SMS codes and invites are only printed on the server. Email works.
- **Reviews** on pins aren't built yet.
- **Chat:** text, emoji, location and voice messages only. Image, file and video messages are **not planned** (by decision). Messages can't be edited or deleted.

### 3.8 Offline mode
Trips go through places with no signal. The app should keep working from a local copy and send what the user did once it's back online.

**1. Keep a local copy of each trip.** Call `GET /groups/:groupId/offline-bundle` (§18) when the app opens a trip, after reconnecting, and every few minutes while online. Send the last `ETag` as `If-None-Match`: if nothing changed you get an empty `304`, which costs almost nothing.

**2. Queue writes while offline, and send them in order on reconnect.** Every write that can be queued is safe to retry:

| What the user does offline | How to send it later | Retry-safe because |
|---|---|---|
| Chat message | `chat:send` with a `clientMsgId` (§14) | same `clientMsgId` returns the original |
| Expense | `POST …/expenses` with a `clientId` (§17) | same `clientId` returns the original |
| Trip status | `POST …/status` with `clientId` + `recordedAt` (§10) | same `clientId` returns the original; `recordedAt` keeps the real time |
| GPS positions (GPS-only tracking) | `POST …/location` as a batch (§11) | only the newest point is shown; older ones are ignored |
| Itinerary edits (admins) | the draft endpoints with `If-Match: <revision>` (§9) | a stale edit gets `412` instead of overwriting |

Use a UUID for `clientId` / `clientMsgId`, created when the user taps "save", and keep it with the queued item.

**3. Conflict rules** (the server decides; the app follows):
- **Itinerary:** finalized versions never change. The draft belongs to the admins: send `If-Match` with the draft's `revision`. On `412`, reload the draft, show the user what changed, and let them redo the edit. Without `If-Match` the last edit wins.
- **Expenses:** the last saved edit wins. On `403` (you lost edit rights) or `404` (someone deleted it), drop the queued change and tell the user.
- **Status:** a status with an older `recordedAt` goes into the history but never replaces a newer current status.
- **Location:** if sharing ended while offline, the batch gets `409`. Drop the queue and show "Sharing ended".
- **Anything else** that fails with `400`/`403`/`404` after a retry won't succeed later either: drop it and tell the user. Retry `5xx`, `503` and network errors with backoff.

**4. SOS needs a connection.** An SOS can't reach anyone while offline. If there's no connection, keep trying in the background, and tell the user right away to call the local emergency number (112 in India).

**5. Maps offline.** There's no offline map download (dropped 2026-10-05). The app may keep the map tiles the user has already viewed in its normal cache; everything else in the trip (itinerary pins, names, dates) is in the bundle. The road line from `GET …/itinerary/route` isn't in the bundle: keep the last response, and check its `version` against the bundle's itinerary.

---

## 4. Health

### `GET /health`
Checks that the API, the database and Redis are up. Not rate-limited.

**Response 200**
```json
{ "status": "ok", "db": "connected", "redis": "connected", "version": "0.9.0", "uptimeSeconds": 5321 }
```
- `status: "degraded"` (still **200**): Redis is down, so live location is off; everything else works.
- `status: "down"` (**503**): the database is unreachable, so nothing works. Show a "server unavailable" screen and retry.
- `version`: the deployed backend version. Handy in bug reports.

---

## 5. Authentication

### Typical flow
```
signup → verify (returns tokens) → call 🔒 endpoints with the access token
      → access token expires → refresh → keep going
      → logout
```

### `GET /auth/username-available?username=jordan_r`
Checks whether a username is free. Use it for live validation on the signup form.

**Response 200**
```json
{ "username": "jordan_r", "available": true }
```
Errors: `400` if the username breaks the rules.

---

### `POST /auth/signup`
Creates an account and sends a 6-digit verification code. Provide an **email or a phone number (or both)**. If both are given, the code goes to both. An empty string (`"phone": ""`) counts as not provided.

**Request**
```json
{
  "email": "jordan@example.com",
  "phone": "+919876543210",
  "username": "jordan_r",
  "password": "S0meStrongP@ss",
  "name": "Jordan Rivera"
}
```
**Response 201**
```json
{ "userId": "3f1c…", "message": "Verification code sent" }
```
Errors:
- `400` invalid input or weak password. With neither email nor phone, the message is `["email must be an email"]`.
- `409` "An account with this email/phone already exists"
- `409` "Username is already taken"

---

### `POST /auth/verify`
Confirms the signup code and activates the account. The account can't log in until this step is done. Identify the account by the `userId` from signup, **or** by the `email` or `phone` the code was sent to.

**Request**
```json
{ "userId": "3f1c…", "code": "123456" }
```
or `{ "email": "jordan@example.com", "code": "123456" }`. Send just one identifier; if several are sent, `userId` is used.
**Response 201**
```json
{ "accessToken": "eyJ…", "refreshToken": "eyJ…" }
```
Errors:
- `400` "Invalid or expired code"
- `400` "Invalid account or code" (no account matches)
- `429` "Too many incorrect attempts. Request a new code." (after 5 wrong tries)

---

### `POST /auth/resend-verification`
Sends a new signup code to an account that isn't verified yet, e.g. because the first code was lost or expired. The response is the same whether or not the account exists. If a code was sent less than 60 seconds ago, nothing new is sent.

**Request**
```json
{ "email": "jordan@example.com" }
```
or `{ "phone": "+919876543210" }`. If the account has both, the new code goes to the email only.

**Response 201**
```json
{ "message": "If an unverified account exists, a new code has been sent" }
```

---

### `POST /auth/login`
Logs in with a password. `identifier` can be a **username, email or phone**. A phone must be in the same `+91…` format used at signup. An empty `identifier` returns `401` "Invalid credentials", not `400`.

**Request**
```json
{ "identifier": "jordan_r", "password": "S0meStrongP@ss", "rememberMe": true }
```
**Response 201**
```json
{ "accessToken": "eyJ…", "refreshToken": "eyJ…" }
```
Errors:
- `401` "Invalid credentials"
- `401` "Account not verified"

---

### `POST /auth/otp/request`
Sends a one-time login code by SMS. The response is the same whether or not the number is registered.

A user has **one pending code at a time**, shared between signup verification and OTP login. Requesting a login code replaces an unused signup code, and vice versa. Within 60 seconds of any code being sent, nothing new is sent.

**Request**
```json
{ "phone": "+919876543210" }
```
**Response 201**
```json
{ "message": "If that phone number is registered, a code has been sent" }
```

---

### `POST /auth/otp/login`
Logs in with the SMS code instead of a password.

**Request**
```json
{ "phone": "+919876543210", "code": "123456" }
```
**Response 201**: `{ "accessToken": "…", "refreshToken": "…" }`

Errors: `400` "Invalid or expired code", `401` "Invalid phone or code", `429` after 5 wrong tries.

A successful OTP login also **verifies the phone** (the code was sent to it). An account that signed up with that phone but never verified can then log in with its password too.

---

### `POST /auth/refresh`
Exchanges a refresh token for a new token pair. The old refresh token stops working.

**Request**
```json
{ "refreshToken": "eyJ…" }
```
**Response 201**: `{ "accessToken": "…", "refreshToken": "…" }`

Errors: `401` "Invalid or expired refresh token" or "Refresh token has been revoked".

---

### `POST /auth/logout` 🔒
Ends the session, so the refresh token stops working. The current access token and any open socket keep working until the access token expires (up to about 15 minutes), so the app should discard them on logout.

**Response 201**: empty body.

---

### `POST /auth/forgot-password`
Sends a 6-digit reset code by email or SMS. If both are given, the code goes to both. The response is the same whether or not the account exists.

**Request**
```json
{ "email": "jordan@example.com" }
```
or `{ "phone": "+919876543210" }`

**Response 201**
```json
{ "message": "If that account exists, a reset code has been sent" }
```

---

### `POST /auth/reset-password`
Sets a new password using the reset code. This ends the user's session: their refresh token stops working. As with logout, an existing access token lasts until it expires.

**Request**
```json
{ "email": "jordan@example.com", "code": "123456", "newPassword": "N3wStrongP@ss" }
```
**Response 201**
```json
{ "message": "Password updated" }
```
Errors: `400` "Invalid or expired reset code", or a weak new password. `429` after 5 wrong tries.

---

### `GET /auth/me` 🔒
Returns the logged-in user's profile.

**Response 200**
```json
{
  "id": "3f1c…",
  "username": "jordan_r",
  "email": "jordan@example.com",
  "phone": "+919876543210",
  "name": "Jordan Rivera",
  "avatarUrl": null,
  "emailVerified": true,
  "phoneVerified": true,
  "createdAt": "2026-09-28T09:00:00.000Z"
}
```

---

### `PATCH /auth/me` 🔒
Updates the profile. Send only the fields you want to change.

**Request**
```json
{ "username": "jordan.rides", "name": "Jordan R.", "avatarUrl": "https://example.com/a.jpg" }
```
**Response 200**: the updated profile (same shape as `GET /auth/me`).

Unlike signup, empty strings aren't ignored here: `"avatarUrl": ""` or `"username": ""` returns `400`. Leave the field out instead.

To set a photo from the phone, upload it with `POST /auth/me/avatar` (below) rather than sending `avatarUrl`. Sending an `avatarUrl` here replaces an uploaded photo (the uploaded file is deleted).

When `username`, `name` or `avatarUrl` actually changes, everyone who shares a trip with you gets **`user:profile_updated`** (§13).

Errors: `400` invalid field, `409` "Username is already taken".

### Profile picture
Members see each other's photos instead of initials. Every user object in the API (members, chat messages, typing, alerts, expenses, activities, status, presence, the live map, live-share links) already carries **`avatarUrl`**: show the image when it's set, and initials when it's `null`.

- **Loading it:** `avatarUrl` needs **no `Authorization` header**, so plain `Image.network(avatarUrl)` / `CachedNetworkImage(imageUrl: avatarUrl)` works. The URL ends in a random `?v=…` that only people who can see the user are given, and it changes with every upload.
- **Caching:** cache for good (`Cache-Control: public, max-age=31536000, immutable`). A new photo means a new URL.
- **Upload size:** crop to a square and resize before uploading (e.g. `image_picker` with `maxWidth: 512, imageQuality: 85`). The server stores the file as sent; re-encoding also removes the photo's location metadata.

#### `POST /auth/me/avatar` 🔒
Sets your profile picture, or replaces it. Send `multipart/form-data` with one field, **`file`**: a JPEG, PNG or WebP image of up to **5 MB** (the type is checked from the file's contents).

**Response 200**: your profile (same shape as `GET /auth/me`) with the new `avatarUrl`, e.g. `"http://192.168.1.20:3000/users/3f1c…/avatar?v=8d2a…"`.

Errors: `400` no `file` field, `413` over 5 MB, `415` not a JPEG/PNG/WebP image, `429` more than 30 uploads a minute.

#### `DELETE /auth/me/avatar` 🔒
Removes your picture (uploaded or set by URL); apps show initials again. **Response 200**: your profile with `avatarUrl: null`. Also 200 if there was no picture.

#### `GET /users/:userId/avatar`
The image itself (`image/jpeg`, `image/png` or `image/webp`). No auth. Use `avatarUrl` rather than building this URL. Errors: `400` `userId` isn't a UUID, `404` no uploaded picture (also after account deletion).

### `GET /auth/me/export` 🔒
Downloads **everything stored about me** (GDPR) as a JSON file (`Content-Disposition: attachment; filename="travelgo-my-data-2026-10-05.json"`): profile, groups and roles, messages and alerts I sent, my status history, expenses I paid and my shares, repayments, invites I sent and received, registered device platforms, and current location sharing. Live positions aren't stored, so they aren't in it.

**Response 200**
```json
{
  "exportedAt": "2026-10-05T10:00:00.000Z",
  "profile": { "id": "3f1c…", "username": "jordan_r", "name": "Jordan Rivera", "email": "jordan@example.com", "phone": null, "avatarUrl": null, "emailVerified": true, "phoneVerified": false, "createdAt": "…", "lastSeenAt": "…" },
  "groups": [ { "groupId": "9a2e…", "name": "Ladakh Ride 2026", "role": "ADMIN", "joinedAt": "…" } ],
  "messages": [], "statusUpdates": [], "expensesPaid": [], "expensesRecorded": [], "expenseShares": [],
  "repayments": [], "invitesSent": [], "invitesReceived": [], "devices": [], "locationSharing": [],
  "notes": [ "Live location positions are never stored: …" ]
}
```

### `DELETE /auth/me` 🔒
**Deletes my account.** Needs the current password:
```json
{ "password": "Str0ng!Pass" }
```
**Response 200**: empty body. Then clear the tokens and go back to the welcome screen.
- Personal data is erased: name, username, email, phone, photo, password and devices. The account can never log in again.
- **Group history stays readable for the others.** My messages, alerts and expenses remain in their groups, shown as **"Deleted user"**. Expense balances stay correct, and I appear in the summary with `isMember: false`.
- I leave every group. If I was the **last admin**, the member who joined earliest becomes admin. Groups where I was the **only member** are deleted.
- My open sockets are closed. The old access token is refused by `/auth/me`, and by every group route, because I'm no longer a member of anything.

Errors: `401` "Wrong password", `400` no password, `429` after 5 tries in a minute.

> Show a clear confirmation first ("This can't be undone"), and offer `GET /auth/me/export` before deleting.

---

## 6. Groups

All group endpoints are 🔒.

- **Roles:** an **Admin** can edit the group and manage members and invites. A **Viewer** has read-only access.
- **Always one admin:** a group must keep at least one Admin. Demoting, removing or leaving as the last Admin returns `409`, so promote someone else first.

**Group object** (returned by the group endpoints)
```json
{
  "id": "9a2e…",
  "name": "Ladakh Ride 2026",
  "description": "Manali → Leh → Pangong",
  "tripStart": "2026-10-10T00:00:00.000Z",
  "tripEnd": "2026-10-19T00:00:00.000Z",
  "currency": "INR",
  "createdById": "3f1c…",
  "createdAt": "2026-09-28T09:05:00.000Z",
  "closedAt": null,
  "deleteAfter": null,
  "coverImageUrl": "http://192.168.1.20:3000/groups/9a2e…/cover-image?v=5b0c…",
  "myRole": "ADMIN",
  "memberCount": 4
}
```
- `closedAt` / `deleteAfter`: set when an admin closes the trip (see "Closing a trip" below). `null` while it's open.
- `coverImageUrl`: the trip's cover image, or `null` if there isn't one (see "Cover image" below).

### `POST /groups`
Creates a group. The creator becomes its Admin. All four fields are required: `name` 1–100 characters, `description` 1–2000 characters, `tripStart`/`tripEnd` ISO 8601 dates. Optional `currency`: a 3-letter ISO 4217 code (e.g. `INR`, `USD`) used for all expenses, default `INR`.

**Request**
```json
{
  "name": "Ladakh Ride 2026",
  "description": "Manali → Leh → Pangong",
  "tripStart": "2026-10-10T00:00:00Z",
  "tripEnd": "2026-10-19T00:00:00Z"
}
```
**Response 201**: group object.

Errors: `400` for a missing or invalid field, or if `tripEnd` is before `tripStart`. The date-order check only runs once every field is valid, so fix the field errors first.

### `GET /groups`
Lists the groups you belong to, soonest `tripStart` first. **Response 200**: a list of group objects.

### `GET /groups/:groupId` · member
Returns one group. **Response 200**: group object. Errors: `404`, including for a `groupId` that isn't a valid UUID.

### `PATCH /groups/:groupId` · admin
Edits the name, description, trip dates or `currency`. Send only the fields you want to change. The currency can only change while the group has no expenses or repayments (`409` otherwise).

**Request**
```json
{ "description": "Manali → Leh → Pangong → Nubra", "tripEnd": "2026-10-20T00:00:00Z" }
```
**Response 200**: the updated group object.

If you send only one of the dates, it's checked against the saved other date, so `tripEnd` must still be on or after `tripStart`.

Every member's app gets **`group:updated`** with the new group object (§13).

Errors: `400`, `403` "Requires group role: ADMIN", `404`.

### Editing a trip
The Edit Trip screen (admins only; hide the edit buttons when `myRole` is `VIEWER` or the trip is closed) uses existing endpoints:

| What | How |
|---|---|
| Name, description, dates, currency | `PATCH /groups/:groupId` with only the changed fields |
| Cover image | `POST` / `DELETE /groups/:groupId/cover-image` |
| Stops: add, edit (name, location, date, notes), delete, reorder | 1. `POST /groups/:groupId/itinerary/draft` (starts as a copy of the current itinerary; if it returns `409` a draft already exists, so `GET …/draft` instead). 2. The pin endpoints on the draft (§9), sending the draft's `revision` as `If-Match`; on `412` reload the draft and reapply. 3. `POST …/draft/finalize` to publish, or `DELETE …/draft` to cancel |

- Members see the changes live: **`group:updated`** after a details/cover/close/reopen change, **`itinerary:updated`** after the stops are published. Refetch the itinerary (and its route) on the latter.
- Changing the trip dates doesn't move or reject stops. Stops whose `date` now falls outside the trip have **`outsideTripDates: true`**: show a warning on them so the admin can fix their dates.

### `DELETE /groups/:groupId` · admin
Deletes the group and everything in it, right away (receipt and cover image files too). **Response 200**: empty body.

### Cover image
A trip can have one optional cover image. Create the group with `POST /groups` as usual, then upload the cover with the new group's `id`.

- **Show it** with `coverImageUrl` from the group object. It's a permanent server URL: it works for every member and after an app restart. **Send the usual `Authorization: Bearer …` header when loading it**, because covers are private to the trip's members like everything else. In Flutter: `Image.network(url, headers: {'Authorization': 'Bearer $token'})`, or `CachedNetworkImage(imageUrl: url, httpHeaders: …)`.
- **Caching:** the URL ends in `?v=…`, which changes every time a new image is uploaded. So the image can be cached for good, and a new URL means a new image.
- **Upload size:** resize before uploading (e.g. `image_picker` with `maxWidth: 1600, imageQuality: 85`). The server stores the file as it is sent, and re-encoding also removes the photo's location metadata.

#### `POST /groups/:groupId/cover-image` · admin
Sets the cover image, or replaces the current one. Send `multipart/form-data` with one field, **`file`**: a JPEG, PNG or WebP image of up to **5 MB**. The type is checked from the file's contents, not its name.

**Response 200**: the group object with the new `coverImageUrl`.

Errors: `400` no `file` field, `403` not an admin, `409` the trip is closed, `413` over 5 MB, `415` not a JPEG/PNG/WebP image, `429` more than 30 uploads a minute.

#### `GET /groups/:groupId/cover-image` · member
The image itself (`Content-Type` `image/jpeg`, `image/png` or `image/webp`), with `Cache-Control: private, max-age=31536000, immutable`. Works on closed trips too. Use `coverImageUrl` rather than building this URL yourself. Errors: `404` if the trip has no cover.

#### `DELETE /groups/:groupId/cover-image` · admin
Removes the cover image. **Response 200**: the group object with `coverImageUrl: null`. It also returns 200 if there was no cover. Errors: `403`, `409` the trip is closed.

### Closing a trip
When the trip is over, an admin **closes** it (PDF §4 "group data deletion on group closure"):
- The trip becomes **read-only**. Everyone can still read everything and download the expense report, but any change (chat, expenses, status, itinerary, location sharing, invites, editing the group) returns **`409`** "This trip is closed, so it's read-only. An admin can reopen it."
- Still allowed: reopening, deleting the group, and leaving it.
- **30 days later** the trip and all its data are **deleted for good** (`deleteAfter`). Members get a push (`data.type: "GROUP_CLOSED"`, with `deleteAfter`) telling them to download what they need first.
- Show a "Closed · deleted on …" banner when `closedAt` is set, and hide the editing UI.

#### `POST /groups/:groupId/close` · admin
**Response 200**: group object with `closedAt` and `deleteAfter`. Closing again changes nothing. Closing and reopening also send `group:updated` (§13).

#### `POST /groups/:groupId/reopen` · admin
Reopens a closed trip before it's deleted. **Response 200**: group object with `closedAt: null`.

---

## 7. Members

**Member object**
```json
{
  "userId": "7b4d…",
  "username": "bob_k",
  "name": "Bob Kumar",
  "avatarUrl": null,
  "role": "VIEWER",
  "joinedAt": "2026-09-28T09:10:00.000Z"
}
```
Other members' email addresses and phone numbers are never shown.

- **Any number of admins:** one, several, or every member can be `ADMIN` at the same time. The only rule is that a group always keeps **at least one** admin.
- **Live updates** (§13): `member:joined`, `member:removed` and `member:role_changed` go to the group whenever the list changes, however it happened (added directly, invite, share link, removed, left, account deleted). Update the member list from them instead of reloading.

### `GET /groups/:groupId/members` · member
Lists the members: Admins first, then everyone else in the order they joined. **Response 200**: a list of member objects.

### `POST /groups/:groupId/members` · admin
Adds a **registered, verified** user straight into the group, with no invitation step. Identify them by **one** of `username`, `email` or `phone`. `role` is optional and defaults to `VIEWER`.

**Request**
```json
{ "username": "bob_k", "role": "VIEWER" }
```
or `{ "email": "bob@example.com" }`, or `{ "phone": "+919812345612" }`.

**Response 201**: member object.

- **Send exactly one identifier.** Two or more return `400` "Send exactly one of username, email or phone".
- **Verified means:** by username, the user has verified their email or phone. By email, that email is verified. By phone, that phone is verified.
- Adding someone directly doesn't cancel any pending invite they already have for this group.

Errors:
- `400` no identifier sent (a validation list covering `username`, `email` and `phone`), or an invalid one
- `404` "No registered TravelGo user with that username/email/phone"
- `409` "User is already a member of this group"

### `PATCH /groups/:groupId/members/:userId` · admin
Changes a member's role.

**Request**
```json
{ "role": "ADMIN" }
```
**Response 200**: member object. If the role actually changed, the group gets `member:role_changed`.

Errors: `400` "Validation failed (uuid is expected)" if `userId` isn't a UUID, `404` "Member not found", `409` for the last admin.

### `DELETE /groups/:groupId/members/:userId` · admin, or yourself
An Admin can remove anyone. Any member can **leave** by passing their own `userId`.

**Response 200**: empty body.

Errors:
- `400` `userId` isn't a UUID
- `403` a Viewer trying to remove someone else (checked first, even if that user isn't a member)
- `409` the last admin
- `404` "Member not found"

---

## 8. Invites

There are two kinds of invite:

| Type | How it works |
|---|---|
| **Share link** (`LINK`) | A link anyone can open and use to join, any number of times, until it expires or an Admin revokes it. |
| **Email / SMS** (`EMAIL`, `SMS`) | Sent to one person. It shows up in their pending invitations once they're logged in with that verified email or phone, even if they sign up after being invited. They can accept or reject it. |

Everyone who joins through an invite starts as a **Viewer**.

**Invite object**
```json
{
  "id": "c81f…",
  "groupId": "9a2e…",
  "channel": "EMAIL",
  "status": "PENDING",
  "inviteeEmail": "carol@example.com",
  "inviteePhone": null,
  "invitedBy": { "id": "3f1c…", "username": "jordan_r", "name": "Jordan Rivera" },
  "expiresAt": "2026-10-05T09:15:00.000Z",
  "createdAt": "2026-09-28T09:15:00.000Z"
}
```
`status` is one of `PENDING`, `ACCEPTED`, `REJECTED` or `REVOKED`. In the response to *creating* an invite, `invitedBy` only contains `id`.

### Admin side

#### `POST /groups/:groupId/invites` · admin
Creates an invite. `expiresInDays` is optional: a whole number (not a string) from 1 to 30, default 7. Fields that don't apply to the channel are ignored, e.g. `email` on a `LINK` invite.

**Share link**
```json
{ "channel": "LINK", "expiresInDays": 3 }
```
The response is the invite object plus the token and full link:
```json
{ "…": "…", "token": "hr2Hga8D…", "link": "https://travelgo.app/invite/hr2Hga8D…" }
```
> ⚠️ The `token` is shown **only in this response** and can't be retrieved later. To get a new link, create another one.

**Email invite**: `{ "channel": "EMAIL", "email": "carol@example.com" }`
**SMS invite**: `{ "channel": "SMS", "phone": "+919876543211" }`

**Response 201**: invite object.

Errors:
- `400` email or phone missing or invalid for the chosen channel, as a validation list, e.g. `["email must be an email"]`
- `409` "That user is already a member of this group"
- `409` they already have a pending invite

#### `GET /groups/:groupId/invites` · admin
Lists the group's pending, unexpired invites and links. **Response 200**: a list of invite objects.

#### `DELETE /groups/:groupId/invites/:inviteId` · admin
Revokes a pending invite or share link. **Response 200**: empty body. Errors: `400` if `inviteId` isn't a UUID, `404` "Pending invite not found".

### Invitee side

#### `GET /invites`
Lists **my** pending email/SMS invitations, with a short summary of each group.

**Response 200**
```json
[
  {
    "id": "c81f…",
    "groupId": "9a2e…",
    "channel": "EMAIL",
    "status": "PENDING",
    "inviteeEmail": "carol@example.com",
    "inviteePhone": null,
    "invitedBy": { "id": "3f1c…", "username": "jordan_r", "name": "Jordan Rivera" },
    "expiresAt": "…",
    "createdAt": "…",
    "group": {
      "id": "9a2e…",
      "name": "Ladakh Ride 2026",
      "description": "…",
      "tripStart": "…",
      "tripEnd": "…"
    }
  }
]
```

#### `POST /invites/:inviteId/accept`
Joins the group as a Viewer. If you're already a member, it still succeeds and nothing changes. Your other pending invites stay pending.

**Response 201**
```json
{ "groupId": "9a2e…", "status": "ACCEPTED" }
```
Errors, checked in this order:
- `400` `inviteId` isn't a UUID
- `404` the invite isn't addressed to you, or it's a share link (use the link endpoints instead)
- `409` "Invite has already been accepted" (or rejected, or revoked). This wins over expiry, so an expired invite that was already rejected returns `409`.
- `410` expired

#### `POST /invites/:inviteId/reject`
Declines the invitation. **Response 201**: `{ "groupId": "…", "status": "REJECTED" }`. Errors are the same as for accept.

#### `GET /invites/link/:token`
Shows what a share link is for, before joining.

**Response 200**
```json
{
  "group": { "id": "9a2e…", "name": "Ladakh Ride 2026", "description": "…", "tripStart": "…", "tripEnd": "…" },
  "invitedBy": { "id": "3f1c…", "username": "jordan_r", "name": "Jordan Rivera" },
  "expiresAt": "…",
  "alreadyMember": false
}
```
Errors: `404` "Invite link is invalid, revoked or expired". An expired link returns `404`, not `410`.

#### `POST /invites/link/:token/accept`
Joins the group through a share link, as a Viewer. It's safe to call twice: if you're already a member, nothing changes.

**Response 201**
```json
{ "groupId": "9a2e…" }
```
Errors: `404` "Invite link is invalid, revoked or expired".

---

## 9. Itinerary

All itinerary endpoints are 🔒 and scoped to a group: `/groups/:groupId/itinerary…`. Non-members get `404`.

**How it works**
- A group's itinerary has a **draft** and **finalized versions**.
  - Admins build and edit the **draft**, which only Admins can see.
  - **Finalizing** locks the draft as **version 1, 2, 3…**. Finalized versions can't be edited, and they're what Viewers see.
  - To change a finalized itinerary, the Admin starts a new draft. It starts as a copy of the latest version, and finalizing it creates the next version.
- **Start, middle and end points come from the order of the pins.** The first pin is the start, the last is the end, and the rest are middle stops. Dragging a pin to the top makes it the new start.
- **Every draft edit returns the whole itinerary**, because moving one pin can change the other pins' roles.

**Itinerary object**
```json
{
  "id": "5d0e…",
  "groupId": "9a2e…",
  "status": "LOCKED",
  "version": 1,
  "basedOnVersion": null,
  "revision": 4,
  "createdById": "3f1c…",
  "createdAt": "2026-09-29T08:00:00.000Z",
  "lockedAt": "2026-09-29T08:30:00.000Z",
  "waypoints": [ /* waypoint objects, in route order */ ]
}
```
- `status`: `DRAFT` or `LOCKED`.
- `version`: `null` while the itinerary is a draft.
- `basedOnVersion`: for a draft, the version it was copied from. `null` if it was started from scratch.
- `revision`: goes up by 1 with every change to the draft (send it as `If-Match`, see below). Starts at 0.

**Waypoint (pin) object**
```json
{
  "id": "1143…",
  "activityId": "c07e…",
  "position": 1,
  "role": "START",
  "name": "Leh",
  "lat": 34.1526,
  "lng": 77.5771,
  "date": "2026-10-12",
  "outsideTripDates": false,
  "notes": "Rest day for acclimatisation",
  "elevation": {
    "status": "OK",
    "meters": 3524,
    "oxygenPercentOfSeaLevel": 65,
    "effectiveOxygenPercent": 13.5,
    "zone": "VERY_HIGH"
  },
  "weather": {
    "status": "OK",
    "forecast": {
      "date": "2026-10-12",
      "summary": "light snow",
      "tempMinC": -2,
      "tempMaxC": 9,
      "precipitationChancePercent": 40,
      "windSpeedKph": 15,
      "provider": "met-norway"
    },
    "fetchedAt": "2026-10-06T09:00:00.000Z"
  },
  "activity": {
    "status": "CURRENT",
    "statusUpdatedAt": "2026-10-12T07:15:00.000Z",
    "statusUpdatedBy": { "userId": "3f1c…", "name": "Jordan Rivera" },
    "updateCount": 2
  }
}
```
- `id`: this pin in this version. A new draft copies the pins with **new** ids.
- `activityId`: the stop itself, the **same in every version** (copied into new drafts). Use it for activity status and updates (§20).
- `activity`: the stop's progress (§20). `UPCOMING` with `null`s and 0 until someone sets a status or posts an update.
- `position`: 1-based.
- `role`: `START`, `MID` or `END`.
- `date`: `YYYY-MM-DD`, or `null`.
- `outsideTripDates`: `true` when `date` is before the trip's `tripStart` day or after its `tripEnd` day, e.g. after the admin shortened the trip. Show a warning on the stop. Always `false` for a stop without a date.

**`elevation.status`**
| Status | Meaning |
|---|---|
| `OK` | Elevation is known. The object also has `meters`, `oxygenPercentOfSeaLevel` (oxygen per breath compared with sea level), `effectiveOxygenPercent`, and `zone`: `LOW` (under 1,500 m), `HIGH`, `VERY_HIGH` (3,500 m and up) or `EXTREME` (5,500 m and up). |
| `UNAVAILABLE` | The lookup failed. Use refresh to try again. |

Elevation comes from Open-Meteo, which needs no key, so in practice it's always `OK` or `UNAVAILABLE`. The app can still treat `NOT_CONFIGURED` like `UNAVAILABLE` in case that changes.

**`weather.status`**
| Status | Meaning | What the app should show |
|---|---|---|
| `OK` | `forecast` is included | The forecast |
| `NOT_YET_AVAILABLE` | The date is too far ahead to forecast (forecasts cover about 9 days). `availableFrom` is the pin date minus 8 days. | "Forecast from `availableFrom`" |
| `NO_DATE` | The pin has no date | Nothing, or "Add a date to see weather" |
| `PAST_DATE` | The date has already passed | Nothing |
| `NOT_CONFIGURED` | Weather is switched off on the server (not expected: the weather service needs no key) | Nothing |
| `UNAVAILABLE` | The provider failed, or weather hasn't been fetched for this pin yet (then `fetchedAt` is `1970-01-01T00:00:00.000Z`) | "Weather unavailable". Refresh later. |

**`forecast` fields:** `date` (the pin's date), `summary` (e.g. "light snow showers"), `tempMinC` / `tempMaxC` (whole °C), `precipitationChancePercent` (0–100, or `null` when the weather service has no rain probability for that place: hide it then), `windSpeedKph` (the day's strongest wind), `provider` (`"met-norway"`). Forecasts come from MET Norway: show **"Weather data: MET Norway"** near them (licence requirement).

**When a refresh fails**, the pin keeps its last good weather and elevation. The exception is a pin that was just moved: if its new elevation lookup fails, elevation shows `UNAVAILABLE`.

> **Reviews** (TripAdvisor/Google) aren't in the API yet. That's still an open question.

### Finalized versions (all members)

#### `GET /groups/:groupId/itinerary`
Returns the latest finalized version. **Response 200**: itinerary object. Errors: `404` "No finalized itinerary yet".

#### `GET /groups/:groupId/itinerary/versions`
Lists every finalized version, newest first.

**Response 200**
```json
[{ "id": "…", "version": 2, "lockedAt": "…", "createdById": "…", "waypointCount": 5 }]
```

#### `GET /groups/:groupId/itinerary/versions/:version`
Returns one finalized version, e.g. `/versions/1`. **Response 200**: itinerary object. Errors: `400` "Validation failed (numeric string is expected)", `404` "Itinerary version 1 not found".

#### `GET /groups/:groupId/itinerary/pdf?version=2`
Downloads a finalized version as a PDF. It defaults to the latest version if `version` is left out.

**Response 200:** the PDF file itself, with `Content-Type: application/pdf`, `Content-Disposition: attachment` and `Content-Length`. The filename is the group name in lowercase with non-alphanumerics turned into `-` (`trip` if nothing is left), plus `-itinerary-v{N}.pdf`, e.g. `ladakh-ride-2026-itinerary-v2.pdf`.

**What's in the PDF:**
- the group name, description, trip dates, version and when it was finalized
- a **map overview** drawn from OpenStreetMap, with the route (along roads, the same line as `…/itinerary/route`; straight lines if routing is unavailable) and numbered pins. It's left out if any map tile fails to load, or if the route is spread so widely that it would need more than 40 tiles.
- every stop, with its date, location, and notes. Elevation and oxygen are shown when elevation is `OK`; weather when it's `OK` or `NOT_YET_AVAILABLE`.

**Errors:** `400` if `version` isn't a number, `404` if no finalized version exists ("No finalized itinerary yet" or "Itinerary version N not found").

#### `GET /groups/:groupId/itinerary/route?version=2`
The **line for the trip map**: every stop joined to the next, in route order, **along roads** where there are roads. `version` defaults to the latest finalized version. Draw `geometry` as a polyline under the pins (e.g. `flutter_map` `PolylineLayer`, converting each `[lng, lat]` to `LatLng(lat, lng)`), and fit the camera to it.

**Response 200**
```json
{
  "itineraryId": "5d0e…",
  "itineraryStatus": "LOCKED",
  "version": 2,
  "status": "OK",
  "profile": "driving",
  "distanceMeters": 474300,
  "durationSeconds": 41820,
  "geometry": { "type": "LineString", "coordinates": [[77.1892, 32.2432], [77.1901, 32.2460], "…", [77.5771, 34.1526]] },
  "legs": [
    { "fromActivityId": "c07e…", "toActivityId": "a1b2…", "distanceMeters": 115200, "durationSeconds": 11400, "routed": true },
    { "fromActivityId": "a1b2…", "toActivityId": "77d9…", "distanceMeters": 359100, "durationSeconds": 30420, "routed": true }
  ],
  "attribution": "Routes: OSRM, © OpenStreetMap contributors",
  "computedAt": "2026-10-14T08:00:00.000Z"
}
```
- `geometry.coordinates` are **GeoJSON order, `[lng, lat]`**. The line starts at the first stop and ends at the last.
- `legs`: one per pair of consecutive stops (stop ids are `activityId`s, matching the waypoints). Use them for "115 km · 3 h 10 min" labels between stops. A stop list with 0 or 1 stops has no legs.
- `durationSeconds`: driving time. `null` on a straight-line leg, and `null` for the total when any leg is straight.
- `profile`: `driving`, or `straight` when routing is switched off on the server.

**`status`**
| Status | Meaning | What the app should show |
|---|---|---|
| `OK` | Every leg follows roads | The line |
| `PARTIAL` | Some stops can't be reached by road (e.g. across water). Those legs are straight lines with `routed: false` | The line; label those legs "no road" (no driving time) in the stop list |
| `UNAVAILABLE` | The routing service failed. The line is straight between the stops for now | The line; try again later (it isn't cached, so the next request retries) |
| `NOT_CONFIGURED` | Routing is off on the server: straight lines | The line |

The route is worked out on the first request and then cached until a stop is added, moved, removed or reordered, so it's cheap to fetch every time the trip screen opens. Refetch it after `itinerary:updated`. Show `attribution` in small print on the map.

Errors: `400` if `version` isn't a number, `404` "No finalized itinerary yet" / "Itinerary version N not found".

#### `POST /groups/:groupId/itinerary/refresh` · admin
Fetches elevation and weather again for the latest finalized version. Use it once weather starts working, or as the trip gets close enough to forecast. It changes only the weather and elevation data, never the plan. **Response 201**: itinerary object. Errors: `404` "No finalized itinerary yet".

### Draft (admins only; Viewers get `403`)

Every draft endpoint below returns `404` "No draft itinerary. Start one with POST /groups/:groupId/itinerary/draft" when there's no draft. The one exception is `DELETE …/draft`, whose message is just "No draft itinerary".

**Two admins, or edits queued offline:** send the draft's `revision` in an **`If-Match`** header on the pin endpoints (add, edit, delete, reorder) and on finalize, e.g. `If-Match: 4`. If the draft has changed since that revision, you get **`412`** "The draft has changed since you loaded it (now revision 5). Reload it, then try again." and nothing is saved. Without `If-Match`, the edit just applies (the last edit wins). `If-Match` that isn't a number returns `400`.

#### `GET /groups/:groupId/itinerary/draft`
Returns the working draft. **Response 200**: itinerary object with `status: "DRAFT"`. Errors: `404`.

#### `GET /groups/:groupId/itinerary/draft/route`
The road route through the draft's stops, so the Edit Trip map can preview it while the admin moves pins. **Response 200**: same as `GET …/itinerary/route`, with `itineraryStatus: "DRAFT"` and `version: null`. Refetch it after each pin change.

#### `POST /groups/:groupId/itinerary/draft`
Starts a draft. If a finalized version exists, the draft is a copy of the latest one; otherwise it starts empty. No request body is needed.

**Response 201**: itinerary object. Errors: `409` if the group already has a draft.

#### `DELETE /groups/:groupId/itinerary/draft`
Throws away the draft. Finalized versions aren't affected. **Response 200**: empty body.

#### `POST /groups/:groupId/itinerary/draft/waypoints`
Drops a pin. It's added as the new **end point** unless you give a `position` (for example, `1` makes it the new start).

**Request**
```json
{ "name": "Keylong", "lat": 32.5717, "lng": 77.0339, "date": "2026-10-11", "notes": "Overnight", "position": 2 }
```
- Required: `name` (1–200 characters), `lat` and `lng`.
- `date` must be a real calendar date in `YYYY-MM-DD` form (`2026-02-30` is rejected).
- `notes` is up to 2000 characters.
- `position` is a whole number, 1 or more. A position past the end just adds the pin at the end.

A draft with a single pin shows it as `START`.

**Response 201**: the whole draft.

Errors: `400` invalid field, coordinates or date, `404` no draft.

#### `PATCH /groups/:groupId/itinerary/draft/waypoints/:waypointId`
Edits a pin's name, location, date or notes. Send `"date": null` or `"notes": null` to clear them. `null` for `name`, `lat` or `lng` is ignored. Changing `lat`/`lng` fetches elevation and weather again; changing only the date fetches weather again. `position` isn't accepted here and is dropped if sent; to move a pin within the route, use the order endpoint below.

**Response 200**: the whole draft.

Errors: `400` invalid field or a `waypointId` that isn't a UUID, `404` "Waypoint not found in the draft", `404` no draft.

#### `DELETE /groups/:groupId/itinerary/draft/waypoints/:waypointId`
Deletes a pin. **Response 200**: the whole draft. Errors: `400` `waypointId` isn't a UUID, `404` "Waypoint not found in the draft", `404` no draft.

#### `PUT /groups/:groupId/itinerary/draft/waypoints/order`
Reorders the pins after a drag-and-drop. Send **every** pin id, in the new order.

**Request**
```json
{ "waypointIds": ["id-of-new-start", "…", "id-of-new-end"] }
```
**Response 200**: the whole draft. Errors: `400` if the list is empty, has duplicates or non-UUID ids (as a validation list), or doesn't match the draft's pins exactly.

#### `POST /groups/:groupId/itinerary/draft/finalize`
Locks the draft as the next version, which the whole group can then see. It needs **at least 2 pins** (a start and an end).

**Response 201**: the finalized itinerary (`status: "LOCKED"`, with `version` set). Every member's app gets **`itinerary:updated`** (§13). Errors: `400` if there are fewer than 2 pins, `404` if there's no draft.

#### `POST /groups/:groupId/itinerary/draft/refresh`
Fetches elevation and weather again for every pin in the draft. **Response 201**: the whole draft.

---

## 10. Trip status

Members mark where they are in the trip. Everyone in the group sees it live, and the full history is kept for reviewing the trip afterwards. All endpoints are 🔒 and open to **any member** (Admins and Viewers). Non-members get `404`.

| Status | Meaning |
|---|---|
| `ARRIVED` | At the destination or meeting point |
| `STOPPED` | A temporary stop or halt while travelling |
| `NEED_HELP` | Needs assistance (not an emergency; for emergencies use SOS, §15). Also pushed to the rest of the group. |
| `IN_TRANSIT` | Currently travelling |

**Status update object**
```json
{
  "id": "a3c1…",
  "groupId": "9a2e…",
  "userId": "3f1c…",
  "username": "jordan_r",
  "name": "Jordan Rivera",
  "avatarUrl": null,
  "status": "NEED_HELP",
  "note": "Flat tyre 5 km after Keylong",
  "createdAt": "2026-10-11T09:42:10.123Z"
}
```

### `POST /groups/:groupId/status`
Sets my status. `note` is optional, up to 280 characters. It's trimmed, and a blank note is saved as `null`.

For a status set **offline** and sent later (§3.8), add:
- `recordedAt`: when the user set it (ISO 8601). Up to 7 days back, not in the future (`400`). It becomes the update's `createdAt`, so an older status goes into the history but never replaces a newer current one. When applying the `status:updated` event, compare `createdAt` too.
- `clientId`: your own id (up to 64 characters). Sending the same `clientId` again returns the original update, with no second event or push.

**Request**
```json
{ "status": "NEED_HELP", "note": "Flat tyre 5 km after Keylong" }
```
**Response 201**: status update object. It's also pushed to every member's app as the `status:updated` event.

Errors: `400` for an unknown status or a note that's too long.

### `GET /groups/:groupId/status`
Returns every current member with their **latest** status, sorted by name. A member who hasn't set one has `status: null`.

**Response 200**
```json
[
  {
    "userId": "3f1c…",
    "username": "jordan_r",
    "name": "Jordan Rivera",
    "avatarUrl": null,
    "role": "ADMIN",
    "status": { "status": "NEED_HELP", "note": "Flat tyre 5 km after Keylong", "updatedAt": "…" }
  },
  {
    "userId": "7b4d…",
    "username": "bob_k",
    "name": "Bob Kumar",
    "avatarUrl": null,
    "role": "VIEWER",
    "status": null
  }
]
```

### `GET /groups/:groupId/status/history`
Returns the full history, newest first. Updates from members who have since left the group are kept too, but not those of deleted accounts.

**Query parameters** (all optional):
- `userId`: only this member's history (must be a UUID)
- `limit`: 1–200, default 50
- `before`: for the next page, pass the previous response's `nextBefore` (an ISO date)

Invalid values return `400`.

**Response 200**
```json
{ "items": [ /* status update objects */ ], "nextBefore": "2026-10-11T08:00:00.000Z" }
```
`nextBefore` is `null` on the last page.

---

## 11. Live location

Each member decides for themselves whether to share their live location with a group, and for how long. Only members of that group can see it, and only while sharing is on. The map shows each member's **latest position only**: no trail, and no history is kept. All endpoints are 🔒 and members-only.

**How the app should use it**
1. The member picks a duration, and the app calls `PUT …/location/share`.
2. While sharing, the app sends its position **every `updateIntervalSeconds` (10 s)**: `POST …/location` with one point.
3. In the background, the location plugin can queue points and send them together as a **batch**, in the same call. Only the newest point is shown.
4. Everyone in the group gets `location:updated` over the socket; see §13. The app shows a countdown from `expiresAt` / `remainingSeconds`.
5. **Sharing with several groups:** sharing is switched on per group, but the app only needs **one** position loop: `POST /location` sends each point to every group the user currently shares with, **and** to their live links for people outside the app (§21). `GET /location/sharing` lists the groups.
6. When time runs out, the server turns sharing off. The member gets the `location:share-expired` socket event **and** a push notification, "Live location sharing ended". Any later `POST …/location` returns `409`, which is the app's signal to stop sending.

**Durations:** `ONE_HOUR`, `FOUR_HOURS`, `EIGHT_HOURS`, or `ALWAYS`, which stays on until the member turns it off.

> Needs Redis on the server. If it's down, these endpoints return **503** "Live location is temporarily unavailable".

### `PUT /groups/:groupId/location/share`
Starts sharing, or changes the duration. The timer restarts from now.

**Request**
```json
{ "duration": "FOUR_HOURS" }
```
**Response 200**
```json
{
  "sharing": true,
  "duration": "FOUR_HOURS",
  "startedAt": "2026-10-10T06:00:00.000Z",
  "expiresAt": "2026-10-10T10:00:00.000Z",
  "remainingSeconds": 14400,
  "updateIntervalSeconds": 10
}
```
For `ALWAYS`, `expiresAt` and `remainingSeconds` are `null`.

### `GET /groups/:groupId/location/share`
Returns my sharing state in this group. If sharing is off: `{ "sharing": false, "updateIntervalSeconds": 10 }`.

### `DELETE /groups/:groupId/location/share`
Stops sharing now. My pin disappears from everyone's map. **Response 200**: `{ "sharing": false, "updateIntervalSeconds": 10 }`. It's safe to call even when sharing is already off.

### `POST /groups/:groupId/location`
Sends my position while I'm sharing. Send **1 point** normally, or a **batch of up to 100** queued by a background plugin.

**Request**
```json
{
  "points": [
    {
      "lat": 32.2432,
      "lng": 77.1892,
      "accuracy": 8.5,
      "heading": 45,
      "speed": 12.3,
      "recordedAt": "2026-10-10T08:30:00.000Z"
    }
  ]
}
```
- Required: `lat` and `lng`.
- Optional: `accuracy` (meters), `heading` (0–360°), `speed` (m/s), and `recordedAt`, which defaults to now.

**Response 201**
```json
{ "accepted": 1, "latest": { "lat": 32.2432, "lng": 77.1892, "accuracy": 8.5, "heading": 45, "speed": 12.3, "recordedAt": "…" } }
```
- **Which point wins:** only the newest point is kept and broadcast. Points older than the current pin are ignored, so late batches don't move the pin backwards.
- **Dropped points:** anything recorded **before sharing started** is never published.

Errors:
- `409` sharing is off or has expired, so stop sending
- `400` invalid coordinates, or 0 or more than 100 points

### `POST /location`
Sends your position to **every group you're sharing with right now** (change request v1.0, change 2). Same body and rules as `POST /groups/:groupId/location`: one point or a batch of up to 100; each group keeps only the newest point.

**Response 201**
```json
{ "groups": [ { "groupId": "9a2e…", "accepted": 1, "latest": { "lat": 32.7, "lng": 77.1, "accuracy": null, "heading": null, "speed": null, "recordedAt": "…" } } ] }
```
`liveLinks` is `{ active, latest }` when you have live links for people outside the app (§21), else `null`.

Errors: `409` "Location sharing is off. Start sharing first." when you share with no group **and** have no active live link (stop the loop), `400` invalid points, `503` Redis down.

### `GET /location/sharing`
The groups you're sharing with right now.

**Response 200**
```json
{ "updateIntervalSeconds": 10, "groups": [ { "groupId": "9a2e…", "groupName": "Ladakh Ride", "duration": "ONE_HOUR", "startedAt": "…", "expiresAt": "…", "remainingSeconds": 2710 } ] }
```

### `GET /groups/:groupId/location`
Returns the **group map**: every member, with their trip status, sharing timer and live pin.

**Response 200**
```json
{
  "updateIntervalSeconds": 10,
  "members": [
    {
      "userId": "7b4d…",
      "username": "bob_k",
      "name": "Bob Kumar",
      "avatarUrl": null,
      "role": "VIEWER",
      "tripStatus": { "status": "IN_TRANSIT", "note": null, "updatedAt": "…" },
      "sharing": { "duration": "ONE_HOUR", "startedAt": "…", "expiresAt": "…", "remainingSeconds": 2710 },
      "location": { "lat": 32.25, "lng": 77.19, "accuracy": 6, "heading": 30, "speed": 11.5, "recordedAt": "…" }
    },
    {
      "userId": "3f1c…",
      "username": "jordan_r",
      "name": "Jordan Rivera",
      "avatarUrl": null,
      "role": "ADMIN",
      "tripStatus": null,
      "sharing": null,
      "location": null
    }
  ]
}
```
- `sharing: null`: that member isn't sharing.
- `location: null` while sharing: no position has arrived yet.
- `location.recordedAt` is the "last updated" time to show on the pin.

---

## 12. Push notifications (devices)

The app registers each phone so the server can send it push notifications: "sharing ended", chat messages, alerts and SOS (payloads in §14 and §15). Setup: `docs/FIREBASE_SETUP.md`.

### `POST /devices` 🔒
Registers this device. Call it after login, and again whenever Firebase issues a new token. If the same token was registered under another user (the phone changed hands), it moves to the current user.

**Request**
```json
{ "token": "<FCM registration token>", "platform": "ANDROID" }
```
- `platform` is `ANDROID`, `IOS` or `WEB`.
- `token` is 10–4096 characters.
- Registering the same token again is safe and updates its `platform`.

**Response 201**: `{ "registered": true }`

### `DELETE /devices` 🔒
Stops push notifications to this device. **Call it before logout.**

**Request**
```json
{ "token": "<FCM registration token>" }
```
**Response 200**: empty body, even if the token wasn't registered (or belongs to another user). Nothing changes in that case.

**Push payload** for "sharing ended":
- title: "Live location sharing ended"
- `data`: `{ "type": "LOCATION_SHARE_EXPIRED", "groupId": "…" }`, which the app can use to open that group's map

---

## 13. Realtime (live updates)

The app gets live updates over **socket.io**, on the same address as the API.

```js
import { io } from 'socket.io-client';
const socket = io('http://localhost:3000', { auth: { token: accessToken } });
```
In Flutter, use the `socket_io_client` package and send the same `auth: { token }`.

| Event (server → app) | Payload | When |
|---|---|---|
| `ready` | `{ userId }` | You're connected and will now receive events |
| `status:updated` | status update object | A member of one of your groups changed their status |
| `location:updated` | `{ groupId, userId, lat, lng, accuracy, heading, speed, recordedAt }` | A sharing member's position moved |
| `location:sharing-started` | `{ groupId, userId, username, name, duration, startedAt, expiresAt }` | A member started (or changed) sharing |
| `location:sharing-stopped` | `{ groupId, userId, reason: "STOPPED" \| "EXPIRED" \| "REMOVED" }` | A member's pin should disappear (`REMOVED`: they were removed from the group, left, or deleted their account) |
| `location:share-expired` | `{ groupId, groupName, duration }` | **Only to you:** your sharing just ran out (a push is sent too) |
| `chat:message` | message object (§14) | A new chat message or alert in one of your groups (your own too) |
| `chat:typing` | `{ groupId, userId, username, name, avatarUrl, isTyping }` | Someone else in the group started/stopped typing |
| `chat:read` | `{ groupId, userId, lastReadMessageId, lastReadAt }` | A member's read marker moved (update ticks) |
| `alert:raised` | alert object (§15) | A GENERAL / CRITICAL / SOS alert: show the banner |
| `alert:acknowledged` | `{ groupId, alertId, type, userId, username, name, avatarUrl, ackedAt, ackCount, pendingCount }` | A member acknowledged a CRITICAL / SOS alert |
| `alert:resolved` | `{ groupId, alertId, type, resolvedAt, resolvedBy }` | A CRITICAL / SOS alert is over: remove the banner |
| `presence:updated` | `{ userId, online, lastSeenAt }` | Someone who shares a group with you came online / went offline (§16) |
| `expense:created` | `{ groupId, expenseId, byUserId, timestamp, expense }` | An expense was added (§17). `expense` is the expense object **without** `myShare` and `canEdit` (work those out from `splits` and your role). Reload the summary |
| `expense:updated` | `{ groupId, expenseId, byUserId, timestamp, expense }` | An expense was edited, or its receipt changed. Same `expense` as above |
| `expense:deleted` | `{ groupId, expenseId, byUserId, timestamp }` | An expense was deleted |
| `expense:settlement_recorded` | `{ groupId, settlementId, byUserId, timestamp }` | A repayment was recorded. Reload the repayments/summary |
| `expense:settlement_deleted` | `{ groupId, settlementId, byUserId, timestamp }` | A repayment was deleted |
| `activity:status_updated` | `{ groupId, activityId, status, updatedBy, timestamp }` | An admin changed a stop's status (§20). Making one stop `CURRENT` also sends `COMPLETED` for the previous one |
| `activity:update_added` | `{ groupId, activityId, updateId, update, timestamp }` | A member posted an update about a stop. `update` = update object without `canEdit` / `canDelete` |
| `activity:update_edited` | `{ groupId, activityId, updateId, update, timestamp }` | The author changed the text |
| `activity:update_deleted` | `{ groupId, activityId, updateId, deletedBy, timestamp }` | An update was deleted: remove it |
| `member:joined` | `{ groupId, member, via: "DIRECT" \| "INVITE" \| "LINK", addedBy, timestamp }` | Someone joined one of your groups (`member` = member object, §7). `addedBy`: the admin who added or invited them |
| `member:removed` | `{ groupId, userId, removedBy, left, timestamp }` | A member was removed (`left: false`) or left (`left: true`). **Also sent to the person removed**, so their app can drop the trip. `removedBy` is the user themself when they left or deleted their account |
| `member:role_changed` | `{ groupId, userId, newRole, changedBy, timestamp }` | A member became `ADMIN` or `VIEWER`. `changedBy: null` = automatic (an admin deleted their account and the longest-standing member was promoted) |
| `group:updated` | `{ groupId, group, changedBy, timestamp }` | An admin edited the trip (name, description, dates, currency), changed its cover image, or closed/reopened it. `group` = group object **without** `myRole` (keep yours). Replace your copy of the trip |
| `itinerary:updated` | `{ groupId, version, lockedAt }` | An admin published a new itinerary version. Refetch `GET …/itinerary` and `…/itinerary/route` |
| `user:profile_updated` | `{ userId, username, name, avatarUrl, timestamp }` | Someone who shares a trip with you (or you, on another device) changed their name, username or profile picture. Update them everywhere they're shown |
| `location_share:started` | `{ id, recipientLabel, duration, startedAt, expiresAt, … }` | **Only to you:** you created a live link (§21), e.g. on another of your devices |
| `location_share:stopped` | `{ sessionId, reason: "STOPPED" \| "EXPIRED", endedAt }` | **Only to you:** one of your live links ended |
| `session:expired` | – | Your access token expired and the server disconnected you. Refresh the token and reconnect. |

- **Sending the token:** use `auth: { token }` (a leading `Bearer ` is accepted and stripped), or an `Authorization: Bearer <token>` handshake header.
- **Connection refused:** a missing or invalid token gives `connect_error` with the message `"Unauthorized"`.
- **On `session:expired`** the server closes the socket for good, so socket.io won't reconnect by itself. Refresh the token and call `connect()` again, as in §3.2.
- **Who receives what:** you only get events for groups you're **currently** a member of. After you're removed from a group, its events stop immediately.
- **App → server events** (`chat:send`, `chat:typing`, `chat:read`) are in §14. They answer through the acknowledgement callback.

---

## 14. Chat

Real-time group chat. Every member (Admin or Viewer) can read and write. **Sending goes over the socket** (`chat:send`), except voice messages, which are uploaded over HTTP; history, search and read receipts are also available over HTTP.

**What chat carries** (change request v1.0, change 8): **text** (emoji are just text), **locations** and **voice messages**. There are **no** image, file, document or video messages, and none will be added. Alerts and SOS (§15) appear in the same timeline, with their `type`. Non-members get `404` everywhere, over HTTP and over the socket.

**Message object** (the same shape for chat messages and alerts)
```json
{
  "id": "5d0e…",
  "groupId": "9a2e…",
  "type": "NORMAL",
  "kind": "TEXT",
  "category": null,
  "body": "Reached Kaza, fuel up here",
  "clientMsgId": "c7f3…",
  "sender": { "userId": "7b4d…", "username": "bob_k", "name": "Bob Kumar", "avatarUrl": null },
  "location": null,
  "voice": null,
  "createdAt": "2026-10-11T09:42:10.123Z",
  "readByCount": 2
}
```
- `type`: `NORMAL` (chat), or an alert type: `GENERAL`, `CRITICAL`, `SOS` (§15). Alerts also carry an `alert` object (§15).
- `kind`: `TEXT`, `LOCATION` or `VOICE`. Alerts are always `TEXT`.
  - `LOCATION`: `location` = `{ lat, lng, accuracy, label, recordedAt, source: "DEVICE" }`; `body` is an optional caption (`""` if none). Show a map pin; tapping can open the phone's maps app.
  - `VOICE`: `voice` = `{ durationMs, contentType }` and `body` is `""`. Play it from `GET /groups/:groupId/messages/:messageId/voice`.
- `location` is also set on SOS alerts (where it was raised, §15).
- `readByCount`: how many **current** members, other than the sender, have read up to this message. Use it for ticks, e.g. "read by all" when it equals member count − 1.
- `clientMsgId`: your own id for the message, echoed back (see `chat:send`). `null` if you didn't send one.

### Socket: sending, typing, reading
Each event replies through the socket.io **acknowledgement** callback:
```dart
socket.emitWithAck('chat:send', {'groupId': gid, 'body': text, 'clientMsgId': localId})
  .then((res) { /* res['ok'] == true ? res['data'] : res['error'] */ });
```
The reply is `{ "ok": true, "data": … }` or `{ "ok": false, "error": { "status": 400, "message": "body is required" } }`. `status` uses the same codes as HTTP (`400` invalid, `404` not a member, `500` server error).

| Event (app → server) | Payload | Reply `data` | What happens |
|---|---|---|---|
| `chat:send` | `{ groupId, body, clientMsgId? }`, or for a location `{ groupId, kind: "LOCATION", location: { lat, lng, accuracy?, label? }, body?, clientMsgId? }` | message object | Saved, then sent to the whole group (you too, for your other devices) as `chat:message` |
| `chat:typing` | `{ groupId, isTyping }` | `{ groupId, isTyping }` | The rest of the group gets `chat:typing` |
| `chat:read` | `{ groupId, messageId }` | same as `GET …/messages/unread` | Everything up to `messageId` is read. The group gets `chat:read` if your marker moved |

- **`body`**: trimmed, 1–2000 characters. Required for text; an optional caption for a location.
- **`location.label`**: up to 100 characters (a place name). `location` without `kind: "LOCATION"` is a `400`.
- **Voice messages** can't be sent over the socket: use `POST …/messages/voice` (below).
- **Limit:** 20 messages per 10 seconds per user. Faster sends get the ack `{ ok: false, error: { status: 429, message: "You're sending messages too fast. Wait a few seconds." } }`. On a closed trip, `chat:send` returns `409`.
- **`clientMsgId`** (optional, 1–64 characters): generate one per message (a UUID is fine) and show a "sending…" bubble. If the send times out, **resend with the same `clientMsgId`**: you get the original message back and nothing is duplicated or re-broadcast.
- **Typing:** send `isTyping: true` when the user starts typing and **again every ~3 s** while they keep typing, then `false` when they stop or send. The server stores nothing and never sends a "stopped" on your behalf, so on the receiving side hide the indicator if no `chat:typing` arrives for ~5 s.
- **Reading:** when the chat screen is open, send `chat:read` with the newest visible message. Markers only move forward, so sending an older id changes nothing.
- **Sending counts as reading:** your marker moves to your own message.

### `GET /groups/:groupId/messages`
History, **oldest first within a page** (chat order). The first call returns the newest page.

**Query parameters** (all optional):
- `limit`: 1–100, default 50
- `before`: for older messages, pass the previous response's `nextBefore` (a message id). An id that isn't a message in this group returns `400`.
- `search`: only messages containing this text, case-insensitive, 2–100 characters. `%` and `_` are matched literally.

**Response 200**
```json
{ "items": [ /* message objects, oldest first */ ], "nextBefore": "5d0e…" }
```
`nextBefore` is `null` when there are no older messages. New members see the group's whole history, including messages from before they joined.

### `POST /groups/:groupId/messages/voice`
Sends a voice message. **`multipart/form-data`** with:
- `file`: the recording. **AAC in M4A/MP4** (what iOS and most Android recorders produce), raw **AAC**, or **Ogg/Opus**; at most **2 MB**. The type is checked from the file's contents; an MP4 with a video track is refused.
- `durationMs`: the recording's length in milliseconds, 1–120,000 (**2 minutes max**).
- `clientMsgId` (optional): like `chat:send`, resending it returns the original message.

**Response 201**: message object with `kind: "VOICE"`. The group gets `chat:message`; offline members get a push "Bob Kumar: 🎤 Voice message".

Errors: `400` no file / bad `durationMs`, `413` over 2 MB, `415` not an accepted audio recording, `409` closed trip, `404` not a member. 30 uploads a minute per IP.

### `GET /groups/:groupId/messages/:messageId/voice`
The recording, with its `Content-Type` (`audio/mp4`, `audio/aac` or `audio/ogg`). Members only. `404` if the message isn't a voice message in this group.

### `GET /groups/:groupId/messages/unread`
My unread count, for badges. Unread = messages from others after my read marker (or, if I've never read, since I joined).

**Response 200**
```json
{ "unreadCount": 3, "lastReadMessageId": "5d0e…", "lastReadAt": "2026-10-11T09:42:10.123Z" }
```

### `POST /groups/:groupId/messages/read`
The HTTP version of `chat:read`, e.g. when the user opens the chat from a push.

**Request**
```json
{ "messageId": "5d0e…" }
```
**Response 200**: same as `…/unread`. Errors: `404` if the message isn't in this group.

### `GET /groups/:groupId/messages/:messageId/reads`
Read receipts for one message ("Seen by"). Lists current members other than the sender, sorted by name.

**Response 200**
```json
{
  "messageId": "5d0e…",
  "readBy": [ { "userId": "3f1c…", "username": "jordan_r", "name": "Jordan Rivera", "avatarUrl": null } ],
  "notReadYet": [ { "userId": "a91f…", "username": "dave_s", "name": "Dave Singh", "avatarUrl": null } ]
}
```
Errors: `400` for a malformed id, `404` if the message isn't in this group.

### Push notifications for chat
Chat messages are pushed **only to members who are offline** (no socket connected). Online members get `chat:message` instead.
- title: the group name; body: `"<sender name>: <text>"` (cut to 120 characters)
- `data`: `{ "type": "CHAT_MESSAGE", "groupId": "…", "messageId": "…" }`

---

## 15. Alerts & SOS

Three alert types (PDF §2.5). They're sent over **HTTP**, so the app gets a clear success or failure, even from the background. Each alert is also a message in the chat timeline (§14).

| Type | Who can send | Pushed to | Needs acknowledging | Banner |
|---|---|---|---|---|
| `GENERAL` | Admins | everyone else | no | optional, never "active" |
| `CRITICAL` | Admins | everyone else | yes | until resolved (by an admin) |
| `SOS` | **Any member** | everyone else | yes | red, until resolved (by the sender or an admin) |

Alerts are pushed to **every** other member, online or not. The group also gets `alert:raised` (show the banner) and `chat:message` (the timeline).

> **SOS disclaimer (draft, needs sign-off; PDF §8).** The app must show this before the first SOS, and near the SOS button:
> *"SOS alerts your trip group only. It does not contact the police, ambulance or any emergency service. In an emergency, call your local emergency number (112 in India)."*

**Alert object** = message object (§14) plus `alert`:
```json
{
  "id": "e41b…",
  "type": "SOS",
  "category": null,
  "body": "Bike skidded near Losar, ankle hurt",
  "location": { "lat": 32.437, "lng": 77.749, "accuracy": 15, "recordedAt": "2026-10-11T09:42:10.000Z", "source": "DEVICE" },
  "sender": { "userId": "7b4d…", "username": "bob_k", "name": "Bob Kumar", "avatarUrl": null },
  "createdAt": "2026-10-11T09:42:10.123Z",
  "readByCount": 0,
  "alert": {
    "requiresAck": true,
    "active": true,
    "ackCount": 1,
    "pendingCount": 3,
    "acknowledgedByMe": false,
    "resolvedAt": null,
    "resolvedBy": null
  }
}
```
- `active`: an unresolved `CRITICAL` or `SOS`, so show the banner. Always `false` for `GENERAL`.
- `ackCount` / `pendingCount`: current members **other than the sender** who have / haven't acknowledged. `0` / `0` for `GENERAL`.
- `acknowledgedByMe`: personal to the caller. In socket events it's always `false`.
- `category` (`CRITICAL` only): `WEATHER`, `ROAD_CLOSURE`, `SAFETY` or `OTHER`.
- `location` (`SOS` only): `source` is `DEVICE` (sent by the app) or `LIVE_SHARE` (the sender's live-location position). `null` if neither was available.

### `POST /groups/:groupId/alerts` · admin
Sends a `GENERAL` announcement or a `CRITICAL` alert.

**Request**
```json
{ "type": "CRITICAL", "category": "ROAD_CLOSURE", "body": "Kunzum La closed, stay in Kaza tonight" }
```
- `body`: trimmed, 1–1000 characters.
- `category`: **required** for `CRITICAL`, **not allowed** for `GENERAL`.

**Response 201**: alert object. Errors: `400` (missing category, category on `GENERAL`, or `type: "SOS"`, which has its own route), `403` for Viewers.

### `POST /groups/:groupId/alerts/sos` · member
Raises an SOS. **Every field is optional**, so one tap works.

**Request**
```json
{ "body": "Bike skidded near Losar, ankle hurt", "lat": 32.437, "lng": 77.749, "accuracy": 15 }
```
- `body`: up to 500 characters. Default: `"SOS: I need help"`.
- `lat` + `lng` (send both or neither), `accuracy` in metres: the phone's current position. **Send it if you have it.** Without it, the server uses the sender's live-location position if they're sharing with this group; otherwise `location` is `null`.
- **One active SOS per member per group:** raising another while yours is still active returns the **same** SOS (no duplicate, no second push). Resolve it first to raise a new one.

**Response 201**: alert object. Errors: `400` for `lat` without `lng` (or the reverse) or invalid coordinates.

### `GET /groups/:groupId/alerts`
Alerts, **newest first**. **Call this with `active=true` when the app starts or reconnects** to show banners you missed.

**Query parameters** (all optional):
- `active`: `true` = unresolved `CRITICAL` / `SOS` only; `false` = everything else
- `type`: `GENERAL`, `CRITICAL` or `SOS`
- `limit`: 1–100, default 20
- `before`: the previous response's `nextBefore` (an alert id)

**Response 200**
```json
{ "items": [ /* alert objects, newest first */ ], "nextBefore": null }
```

### `GET /groups/:groupId/alerts/:alertId`
One alert, plus who has acknowledged it and who hasn't (for the sender's "seen by" view).

**Response 200**: alert object, plus:
```json
{
  "acknowledgements": [ { "userId": "3f1c…", "username": "jordan_r", "name": "Jordan Rivera", "avatarUrl": null, "ackedAt": "…" } ],
  "pending": [ { "userId": "a91f…", "username": "dave_s", "name": "Dave Singh", "avatarUrl": null } ]
}
```
Both lists are empty for `GENERAL`. Errors: `400` malformed id, `404` not an alert in this group (chat messages aren't alerts).

### `POST /groups/:groupId/alerts/:alertId/ack`
"I've seen it", for `CRITICAL` and `SOS`. Safe to call twice (the first time is kept).

**Response 200**: alert object with `acknowledgedByMe: true`. The group gets `alert:acknowledged`. For an SOS the sender also gets a push: "Jordan Rivera saw your SOS".

Errors: `400` for a `GENERAL` alert or your own alert, `404` unknown alert.

### `POST /groups/:groupId/alerts/:alertId/resolve`
Ends a `CRITICAL` / `SOS` alert, so the banner goes away. An **SOS** can be resolved by its **sender** ("I'm safe") or **any admin**; a **CRITICAL** alert by **admins** only. Resolving twice returns the alert unchanged.

**Response 200**: alert object with `active: false`, `resolvedAt` and `resolvedBy`. The group gets `alert:resolved`. For an SOS, everyone except the resolver gets a push ("Bob Kumar is safe", or "SOS from Bob Kumar resolved" when an admin resolved it).

Errors: `400` for `GENERAL`, `403` not allowed (see above), `404` unknown alert.

### Push payloads
| `data.type` | Sent to | Title |
|---|---|---|
| `SOS` | everyone but the sender | "SOS from Bob Kumar" (body "&lt;group&gt;: &lt;text&gt;"); `data` also has `lat`/`lng` when known |
| `CRITICAL_ALERT` | everyone but the sender | "Critical alert: &lt;group&gt;"; `data.category` |
| `GENERAL_ALERT` | everyone but the sender | the group name |
| `SOS_ACKNOWLEDGED` | the SOS sender | "Jordan Rivera saw your SOS" |
| `SOS_RESOLVED` | everyone but the resolver | "Bob Kumar is safe" |
| `STATUS_NEED_HELP` | everyone but the member | "Bob Kumar needs help" (from `POST …/status`, §10) |

All alert pushes include `groupId` and `alertId`, so the app can open the right banner.

---

## 16. Presence (online / offline)

Shows which members have the app connected right now. A member is **online** while at least one of their devices has the socket connected (§13). Nothing to send: connecting and disconnecting the socket is enough.

### `GET /groups/:groupId/presence`
**Response 200**: every current member, online first, then by name.
```json
[
  { "userId": "3f1c…", "username": "jordan_r", "name": "Jordan Rivera", "avatarUrl": null, "online": true, "lastSeenAt": null },
  { "userId": "a91f…", "username": "dave_s", "name": "Dave Singh", "avatarUrl": null, "online": false, "lastSeenAt": "2026-10-11T09:40:02.511Z" }
]
```
`lastSeenAt` is when the member's last connection closed; `null` while online or if they've never connected.

**Live changes** arrive as `presence:updated` `{ userId, online, lastSeenAt }`. They go to everyone who shares a group with that member (one event, not one per group).
- **Offline is announced 5 s late:** if the member reconnects within 5 s (token refresh, network blip), nobody sees them go offline.
- Load the list when opening a screen and after reconnecting, then apply the events.

---

## 17. Expenses

Members record shared costs, split them, and see who owes whom (PDF §2.7). All endpoints are 🔒 and members-only (non-members get `404`).

- **Who can do what:** **every member** can add expenses, record repayments, and see everything. Only **whoever recorded** an expense, or an **admin**, can edit or delete it, or change its receipt. Each expense has `canEdit` so the app can show or hide the buttons.
- **Money:** amounts are JSON numbers with **at most 2 decimals** (`1200`, `450.5`, `100.01`), from 0.01 to 10,000,000. They're in the **group's currency** (`currency` on the group, default `INR`). The server calculates in paise, so splits always add up exactly.
- **Who paid, who shares:** each expense has its **own** list of people sharing it (`splitBetween` / `shares`), so nobody is included unless chosen, and one person or **several** people can have paid it (`paidBy` / `payments`). Balances count only those people.
- **Live updates:** `expense:created`, `expense:updated`, `expense:deleted` and `expense:settlement_recorded` / `expense:settlement_deleted` go to the group (§13). The created/updated events carry the expense itself.

**Categories:** `ACCOMMODATION`, `FUEL`, `FOOD`, `TRANSPORT`, `ACTIVITIES`, `SHOPPING`, `PERMITS_FEES`, `OTHER`.

**Expense object**
```json
{
  "id": "c1d2…",
  "groupId": "9a2e…",
  "amount": 900,
  "currency": "INR",
  "category": "FUEL",
  "date": "2026-10-11",
  "description": "Diesel at Tandi",
  "splitType": "EQUAL",
  "paidBy": { "userId": "3f1c…", "username": "jordan_r", "name": "Jordan Rivera", "avatarUrl": null },
  "payments": [
    { "userId": "3f1c…", "username": "jordan_r", "name": "Jordan Rivera", "avatarUrl": null, "amount": 900 }
  ],
  "createdBy": { "userId": "3f1c…", "username": "jordan_r", "name": "Jordan Rivera", "avatarUrl": null },
  "splits": [
    { "userId": "7b4d…", "username": "bob_k", "name": "Bob Kumar", "avatarUrl": null, "amount": 300 },
    { "userId": "a91f…", "username": "dave_s", "name": "Dave Singh", "avatarUrl": null, "amount": 300 },
    { "userId": "3f1c…", "username": "jordan_r", "name": "Jordan Rivera", "avatarUrl": null, "amount": 300 }
  ],
  "myShare": 300,
  "hasReceipt": false,
  "receiptContentType": null,
  "canEdit": true,
  "createdAt": "2026-10-11T09:42:10.123Z",
  "updatedAt": "2026-10-11T09:42:10.123Z"
}
```
- `date`: the day the money was spent (not when it was recorded).
- `payments`: everyone who paid and how much, biggest first. They always add up to `amount`. One entry when one person paid.
- `paidBy`: the **main** payer, i.e. whoever paid the most (on a tie, the first one sent). Handy for a one-line "Paid by Jordan +1". `createdBy`: who recorded it (it can be different).
- `splits`: everyone's part, sorted by name. They always add up to `amount`.
- `myShare`: your part, `0` if you're not in the split.

### `POST /groups/:groupId/expenses`
Records an expense.

**Request: equal split**
```json
{
  "amount": 900,
  "category": "FUEL",
  "date": "2026-10-11",
  "description": "Diesel at Tandi",
  "splitType": "EQUAL",
  "splitBetween": ["3f1c…", "7b4d…", "a91f…"]
}
```
**Request: custom split, paid by someone else**
```json
{
  "amount": 1000,
  "category": "ACCOMMODATION",
  "date": "2026-10-12",
  "paidBy": "a91f…",
  "splitType": "CUSTOM",
  "shares": [ { "userId": "3f1c…", "amount": 600 }, { "userId": "a91f…", "amount": 400 } ]
}
```
**Request: several people paid**
```json
{
  "amount": 900,
  "category": "ACTIVITIES",
  "date": "2026-10-14",
  "splitType": "EQUAL",
  "splitBetween": ["3f1c…", "7b4d…", "a91f…"],
  "payments": [ { "userId": "3f1c…", "amount": 600 }, { "userId": "7b4d…", "amount": 300 } ]
}
```
- **Required:** `amount`, `category`, `date` (`YYYY-MM-DD`), `splitType`.
- `description`: optional, up to 500 characters.
- `clientId`: optional, your own id for the expense (up to 64 characters, e.g. a UUID). Sending the same `clientId` again returns the **original** expense instead of a duplicate, e.g. when an offline queue retries (§3.8). It's per person: two people can use the same value.
- `paidBy`: a member's user id, who paid the **whole** amount. Defaults to you.
- `payments`: instead of `paidBy`, when several people paid: one entry per member, **adding up exactly** to `amount`. Sending both `paidBy` and `payments` is a `400`.
- `EQUAL`: `splitBetween` is optional and defaults to **every current member**. The app should show the member checkboxes so the user picks who shares it. Leftover paise go to the first people in the list: 100.01 between 2 → 50.01 and 50.00.
- `CUSTOM`: `shares` is required, one entry per member, and must **add up exactly** to `amount`.
- Everyone in `paidBy`, `payments`, `splitBetween` and `shares` must be a current member.

**Response 201**: expense object. Errors: `400` with a clear message, e.g. `"shares add up to 60.00, but the amount is 100.00"`, `"payments add up to 600.00, but the amount is 900.00"`, `"Send paidBy (one payer) or payments (several), not both"`, `"Everyone in splitBetween must be a member of the group"`, `"shares is only for CUSTOM splits (use splitBetween for EQUAL)"`, or more than 2 decimals.

### `GET /groups/:groupId/expenses`
Lists expenses, **newest day first** (same day: newest recorded first).

**Query parameters** (all optional):
- `category`: one category
- `paidBy`: a user id, for expenses they paid (all or part of)
- `involving`: a user id, for expenses they paid **or** share in (use your own id for "my expenses")
- `from`, `to`: `YYYY-MM-DD`, inclusive
- `limit`: 1–100, default 50
- `before`: the previous response's `nextBefore` (an expense id). An id from another group returns `400`.

**Response 200**
```json
{ "items": [ /* expense objects */ ], "nextBefore": null }
```

### `GET /groups/:groupId/expenses/:expenseId`
One expense. **Response 200**: expense object. Errors: `400` malformed id, `404`.

### `PATCH /groups/:groupId/expenses/:expenseId` · recorder or admin
Edits an expense. Send only what changes, with the same fields and rules as `POST`. `"description": null` clears it.
- Changing the `amount` of an `EQUAL` expense **re-splits it between the same people**.
- A `CUSTOM` expense needs new `shares` whenever the amount or split changes (`400` otherwise).
- **Payers:** send `paidBy` or `payments` to replace who paid. If only the `amount` changes, a single payer simply paid the new amount; an expense **several people paid** needs new `payments` (`400` "Send the new payments when changing the amount of an expense several people paid").
- People already in the split or among the payers can stay even if they've left the group.

**Response 200**: expense object. Errors: `400`, `403` (not the recorder or an admin), `404`.

### `DELETE /groups/:groupId/expenses/:expenseId` · recorder or admin
Deletes the expense and its receipt. **Response 200**: empty body.

### Receipts
One receipt per expense: a photo (JPEG, PNG, WebP, HEIC) or a PDF invoice, **max 5 MB**. The type is checked from the file's contents, not its name.

#### `PUT /groups/:groupId/expenses/:expenseId/receipt` · recorder or admin
Uploads or replaces the receipt as **`multipart/form-data`** with the file in the field **`file`**:
```dart
final form = FormData.fromMap({'file': await MultipartFile.fromFile(path, filename: 'receipt.jpg')});
await dio.put('/groups/$gid/expenses/$eid/receipt', data: form);
```
**Response 200**: expense object with `hasReceipt: true` and `receiptContentType`. Errors: `400` no file, `413` over 5 MB, `415` not an image/PDF, `403`.

#### `GET /groups/:groupId/expenses/:expenseId/receipt`
Downloads the file with its real `Content-Type`. Any member. Errors: `404` if there's no receipt. Images can be shown with an authenticated image request (send the `Authorization` header).

#### `DELETE /groups/:groupId/expenses/:expenseId/receipt` · recorder or admin
Removes the receipt. **Response 200**: expense object.

### `GET /groups/:groupId/expenses/summary`
Everything for the "balances" screen.

**Response 200**
```json
{
  "currency": "INR",
  "totalSpent": 2000.01,
  "expenseCount": 3,
  "byCategory": [
    { "category": "ACCOMMODATION", "total": 1000, "count": 1, "percent": 50 },
    { "category": "FUEL", "total": 900, "count": 1, "percent": 45 },
    { "category": "FOOD", "total": 100.01, "count": 1, "percent": 5 }
  ],
  "members": [
    { "userId": "7b4d…", "username": "bob_k", "name": "Bob Kumar", "avatarUrl": null, "isMember": true,
      "paid": 100.01, "share": 350.01, "repaid": 0, "received": 0, "balance": -250 }
  ],
  "settleUp": [
    { "from": { "userId": "7b4d…", "username": "bob_k", "name": "Bob Kumar", "avatarUrl": null },
      "to": { "userId": "a91f…", "username": "dave_s", "name": "Dave Singh", "avatarUrl": null },
      "amount": 250 }
  ],
  "myBalance": -250
}
```
- `balance` = paid − share + repaid − received. **Positive: is owed money. Negative: owes money.** Balances add up to 0.
- `settleUp`: the suggested payments to settle everyone, as few as possible. Empty when everyone is even.
- `members`: every current member, plus anyone who **left with a non-zero balance** (`isMember: false`), sorted by name.
- `byCategory`: biggest first; `percent` has one decimal.

### Repayments ("settle up")
When someone pays a debt back outside the app (cash, UPI), record it so the balances move. A repayment isn't an expense: it doesn't count in totals or categories.

#### `POST /groups/:groupId/expenses/settlements`
**Request**
```json
{ "toUserId": "a91f…", "amount": 250, "date": "2026-10-20", "note": "UPI" }
```
- `fromUserId`: who paid. Defaults to you.
- `toUserId`: who received it. Required.
- `date`: defaults to today. `note`: up to 280 characters.
- You must be the payer or the receiver; **admins** can record any repayment.

**Response 201**
```json
{
  "id": "e5f6…",
  "groupId": "9a2e…",
  "from": { "userId": "7b4d…", "username": "bob_k", "name": "Bob Kumar", "avatarUrl": null },
  "to": { "userId": "a91f…", "username": "dave_s", "name": "Dave Singh", "avatarUrl": null },
  "amount": 250,
  "currency": "INR",
  "date": "2026-10-20",
  "note": "UPI",
  "createdBy": { "userId": "7b4d…", "username": "bob_k", "name": "Bob Kumar", "avatarUrl": null },
  "canDelete": true,
  "createdAt": "2026-10-20T08:00:00.000Z"
}
```
Errors: `400` (same person twice, or someone with no link to the group), `403`. The other person gets a push.

#### `GET /groups/:groupId/expenses/settlements`
All repayments, newest first. **Response 200**: a list of repayment objects.

#### `DELETE /groups/:groupId/expenses/settlements/:settlementId`
Undoes a repayment recorded by mistake. Whoever recorded it, or an admin. **Response 200**: empty body.

### `GET /groups/:groupId/expenses/report?format=pdf`
Downloads the expense report, for offline records or reimbursement.
- `format=pdf` (default): settle-up list, balances, category breakdown, every expense and repayment.
- `format=csv`: one row per expense and per repayment (`Type,Date,Category,Description,Paid by,Amount,Currency,Split,Shares`). UTF-8, opens in Excel.

**Response 200**: the file, with `Content-Disposition: attachment; filename="spiti-loop-expenses-2026-10-20.pdf"`.

### Push notifications for expenses
| `data.type` | Sent to | Body |
|---|---|---|
| `EXPENSE_ADDED` | everyone in the split except whoever recorded it | "Jordan Rivera added Diesel at Tandi: INR 900.00. Your share: INR 300.00" (`data.expenseId`) |
| `EXPENSE_SETTLEMENT` | the other person in a repayment | "Bob Kumar paid Dave Singh INR 250.00" (`data.settlementId`) |

---

## 18. Offline bundle

### `GET /groups/:groupId/offline-bundle`
Everything the app needs to show a trip without a connection, in one call (see §3.8 for how to use it). Members only.

**Headers:** send `If-None-Match: <ETag from the last bundle>`. If nothing changed, the answer is **`304` with no body**; otherwise `200` with a new `ETag`. The ETag is personal (it covers your own unread count and balance), so store it per user and group.

**Response 200**
```json
{
  "generatedAt": "2026-10-11T09:42:10.123Z",
  "group": { /* group object (§6) */ },
  "members": [ /* member objects (§7) */ ],
  "itinerary": { /* latest finalized itinerary (§9), or null */ },
  "draft": { /* the draft with its revision (§9): admins only, otherwise null */ },
  "activityUpdates": [ /* the latest 200 activity updates, newest first (§20); each stop's status is on the itinerary's waypoints */ ],
  "statuses": [ /* everyone's current status (§10) */ ],
  "expenses": {
    "items": [ /* every expense (§17), newest first */ ],
    "summary": { /* same as GET …/expenses/summary */ },
    "settlements": [ /* repayments, newest first */ ]
  },
  "chat": {
    "messages": [ /* the latest 100 messages and alerts, oldest first (§14) */ ],
    "olderMessages": true,
    "unread": { "unreadCount": 3, "lastReadMessageId": "5d0e…", "lastReadAt": "…" }
  },
  "activeAlerts": [ /* unresolved CRITICAL / SOS alerts (§15) */ ]
}
```
- `olderMessages`: there's more history than the 100 messages included. Load it with `GET …/messages?before=` when online.

Errors: `404` for non-members.

---

## 19. Feedback (beta)

Testers send bug reports and ideas from the app (PDF Phase 13 "structured feedback capture"). Every report reaches the team by email, and testers can see what happened to theirs. All endpoints are 🔒 (any signed-in user).

### `POST /feedback`
**Request**
```json
{
  "category": "BUG",
  "message": "The expense summary shows the wrong total after editing an expense",
  "rating": 4,
  "screen": "expenses/summary",
  "groupId": "9a2e…",
  "appVersion": "0.9.0 (42)",
  "platform": "ANDROID",
  "osVersion": "Android 15",
  "deviceModel": "Pixel 8"
}
```
- **Required:** `category` (`BUG`, `IDEA` or `OTHER`) and `message` (1–4000 characters).
- **Fill these in automatically**, don't ask the user: `appVersion` (version + build), `platform` (`ANDROID` / `IOS` / `WEB`), `osVersion`, `deviceModel` (e.g. from `device_info_plus` / `package_info_plus`), and `screen` (the route the user came from).
- `groupId`: the trip it's about, if they opened feedback from inside a trip (you must be a member, else `404`). `rating`: optional, 1–5.

**Response 201**
```json
{ "id": "f1e2…", "category": "BUG", "message": "…", "rating": 4, "screen": "expenses/summary", "groupId": "9a2e…",
  "status": "NEW", "opsNote": null, "hasScreenshot": false, "createdAt": "2026-10-11T09:42:10.123Z" }
```
Limit: 10 per minute.

### `PUT /feedback/:feedbackId/screenshot`
Attaches a screenshot to **your own** report: `multipart/form-data`, field `file`, JPEG/PNG/WebP/HEIC, max 5 MB. Send it right after `POST /feedback`. **Response 200**: the report with `hasScreenshot: true`. Errors: `404` not your report, `413`, `415`.

### `GET /feedback/mine`
My reports, newest first, with `status` (`NEW`, `IN_PROGRESS`, `DONE`, `WONT_FIX`) and `opsNote` (the team's reply). Show them in a "My feedback" list.

---

## 20. Activities (status & updates)

Each stop of the **finalized** itinerary is an **activity**. The group can see where it is (`UPCOMING` → `CURRENT` → `COMPLETED`) and post short updates about a stop ("Parking is full, use the lot behind the monastery"). All endpoints are 🔒 and members-only (non-members get `404`).

- **Identify a stop by its `activityId`** (on every waypoint, §9), not its waypoint `id`. The `activityId` stays the same when the itinerary is edited and finalized again, so the status and updates stay with the stop.
- **Only stops in the latest finalized version** can get a new status or new updates (`404` "Activity not found in the current itinerary" otherwise, or "No finalized itinerary yet"). Updates of a stop that was later removed can still be read.
- **Who can do what:** **admins** set the status. **Every member** posts updates; only the **author** edits one; the **author or an admin** deletes one.
- **One stop is `CURRENT` at a time:** making a stop `CURRENT` marks the previous `CURRENT` stop `COMPLETED`.
- **Live:** `activity:status_updated`, `activity:update_added`, `activity:update_edited`, `activity:update_deleted` (§13).

**Update object**
```json
{
  "id": "e41a…",
  "groupId": "9a2e…",
  "activityId": "c07e…",
  "author": { "userId": "7b4d…", "username": "bob_k", "name": "Bob Kumar", "avatarUrl": null },
  "text": "Petrol pump at Tandi closes at 8 pm",
  "createdAt": "2026-10-12T07:20:00.000Z",
  "editedAt": null,
  "canEdit": true,
  "canDelete": true
}
```

### `GET /groups/:groupId/activities`
The latest finalized itinerary's stops, in route order, with their status. `404` "No finalized itinerary yet".

**Response 200**
```json
{
  "itineraryVersion": 2,
  "activities": [
    { "activityId": "c07e…", "waypointId": "1143…", "position": 1, "role": "START", "name": "Manali", "date": "2026-10-10",
      "status": "COMPLETED", "statusUpdatedAt": "…", "statusUpdatedBy": { "userId": "3f1c…", "name": "Jordan Rivera" }, "updateCount": 0 }
  ]
}
```

### `PATCH /groups/:groupId/activities/:activityId/status` · admin
**Request** `{ "status": "CURRENT" }` (`UPCOMING`, `CURRENT` or `COMPLETED`). **Response 200**: that stop, as in the list above. Setting the status it already has changes nothing and sends no event. Errors: `400`, `403` (Viewer), `404`.

### `GET /groups/:groupId/activities/:activityId/updates?limit=&before=`
The stop's updates, **newest first**. `limit` 1–100 (default 50); `before` = the previous page's `nextBefore`. Deleted updates are left out.

**Response 200** `{ "items": [ /* update objects */ ], "nextBefore": null }`

### `POST /groups/:groupId/activities/:activityId/updates`
**Request** `{ "text": "…", "clientId": "optional UUID" }`. `text`: 1–1000 characters, trimmed. `clientId` makes a retry return the original (like expenses, §3.8). **Response 201**: update object.

### `PATCH /groups/:groupId/activity-updates/:updateId` · author
**Request** `{ "text": "…" }`. **Response 200**: update object with `editedAt` set. `403` for anyone but the author.

### `DELETE /groups/:groupId/activity-updates/:updateId` · author or admin
**Response 200**: empty body. The text is wiped and the update disappears from lists. `404` if it's already deleted.

---

## 21. Live location for loved ones (people outside the app)

Share your live location with family or friends who don't have TravelGo, like WhatsApp live location (change request v1.0, change 10). You create a **link** for each person, send it any way you like (WhatsApp, SMS…), and whoever opens it sees where you are until the time runs out or you stop it.

- **Durations:** `FIFTEEN_MINUTES`, `ONE_HOUR`, `EIGHT_HOURS`. **At most 5** active links at a time.
- **Positions:** keep sending your position with `POST /location` (§11) while a link is active. Only your **latest** position is kept, never a history, and it's deleted when your last link ends.
- **The link is shown once**, in the response that creates it: open the share sheet right away. The server only stores a hash of it. Lost it? Stop that link and create a new one.
- **Anyone with the link can see your location** until it ends, so the app should say so before sharing.
- **You're told** with a push when the recipient **first opens** the link (`LIVE_SHARE_VIEWED`), and when a link **expires** (`LIVE_SHARE_EXPIRED`).
- **Live events to your own devices:** `location_share:started` and `location_share:stopped` on your normal socket (§13).
- **The recipient's web page** is built by the web team; it uses the two recipient interfaces below. The link is `LIVE_SHARE_LINK_BASE_URL/<token>` (default `https://travelgo.app/live/<token>`), so the page takes the token from its own URL.

### `POST /location-share/sessions` 🔒
**Request** `{ "duration": "ONE_HOUR", "recipientLabel": "Mom" }` (`recipientLabel` optional, up to 60 characters; shown in your list and on their page).

**Response 201**
```json
{
  "id": "0b7c…",
  "recipientLabel": "Mom",
  "duration": "ONE_HOUR",
  "startedAt": "…",
  "expiresAt": "…",
  "remainingSeconds": 3600,
  "firstViewedAt": null,
  "lastViewedAt": null,
  "token": "Qz1x…(43 characters)",
  "link": "https://travelgo.app/live/Qz1x…"
}
```
Errors: `400` bad duration, `409` "You can share your live location with at most 5 people at a time. Stop one first."

### `GET /location-share/sessions` 🔒
Your **active** links, newest first, as above **without** `token` and `link`. `firstViewedAt` tells you whether they've opened it.

### `DELETE /location-share/sessions/:sessionId` 🔒
Stops the link now: the recipient's page gets `location_share:stopped`, is disconnected, and from then on gets `410`. **Response 200**. Stopping a link that already ended is fine. `404` if it isn't yours.

### Recipient: `GET /public/live/:token` (no login)
**Response 200**
```json
{
  "sessionId": "0b7c…",
  "sharer": { "name": "Jordan Rivera", "avatarUrl": null },
  "recipientLabel": "Mom",
  "startedAt": "…",
  "expiresAt": "…",
  "remainingSeconds": 2710,
  "updateIntervalSeconds": 10,
  "location": { "lat": 32.24, "lng": 77.18, "accuracy": 5, "heading": null, "speed": null, "recordedAt": "…" }
}
```
- `location` is `null` until the sharer's phone sends a position.
- Poll every `updateIntervalSeconds`, or use the socket below. Limited to 30 requests a minute per IP.
- Errors: `404` "This live location link is not valid", **`410` "This live location has ended"** (stopped or expired: show "Live location ended").

### Recipient: socket namespace `/live` (no login)
```js
const socket = io('https://api.example.com/live', { auth: { token } });
```
| Event (server → page) | Payload | When |
|---|---|---|
| `ready` | `{ sessionId }` | Connected |
| `location:update` | `{ sessionId, lat, lng, accuracy, heading, speed, recordedAt }` | The sharer moved |
| `location_share:stopped` | `{ sessionId, reason: "STOPPED" \| "EXPIRED", endedAt }` | It's over; the server disconnects right after |

A bad token gives `connect_error` with `"Not found"`, an ended share `"Gone"`. Load `GET /public/live/:token` first for the current position, then follow the events.

---

## 22. Nearby places (homepage)

The homepage's quick actions: **Fuel Stations**, **Restaurants**, **Garages** (change request v1.0, change 1). Data comes from **OpenStreetMap**. All three are 🔒 (signed-in users), with the same query and response.

| Route | Finds |
|---|---|
| `GET /location/fuel-stations` | Fuel stations |
| `GET /location/restaurants` | Restaurants, fast food, cafés, food courts (`kind` tells which) |
| `GET /location/garages` | Car repair, motorcycle repair, tyre shops |

**Query:** `lat`, `lng` (required: the user's position), `radius` in meters (100–25,000, default 5,000), `limit` (1–50, default 20).

**Response 200**
```json
{
  "category": "FUEL",
  "center": { "lat": 32.2432, "lng": 77.1892 },
  "radiusMeters": 5000,
  "source": "openstreetmap",
  "attribution": "© OpenStreetMap contributors",
  "places": [
    {
      "id": "osm:node/795826239",
      "name": "Indian Oil",
      "category": "FUEL",
      "kind": "fuel",
      "lat": 32.2583689,
      "lng": 77.1880018,
      "distanceMeters": 1685,
      "address": null,
      "openingHours": "24/7",
      "phone": null,
      "website": null,
      "brand": "Indian Oil"
    }
  ]
}
```
- **Nearest first**, straight-line distance (`distanceMeters`), within `radius`.
- **`name` can be `null`** (unnamed in OpenStreetMap): show the category instead ("Fuel station").
- **`openingHours`** is OpenStreetMap's text (e.g. `"Mo-Sa 08:00-20:00"`, `"24/7"`), often `null`. There are **no ratings**.
- `address` is built from the address fields when OpenStreetMap has them, often `null`: show the distance instead.
- **Show `attribution`** wherever the results appear (OpenStreetMap's licence requires it).
- Results are cached for **10 minutes** per ~100 m area, so refreshing doesn't hit the source each time. Limited to 30 requests a minute per IP.

Errors: `400` missing/invalid `lat`/`lng`/`radius`, `401`, `503` "Nearby places are temporarily unavailable. Try again in a minute." (the data source is busy or down).

---

## 23. Endpoint summary

| # | Method | Path | Auth | Who |
|---|---|---|---|---|
| 1 | GET | `/health` | – | anyone |
| 2 | GET | `/auth/username-available` | – | anyone |
| 3 | POST | `/auth/signup` | – | anyone |
| 4 | POST | `/auth/verify` | – | anyone |
| 5 | POST | `/auth/resend-verification` | – | anyone |
| 6 | POST | `/auth/login` | – | anyone |
| 7 | POST | `/auth/otp/request` | – | anyone |
| 8 | POST | `/auth/otp/login` | – | anyone |
| 9 | POST | `/auth/refresh` | – | anyone |
| 10 | POST | `/auth/logout` | 🔒 | user |
| 11 | POST | `/auth/forgot-password` | – | anyone |
| 12 | POST | `/auth/reset-password` | – | anyone |
| 13 | GET | `/auth/me` | 🔒 | user |
| 14 | PATCH | `/auth/me` | 🔒 | user |
| 15 | POST | `/groups` | 🔒 | user |
| 16 | GET | `/groups` | 🔒 | user |
| 17 | GET | `/groups/:groupId` | 🔒 | member |
| 18 | PATCH | `/groups/:groupId` | 🔒 | admin |
| 19 | DELETE | `/groups/:groupId` | 🔒 | admin |
| 20 | GET | `/groups/:groupId/members` | 🔒 | member |
| 21 | POST | `/groups/:groupId/members` | 🔒 | admin |
| 22 | PATCH | `/groups/:groupId/members/:userId` | 🔒 | admin |
| 23 | DELETE | `/groups/:groupId/members/:userId` | 🔒 | admin, or yourself |
| 24 | POST | `/groups/:groupId/invites` | 🔒 | admin |
| 25 | GET | `/groups/:groupId/invites` | 🔒 | admin |
| 26 | DELETE | `/groups/:groupId/invites/:inviteId` | 🔒 | admin |
| 27 | GET | `/invites` | 🔒 | user |
| 28 | POST | `/invites/:inviteId/accept` | 🔒 | invitee |
| 29 | POST | `/invites/:inviteId/reject` | 🔒 | invitee |
| 30 | GET | `/invites/link/:token` | 🔒 | user |
| 31 | POST | `/invites/link/:token/accept` | 🔒 | user |
| 32 | GET | `/groups/:groupId/itinerary` | 🔒 | member |
| 33 | GET | `/groups/:groupId/itinerary/versions` | 🔒 | member |
| 34 | GET | `/groups/:groupId/itinerary/versions/:version` | 🔒 | member |
| 35 | GET | `/groups/:groupId/itinerary/pdf` | 🔒 | member |
| 36 | POST | `/groups/:groupId/itinerary/refresh` | 🔒 | admin |
| 37 | GET | `/groups/:groupId/itinerary/draft` | 🔒 | admin |
| 38 | POST | `/groups/:groupId/itinerary/draft` | 🔒 | admin |
| 39 | DELETE | `/groups/:groupId/itinerary/draft` | 🔒 | admin |
| 40 | POST | `/groups/:groupId/itinerary/draft/finalize` | 🔒 | admin |
| 41 | POST | `/groups/:groupId/itinerary/draft/refresh` | 🔒 | admin |
| 42 | POST | `/groups/:groupId/itinerary/draft/waypoints` | 🔒 | admin |
| 43 | PUT | `/groups/:groupId/itinerary/draft/waypoints/order` | 🔒 | admin |
| 44 | PATCH | `/groups/:groupId/itinerary/draft/waypoints/:waypointId` | 🔒 | admin |
| 45 | DELETE | `/groups/:groupId/itinerary/draft/waypoints/:waypointId` | 🔒 | admin |
| 46 | POST | `/groups/:groupId/status` | 🔒 | member |
| 47 | GET | `/groups/:groupId/status` | 🔒 | member |
| 48 | GET | `/groups/:groupId/status/history` | 🔒 | member |
| 49 | GET | `/groups/:groupId/location` | 🔒 | member |
| 50 | POST | `/groups/:groupId/location` | 🔒 | member |
| 51 | GET | `/groups/:groupId/location/share` | 🔒 | member |
| 52 | PUT | `/groups/:groupId/location/share` | 🔒 | member |
| 53 | DELETE | `/groups/:groupId/location/share` | 🔒 | member |
| 54 | POST | `/devices` | 🔒 | user |
| 55 | DELETE | `/devices` | 🔒 | user |
| 56 | GET | `/groups/:groupId/messages` | 🔒 | member |
| 57 | GET | `/groups/:groupId/messages/unread` | 🔒 | member |
| 58 | POST | `/groups/:groupId/messages/read` | 🔒 | member |
| 59 | GET | `/groups/:groupId/messages/:messageId/reads` | 🔒 | member |
| 60 | POST | `/groups/:groupId/alerts` | 🔒 | admin |
| 61 | POST | `/groups/:groupId/alerts/sos` | 🔒 | member |
| 62 | GET | `/groups/:groupId/alerts` | 🔒 | member |
| 63 | GET | `/groups/:groupId/alerts/:alertId` | 🔒 | member |
| 64 | POST | `/groups/:groupId/alerts/:alertId/ack` | 🔒 | member (not the sender) |
| 65 | POST | `/groups/:groupId/alerts/:alertId/resolve` | 🔒 | SOS: sender or admin · CRITICAL: admin |
| 66 | GET | `/groups/:groupId/presence` | 🔒 | member |
| 67 | POST | `/groups/:groupId/expenses` | 🔒 | member |
| 68 | GET | `/groups/:groupId/expenses` | 🔒 | member |
| 69 | GET | `/groups/:groupId/expenses/summary` | 🔒 | member |
| 70 | GET | `/groups/:groupId/expenses/report` | 🔒 | member |
| 71 | POST | `/groups/:groupId/expenses/settlements` | 🔒 | payer, receiver or admin |
| 72 | GET | `/groups/:groupId/expenses/settlements` | 🔒 | member |
| 73 | DELETE | `/groups/:groupId/expenses/settlements/:settlementId` | 🔒 | recorder or admin |
| 74 | GET | `/groups/:groupId/expenses/:expenseId` | 🔒 | member |
| 75 | PATCH | `/groups/:groupId/expenses/:expenseId` | 🔒 | recorder or admin |
| 76 | DELETE | `/groups/:groupId/expenses/:expenseId` | 🔒 | recorder or admin |
| 77 | PUT | `/groups/:groupId/expenses/:expenseId/receipt` | 🔒 | recorder or admin |
| 78 | GET | `/groups/:groupId/expenses/:expenseId/receipt` | 🔒 | member |
| 79 | DELETE | `/groups/:groupId/expenses/:expenseId/receipt` | 🔒 | recorder or admin |
| 80 | GET | `/groups/:groupId/offline-bundle` | 🔒 | member |
| 81 | GET | `/auth/me/export` | 🔒 | user |
| 82 | DELETE | `/auth/me` | 🔒 | user |
| 83 | POST | `/groups/:groupId/close` | 🔒 | admin |
| 84 | POST | `/groups/:groupId/reopen` | 🔒 | admin |
| 85 | POST | `/feedback` | 🔒 | user |
| 86 | GET | `/feedback/mine` | 🔒 | user |
| 87 | PUT | `/feedback/:feedbackId/screenshot` | 🔒 | the reporter |
| 88 | GET | `/groups/:groupId/activities` | 🔒 | member |
| 89 | PATCH | `/groups/:groupId/activities/:activityId/status` | 🔒 | admin |
| 90 | GET | `/groups/:groupId/activities/:activityId/updates` | 🔒 | member |
| 91 | POST | `/groups/:groupId/activities/:activityId/updates` | 🔒 | member |
| 92 | PATCH | `/groups/:groupId/activity-updates/:updateId` | 🔒 | the author |
| 93 | DELETE | `/groups/:groupId/activity-updates/:updateId` | 🔒 | author or admin |
| 94 | POST | `/location` | 🔒 | user |
| 95 | GET | `/location/sharing` | 🔒 | user |
| 96 | POST | `/location-share/sessions` | 🔒 | user |
| 97 | GET | `/location-share/sessions` | 🔒 | user |
| 98 | DELETE | `/location-share/sessions/:sessionId` | 🔒 | user (own links) |
| 99 | GET | `/public/live/:token` | – | anyone with the link |
| 100 | GET | `/location/fuel-stations` | 🔒 | user |
| 101 | GET | `/location/restaurants` | 🔒 | user |
| 102 | GET | `/location/garages` | 🔒 | user |
| 103 | POST | `/groups/:groupId/messages/voice` | 🔒 | member |
| 104 | GET | `/groups/:groupId/messages/:messageId/voice` | 🔒 | member |
| 105 | POST | `/groups/:groupId/cover-image` | 🔒 | admin |
| 106 | GET | `/groups/:groupId/cover-image` | 🔒 | member |
| 107 | DELETE | `/groups/:groupId/cover-image` | 🔒 | admin |
| 108 | POST | `/auth/me/avatar` | 🔒 | user |
| 109 | DELETE | `/auth/me/avatar` | 🔒 | user |
| 110 | GET | `/users/:userId/avatar` | – | anyone with the URL |
| 111 | GET | `/groups/:groupId/itinerary/route` | 🔒 | member |
| 112 | GET | `/groups/:groupId/itinerary/draft/route` | 🔒 | admin |

Plus socket events `chat:send`, `chat:typing`, `chat:read` (§14).

## 24. Not built yet
- **Itinerary reviews** (TripAdvisor/Google): waiting on a decision.
- **Chatbot itinerary flow**: deferred, planned as "coming soon".
- Multi-currency expenses with conversion (future phase, PDF §11).
- Editing and deleting chat messages (not in the PDF). Image/file/video messages are **out of scope** by decision (change request v1.0, change 8).
