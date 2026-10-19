# TravelGo API — Real Request & Response Examples

**For:** the mobile app developer. It sits alongside `API_DOCUMENTATION.md`, which explains each endpoint and its rules.

Captured on 2026-10-14 by calling every endpoint, in order, against the backend with Postgres and Redis running (`npm run capture:api-responses`). Every **request**, **response**, socket **ack**, socket **event** and **push** below is real, not hand-written. 244 steps.

**How to read it**
- Demo users: **Alice** (`demo_alice`) creates the group, so she's Admin. **Bob** (`demo_bob`) is a member. **Carol** joins by invite and link and later deletes her account. **Dave** is never a member (for "not allowed" examples).
- 🔒 = sent with `Authorization: Bearer <accessToken>`.
- 🔌 = over the socket.io connection (§13 of the docs). `emit …` = the app sends an event and gets the **Ack (reply)**; `on …` = an event the server pushes to the app. The event other members' apps received at the same moment is shown under the response.
- **Push sent to …** = the push notification the server sent because of that request (`title`, `body`, `data`).
- Paths show placeholders (`:groupId`, `:token`…) where real ids were used; bodies and socket payloads show the real ids.
- Tokens (JWTs) are shortened. Real ones are 200+ characters.
- Long lists (offline bundle, data export, some lists) keep their first item and say how many more there were.
- Success **and** error cases are included, so you can see exactly what the app will receive.

**New since the last capture (2026-10-05)**
- No endpoint, request or response changes. Re-captured to confirm the examples still match the backend.

**What reflects the current dev setup**
- **Itinerary:** elevation (Open-Meteo) and weather (MET Norway) are real. Where examples show `weather.status` `UNAVAILABLE`, the capture machine couldn't reach MET Norway; see `API_DOCUMENTATION.md` §9 for the filled-in shape.
- **Email/SMS:** codes and invites were captured instead of sent. In the dev server, email is real (Brevo); SMS isn't connected (not needed for now), so SMS codes and invites only appear in the server log.
- **Push notifications:** shown as captured. The dev server sends them for real through Firebase (FCM) to registered devices.
- **Live location:** needs Redis. If it's down, location endpoints return `503` "Live location is temporarily unavailable (Redis is down)".
- **Nearby places:** real OpenStreetMap data (public server, rate-limited).

## Contents

- [Health](#health)
- [Auth — signup & verify](#auth--signup--verify)
- [Auth — login, profile, tokens](#auth--login-profile-tokens)
- [Push notification devices](#push-notification-devices)
- [Realtime socket — connect](#realtime-socket--connect)
- [Groups](#groups)
- [Members](#members)
- [Trip cover image](#trip-cover-image)
- [Profile picture](#profile-picture)
- [Invites — email / SMS](#invites--email--sms)
- [Invites — share link](#invites--share-link)
- [Itinerary — draft & pins (admin)](#itinerary--draft--pins-admin)
- [Itinerary — finalize, versions, PDF](#itinerary--finalize-versions-pdf)
- [Activities — status & updates](#activities--status--updates)
- [Trip status](#trip-status)
- [Live location (with the group)](#live-location-with-the-group)
- [Live location for loved ones (people outside the app)](#live-location-for-loved-ones-people-outside-the-app)
- [Nearby places (homepage)](#nearby-places-homepage)
- [Presence](#presence)
- [Chat (socket + HTTP)](#chat-socket--http)
- [Alerts & SOS](#alerts--sos)
- [Chat — read state after the alerts](#chat--read-state-after-the-alerts)
- [Expenses](#expenses)
- [Offline bundle](#offline-bundle)
- [Feedback (beta)](#feedback-beta)
- [Closing a trip](#closing-a-trip)
- [Privacy — my data, delete my account](#privacy--my-data-delete-my-account)
- [Auth — OTP login, password reset, logout](#auth--otp-login-password-reset-logout)
- [Presence — going offline](#presence--going-offline)
- [Cleanup — delete the group](#cleanup--delete-the-group)

## Health

### 1. Health check

`GET /health`

**Response 200 OK**

```json
{
  "status": "ok",
  "db": "connected",
  "redis": "connected",
  "version": "0.0.1",
  "uptimeSeconds": 5
}
```

## Auth — signup & verify

### 2. Username available

`GET /auth/username-available?username=demo_alice`

**Response 200 OK**

```json
{
  "username": "demo_alice",
  "available": true
}
```

### 3. Username breaks the rules

`GET /auth/username-available?username=x%21`

**Response 400 Bad Request**

```json
{
  "message": [
    "Username must be 3–30 characters: lowercase letters, numbers, \".\" and \"_\", starting and ending with a letter or number. Case-insensitive."
  ],
  "error": "Bad Request",
  "statusCode": 400
}
```

### 4. Signup with a weak password

`POST /auth/signup`

**Request**
```json
{
  "email": "demo.alice@example.com",
  "username": "demo_alice",
  "password": "password",
  "name": "Alice Rider"
}
```

**Response 400 Bad Request**

```json
{
  "message": [
    "Password must be 8–72 characters with at least one uppercase letter, one lowercase letter, one number and one symbol"
  ],
  "error": "Bad Request",
  "statusCode": 400
}
```

### 5. Signup (Alice)

`POST /auth/signup`

**Request**
```json
{
  "email": "demo.alice@example.com",
  "phone": "+919812345611",
  "username": "demo_alice",
  "password": "Str0ng!Pass",
  "name": "Alice Rider"
}
```

**Response 201 Created**

```json
{
  "userId": "64135665-35b8-4956-861a-e99b87c09958",
  "message": "Verification code sent"
}
```

### 6. Login before verifying

`POST /auth/login`

**Request**
```json
{
  "identifier": "demo.alice@example.com",
  "password": "Str0ng!Pass"
}
```

**Response 401 Unauthorized**

```json
{
  "message": "Account not verified",
  "error": "Unauthorized",
  "statusCode": 401
}
```

### 7. Verify with a wrong code

`POST /auth/verify`

**Request**
```json
{
  "userId": "64135665-35b8-4956-861a-e99b87c09958",
  "code": "000000"
}
```

**Response 400 Bad Request**

```json
{
  "message": "Invalid or expired code",
  "error": "Bad Request",
  "statusCode": 400
}
```

### 8. Verify (Alice)

`POST /auth/verify`

**Request**
```json
{
  "userId": "64135665-35b8-4956-861a-e99b87c09958",
  "code": "210814"
}
```

**Response 201 Created**

```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5…(JWT, shortened)",
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5…(JWT, shortened)"
}
```

### 9. Signup (Bob)

`POST /auth/signup`

**Request**
```json
{
  "email": "demo.bob@example.com",
  "phone": "+919812345612",
  "username": "demo_bob",
  "password": "Str0ng!Pass",
  "name": "Bob Kumar"
}
```

**Response 201 Created**

```json
{
  "userId": "e8b0c791-0ecf-40ab-b2be-3c714a96f23e",
  "message": "Verification code sent"
}
```

### 10. Verify by email instead of userId (Bob)

`POST /auth/verify`

**Request**
```json
{
  "email": "demo.bob@example.com",
  "code": "801339"
}
```

**Response 201 Created**

```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5…(JWT, shortened)",
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5…(JWT, shortened)"
}
```

### 11. Resend the signup code (already verified: same generic answer, nothing sent)

`POST /auth/resend-verification`

**Request**
```json
{
  "email": "demo.alice@example.com"
}
```

**Response 201 Created**

```json
{
  "message": "If an unverified account exists, a new code has been sent"
}
```

### 12. Signup with a taken username

`POST /auth/signup`

**Request**
```json
{
  "email": "someone.else@example.com",
  "username": "demo_alice",
  "password": "Str0ng!Pass",
  "name": "Someone"
}
```

**Response 409 Conflict**

```json
{
  "message": "Username is already taken",
  "error": "Conflict",
  "statusCode": 409
}
```

## Auth — login, profile, tokens

### 13. Login by username ("remember me")

`POST /auth/login`

**Request**
```json
{
  "identifier": "demo_alice",
  "password": "Str0ng!Pass",
  "rememberMe": true
}
```

**Response 201 Created**

```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5…(JWT, shortened)",
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5…(JWT, shortened)"
}
```

### 14. Login with a wrong password

`POST /auth/login`

**Request**
```json
{
  "identifier": "demo.alice@example.com",
  "password": "Wr0ng!Pass"
}
```

**Response 401 Unauthorized**

```json
{
  "message": "Invalid credentials",
  "error": "Unauthorized",
  "statusCode": 401
}
```

### 15. Get my profile

`GET /auth/me` 🔒

**Response 200 OK**

```json
{
  "id": "64135665-35b8-4956-861a-e99b87c09958",
  "username": "demo_alice",
  "email": "demo.alice@example.com",
  "phone": "+919812345611",
  "name": "Alice Rider",
  "avatarUrl": null,
  "emailVerified": true,
  "phoneVerified": true,
  "createdAt": "2026-10-14T08:57:58.303Z"
}
```

### 16. Get my profile without a token

`GET /auth/me`

**Response 401 Unauthorized**

```json
{
  "message": "Unauthorized",
  "statusCode": 401
}
```

### 17. Update my profile

`PATCH /auth/me` 🔒

**Request**
```json
{
  "name": "Alice Rider",
  "avatarUrl": "https://example.com/avatars/alice.jpg"
}
```

**Response 200 OK**

```json
{
  "id": "64135665-35b8-4956-861a-e99b87c09958",
  "username": "demo_alice",
  "email": "demo.alice@example.com",
  "phone": "+919812345611",
  "name": "Alice Rider",
  "avatarUrl": "https://example.com/avatars/alice.jpg",
  "emailVerified": true,
  "phoneVerified": true,
  "createdAt": "2026-10-14T08:57:58.303Z"
}
```

### 18. Update to a taken username

`PATCH /auth/me` 🔒

**Request**
```json
{
  "username": "demo_bob"
}
```

**Response 409 Conflict**

```json
{
  "message": "Username is already taken",
  "error": "Conflict",
  "statusCode": 409
}
```

### 19. Refresh tokens

`POST /auth/refresh`

**Request**
```json
{
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5…(JWT, shortened)"
}
```

**Response 201 Created**

```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5…(JWT, shortened)",
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5…(JWT, shortened)"
}
```

### 20. Refresh with an old (already used) token

`POST /auth/refresh`

**Request**
```json
{
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5…(JWT, shortened)"
}
```

**Response 401 Unauthorized**

```json
{
  "message": "Refresh token has been revoked",
  "error": "Unauthorized",
  "statusCode": 401
}
```

## Push notification devices

### 21. Register a device

`POST /devices` 🔒

**Request**
```json
{
  "token": "fcm-token-alice-pixel-7",
  "platform": "ANDROID"
}
```

**Response 201 Created**

```json
{
  "registered": true
}
```

### 22. Register the same device again (safe)

`POST /devices` 🔒

**Request**
```json
{
  "token": "fcm-token-alice-pixel-7",
  "platform": "ANDROID"
}
```

**Response 201 Created**

```json
{
  "registered": true
}
```

### 23. Unknown platform

`POST /devices` 🔒

**Request**
```json
{
  "token": "fcm-token-bob",
  "platform": "BLACKBERRY"
}
```

**Response 400 Bad Request**

```json
{
  "message": [
    "platform must be one of the following values: ANDROID, IOS, WEB"
  ],
  "error": "Bad Request",
  "statusCode": 400
}
```

## Realtime socket — connect

### 24. Alice connects

`io(baseUrl, { auth: { token: accessToken } })` → `on ready` 🔌

```json
{
  "userId": "64135665-35b8-4956-861a-e99b87c09958"
}
```

### 25. Bob connects

```json
{
  "userId": "e8b0c791-0ecf-40ab-b2be-3c714a96f23e"
}
```

_(Carol and Dave connect the same way.)_

## Groups

### 26. Create a group

`POST /groups` 🔒

**Request**
```json
{
  "name": "Ladakh Ride 2026",
  "description": "Manali to Leh on bikes",
  "tripStart": "2026-10-10T00:00:00.000Z",
  "tripEnd": "2026-10-19T00:00:00.000Z"
}
```

**Response 201 Created**

```json
{
  "id": "e03e87cf-d598-4969-ba7a-3d8ac6ebefff",
  "name": "Ladakh Ride 2026",
  "description": "Manali to Leh on bikes",
  "tripStart": "2026-10-10T00:00:00.000Z",
  "tripEnd": "2026-10-19T00:00:00.000Z",
  "currency": "INR",
  "createdById": "64135665-35b8-4956-861a-e99b87c09958",
  "createdAt": "2026-10-14T08:58:02.317Z",
  "closedAt": null,
  "deleteAfter": null,
  "coverImageUrl": null,
  "myRole": "ADMIN",
  "memberCount": 1
}
```

### 27. Create with a missing description

`POST /groups` 🔒

**Request**
```json
{
  "name": "No description",
  "tripStart": "2026-10-10T00:00:00.000Z",
  "tripEnd": "2026-10-19T00:00:00.000Z"
}
```

**Response 400 Bad Request**

```json
{
  "message": [
    "description must be shorter than or equal to 2000 characters",
    "description must be longer than or equal to 1 characters",
    "description must be a string"
  ],
  "error": "Bad Request",
  "statusCode": 400
}
```

### 28. Trip end before start

`POST /groups` 🔒

**Request**
```json
{
  "name": "Backwards",
  "description": "d",
  "tripStart": "2026-10-19T00:00:00.000Z",
  "tripEnd": "2026-10-10T00:00:00.000Z"
}
```

**Response 400 Bad Request**

```json
{
  "message": "tripEnd must not be before tripStart",
  "error": "Bad Request",
  "statusCode": 400
}
```

### 29. List my groups

`GET /groups` 🔒

**Response 200 OK**

```json
[
  {
    "id": "e03e87cf-d598-4969-ba7a-3d8ac6ebefff",
    "name": "Ladakh Ride 2026",
    "description": "Manali to Leh on bikes",
    "tripStart": "2026-10-10T00:00:00.000Z",
    "tripEnd": "2026-10-19T00:00:00.000Z",
    "currency": "INR",
    "createdById": "64135665-35b8-4956-861a-e99b87c09958",
    "createdAt": "2026-10-14T08:58:02.317Z",
    "closedAt": null,
    "deleteAfter": null,
    "coverImageUrl": null,
    "myRole": "ADMIN",
    "memberCount": 1
  }
]
```

### 30. Get group details

`GET /groups/:groupId` 🔒

**Response 200 OK**

```json
{
  "id": "e03e87cf-d598-4969-ba7a-3d8ac6ebefff",
  "name": "Ladakh Ride 2026",
  "description": "Manali to Leh on bikes",
  "tripStart": "2026-10-10T00:00:00.000Z",
  "tripEnd": "2026-10-19T00:00:00.000Z",
  "currency": "INR",
  "createdById": "64135665-35b8-4956-861a-e99b87c09958",
  "createdAt": "2026-10-14T08:58:02.317Z",
  "closedAt": null,
  "deleteAfter": null,
  "coverImageUrl": null,
  "myRole": "ADMIN",
  "memberCount": 1
}
```

### 31. Get group details as a non-member

`GET /groups/:groupId` 🔒

**Response 404 Not Found**

```json
{
  "message": "Group not found",
  "error": "Not Found",
  "statusCode": 404
}
```

### 32. Edit group (admin)

`PATCH /groups/:groupId` 🔒

**Request**
```json
{
  "description": "Manali → Leh, 9 days",
  "currency": "INR"
}
```

**Response 200 OK**

```json
{
  "id": "e03e87cf-d598-4969-ba7a-3d8ac6ebefff",
  "name": "Ladakh Ride 2026",
  "description": "Manali → Leh, 9 days",
  "tripStart": "2026-10-10T00:00:00.000Z",
  "tripEnd": "2026-10-19T00:00:00.000Z",
  "currency": "INR",
  "createdById": "64135665-35b8-4956-861a-e99b87c09958",
  "createdAt": "2026-10-14T08:58:02.317Z",
  "closedAt": null,
  "deleteAfter": null,
  "coverImageUrl": null,
  "myRole": "ADMIN",
  "memberCount": 1
}
```

**Event `group:updated` received by Alice (every member gets it)**

```json
{
  "groupId": "e03e87cf-d598-4969-ba7a-3d8ac6ebefff",
  "group": {
    "id": "e03e87cf-d598-4969-ba7a-3d8ac6ebefff",
    "name": "Ladakh Ride 2026",
    "description": "Manali → Leh, 9 days",
    "tripStart": "2026-10-10T00:00:00.000Z",
    "tripEnd": "2026-10-19T00:00:00.000Z",
    "currency": "INR",
    "createdById": "64135665-35b8-4956-861a-e99b87c09958",
    "createdAt": "2026-10-14T08:58:02.317Z",
    "closedAt": null,
    "deleteAfter": null,
    "coverImageUrl": null,
    "memberCount": 1
  },
  "changedBy": "64135665-35b8-4956-861a-e99b87c09958",
  "timestamp": "2026-10-14T08:58:03.318Z"
}
```

## Members

### 33. Add a member by username

`POST /groups/:groupId/members` 🔒

**Request**
```json
{
  "username": "demo_bob"
}
```

**Response 201 Created**

```json
{
  "userId": "e8b0c791-0ecf-40ab-b2be-3c714a96f23e",
  "username": "demo_bob",
  "name": "Bob Kumar",
  "avatarUrl": null,
  "role": "VIEWER",
  "joinedAt": "2026-10-14T08:58:03.527Z"
}
```

**Event `member:joined` received by Alice (and Bob)**

```json
{
  "groupId": "e03e87cf-d598-4969-ba7a-3d8ac6ebefff",
  "member": {
    "userId": "e8b0c791-0ecf-40ab-b2be-3c714a96f23e",
    "username": "demo_bob",
    "name": "Bob Kumar",
    "avatarUrl": null,
    "role": "VIEWER",
    "joinedAt": "2026-10-14T08:58:03.527Z"
  },
  "via": "DIRECT",
  "addedBy": "64135665-35b8-4956-861a-e99b87c09958",
  "timestamp": "2026-10-14T08:58:03.523Z"
}
```

### 34. Add someone who is already a member

`POST /groups/:groupId/members` 🔒

**Request**
```json
{
  "username": "demo_bob"
}
```

**Response 409 Conflict**

```json
{
  "message": "User is already a member of this group",
  "error": "Conflict",
  "statusCode": 409
}
```

### 35. Add an unknown user

`POST /groups/:groupId/members` 🔒

**Request**
```json
{
  "username": "nobody_here"
}
```

**Response 404 Not Found**

```json
{
  "message": "No registered TravelGo user with that username/email/phone",
  "error": "Not Found",
  "statusCode": 404
}
```

### 36. Send two identifiers

`POST /groups/:groupId/members` 🔒

**Request**
```json
{
  "username": "demo_bob",
  "email": "demo.bob@example.com"
}
```

**Response 400 Bad Request**

```json
{
  "message": "Send exactly one of username, email or phone",
  "error": "Bad Request",
  "statusCode": 400
}
```

### 37. List members

`GET /groups/:groupId/members` 🔒

**Response 200 OK**

```json
[
  {
    "userId": "64135665-35b8-4956-861a-e99b87c09958",
    "username": "demo_alice",
    "name": "Alice Rider",
    "avatarUrl": "https://example.com/avatars/alice.jpg",
    "role": "ADMIN",
    "joinedAt": "2026-10-14T08:58:02.317Z"
  },
  {
    "userId": "e8b0c791-0ecf-40ab-b2be-3c714a96f23e",
    "username": "demo_bob",
    "name": "Bob Kumar",
    "avatarUrl": null,
    "role": "VIEWER",
    "joinedAt": "2026-10-14T08:58:03.527Z"
  }
]
```

### 38. Edit group as a Viewer

`PATCH /groups/:groupId` 🔒

**Request**
```json
{
  "name": "Mine now"
}
```

**Response 403 Forbidden**

```json
{
  "message": "Requires group role: ADMIN",
  "error": "Forbidden",
  "statusCode": 403
}
```

### 39. Demote the only admin

`PATCH /groups/:groupId/members/:userId` 🔒

**Request**
```json
{
  "role": "VIEWER"
}
```

**Response 409 Conflict**

```json
{
  "message": "A group must keep at least one admin — promote another member first, or delete the group",
  "error": "Conflict",
  "statusCode": 409
}
```

### 40. Promote to ADMIN (several admins are fine)

`PATCH /groups/:groupId/members/:userId` 🔒

**Request**
```json
{
  "role": "ADMIN"
}
```

**Response 200 OK**

```json
{
  "userId": "e8b0c791-0ecf-40ab-b2be-3c714a96f23e",
  "username": "demo_bob",
  "name": "Bob Kumar",
  "avatarUrl": null,
  "role": "ADMIN",
  "joinedAt": "2026-10-14T08:58:03.527Z"
}
```

**Event `member:role_changed` received by Bob**

```json
{
  "groupId": "e03e87cf-d598-4969-ba7a-3d8ac6ebefff",
  "userId": "e8b0c791-0ecf-40ab-b2be-3c714a96f23e",
  "newRole": "ADMIN",
  "changedBy": "64135665-35b8-4956-861a-e99b87c09958",
  "timestamp": "2026-10-14T08:58:04.678Z"
}
```

### 41. Demote back to VIEWER

`PATCH /groups/:groupId/members/:userId` 🔒

**Request**
```json
{
  "role": "VIEWER"
}
```

**Response 200 OK**

```json
{
  "userId": "e8b0c791-0ecf-40ab-b2be-3c714a96f23e",
  "username": "demo_bob",
  "name": "Bob Kumar",
  "avatarUrl": null,
  "role": "VIEWER",
  "joinedAt": "2026-10-14T08:58:03.527Z"
}
```

## Trip cover image

### 42. Upload a cover image (admin)

`POST /groups/:groupId/cover-image` 🔒

**Request** (multipart/form-data)

- `file`: cover.png (image/png, 128 bytes)

**Response 200 OK**

```json
{
  "id": "e03e87cf-d598-4969-ba7a-3d8ac6ebefff",
  "name": "Ladakh Ride 2026",
  "description": "Manali → Leh, 9 days",
  "tripStart": "2026-10-10T00:00:00.000Z",
  "tripEnd": "2026-10-19T00:00:00.000Z",
  "currency": "INR",
  "createdById": "64135665-35b8-4956-861a-e99b87c09958",
  "createdAt": "2026-10-14T08:58:02.317Z",
  "closedAt": null,
  "deleteAfter": null,
  "coverImageUrl": "http://localhost:3000/groups/e03e87cf-d598-4969-ba7a-3d8ac6ebefff/cover-image?v=67852749-c5a2-4467-892f-b9d5919b1ce2",
  "myRole": "ADMIN",
  "memberCount": 2
}
```

### 43. Members see coverImageUrl on the group

`GET /groups/:groupId` 🔒

**Response 200 OK**

```json
{
  "id": "e03e87cf-d598-4969-ba7a-3d8ac6ebefff",
  "name": "Ladakh Ride 2026",
  "description": "Manali → Leh, 9 days",
  "tripStart": "2026-10-10T00:00:00.000Z",
  "tripEnd": "2026-10-19T00:00:00.000Z",
  "currency": "INR",
  "createdById": "64135665-35b8-4956-861a-e99b87c09958",
  "createdAt": "2026-10-14T08:58:02.317Z",
  "closedAt": null,
  "deleteAfter": null,
  "coverImageUrl": "http://localhost:3000/groups/e03e87cf-d598-4969-ba7a-3d8ac6ebefff/cover-image?v=67852749-c5a2-4467-892f-b9d5919b1ce2",
  "myRole": "VIEWER",
  "memberCount": 2
}
```

### 44. Download the cover image (send the Bearer header)

`GET /groups/:groupId/cover-image` 🔒

**Response 200 OK**

`(binary, 128 bytes) Content-Type: image/png`

### 45. Replace the cover image (new ?v= in the URL)

`POST /groups/:groupId/cover-image` 🔒

**Request** (multipart/form-data)

- `file`: cover.jpg (image/jpeg, 124 bytes)

**Response 200 OK**

```json
{
  "id": "e03e87cf-d598-4969-ba7a-3d8ac6ebefff",
  "name": "Ladakh Ride 2026",
  "description": "Manali → Leh, 9 days",
  "tripStart": "2026-10-10T00:00:00.000Z",
  "tripEnd": "2026-10-19T00:00:00.000Z",
  "currency": "INR",
  "createdById": "64135665-35b8-4956-861a-e99b87c09958",
  "createdAt": "2026-10-14T08:58:02.317Z",
  "closedAt": null,
  "deleteAfter": null,
  "coverImageUrl": "http://localhost:3000/groups/e03e87cf-d598-4969-ba7a-3d8ac6ebefff/cover-image?v=193bae6f-35d8-4d41-b513-cb1ba1b7a20b",
  "myRole": "ADMIN",
  "memberCount": 2
}
```

### 46. Upload a cover as a Viewer

`POST /groups/:groupId/cover-image` 🔒

**Request** (multipart/form-data)

- `file`: cover.png (image/png, 128 bytes)

**Response 403 Forbidden**

```json
{
  "message": "Requires group role: ADMIN",
  "error": "Forbidden",
  "statusCode": 403
}
```

### 47. Cover that is not a JPEG/PNG/WebP

`POST /groups/:groupId/cover-image` 🔒

**Request** (multipart/form-data)

- `file`: cover.jpg (image/jpeg, 24 bytes)

**Response 415 Unsupported Media Type**

```json
{
  "message": "Cover image must be a JPEG, PNG or WebP",
  "error": "Unsupported Media Type",
  "statusCode": 415
}
```

### 48. Upload without the file field

`POST /groups/:groupId/cover-image` 🔒

**Response 400 Bad Request**

```json
{
  "message": "Attach the image as multipart field \"file\"",
  "error": "Bad Request",
  "statusCode": 400
}
```

### 49. Remove the cover image (admin)

`DELETE /groups/:groupId/cover-image` 🔒

**Response 200 OK**

```json
{
  "id": "e03e87cf-d598-4969-ba7a-3d8ac6ebefff",
  "name": "Ladakh Ride 2026",
  "description": "Manali → Leh, 9 days",
  "tripStart": "2026-10-10T00:00:00.000Z",
  "tripEnd": "2026-10-19T00:00:00.000Z",
  "currency": "INR",
  "createdById": "64135665-35b8-4956-861a-e99b87c09958",
  "createdAt": "2026-10-14T08:58:02.317Z",
  "closedAt": null,
  "deleteAfter": null,
  "coverImageUrl": null,
  "myRole": "ADMIN",
  "memberCount": 2
}
```

### 50. Download when there is no cover

`GET /groups/:groupId/cover-image` 🔒

**Response 404 Not Found**

```json
{
  "message": "This trip has no cover image",
  "error": "Not Found",
  "statusCode": 404
}
```

### 51. Upload it again (kept for the rest of the walkthrough)

`POST /groups/:groupId/cover-image` 🔒

**Request** (multipart/form-data)

- `file`: cover.png (image/png, 128 bytes)

**Response 200 OK**

```json
{
  "id": "e03e87cf-d598-4969-ba7a-3d8ac6ebefff",
  "name": "Ladakh Ride 2026",
  "description": "Manali → Leh, 9 days",
  "tripStart": "2026-10-10T00:00:00.000Z",
  "tripEnd": "2026-10-19T00:00:00.000Z",
  "currency": "INR",
  "createdById": "64135665-35b8-4956-861a-e99b87c09958",
  "createdAt": "2026-10-14T08:58:02.317Z",
  "closedAt": null,
  "deleteAfter": null,
  "coverImageUrl": "http://localhost:3000/groups/e03e87cf-d598-4969-ba7a-3d8ac6ebefff/cover-image?v=b022cba5-3221-471c-b332-b37f20befbb9",
  "myRole": "ADMIN",
  "memberCount": 2
}
```

## Profile picture

### 52. Upload my profile picture

`POST /auth/me/avatar` 🔒

**Request** (multipart/form-data)

- `file`: me.jpg (image/jpeg, 124 bytes)

**Response 200 OK**

```json
{
  "id": "64135665-35b8-4956-861a-e99b87c09958",
  "username": "demo_alice",
  "email": "demo.alice@example.com",
  "phone": "+919812345611",
  "name": "Alice Rider",
  "avatarUrl": "http://localhost:3000/users/64135665-35b8-4956-861a-e99b87c09958/avatar?v=c87a688c-e509-4399-ae6b-fb93cd28a665",
  "emailVerified": true,
  "phoneVerified": true,
  "createdAt": "2026-10-14T08:57:58.303Z"
}
```

**Event `user:profile_updated` received by Bob (shares a trip with Alice)**

```json
{
  "userId": "64135665-35b8-4956-861a-e99b87c09958",
  "username": "demo_alice",
  "name": "Alice Rider",
  "avatarUrl": "http://localhost:3000/users/64135665-35b8-4956-861a-e99b87c09958/avatar?v=c87a688c-e509-4399-ae6b-fb93cd28a665",
  "timestamp": "2026-10-14T08:58:06.682Z"
}
```

### 53. Members see avatarUrl

`GET /groups/:groupId/members` 🔒

**Response 200 OK**

```json
[
  {
    "userId": "64135665-35b8-4956-861a-e99b87c09958",
    "username": "demo_alice",
    "name": "Alice Rider",
    "avatarUrl": "http://localhost:3000/users/64135665-35b8-4956-861a-e99b87c09958/avatar?v=c87a688c-e509-4399-ae6b-fb93cd28a665",
    "role": "ADMIN",
    "joinedAt": "2026-10-14T08:58:02.317Z"
  },
  {
    "userId": "e8b0c791-0ecf-40ab-b2be-3c714a96f23e",
    "username": "demo_bob",
    "name": "Bob Kumar",
    "avatarUrl": null,
    "role": "VIEWER",
    "joinedAt": "2026-10-14T08:58:03.527Z"
  }
]
```

### 54. Download the picture (no token needed)

`GET /users/:userId/avatar?v=c87a688c-e509-4399-ae6b-fb93cd28a665`

**Response 200 OK**

`(binary, 124 bytes) Content-Type: image/jpeg`

### 55. Upload a picture that is not a JPEG/PNG/WebP

`POST /auth/me/avatar` 🔒

**Request** (multipart/form-data)

- `file`: me.jpg (image/jpeg, 24 bytes)

**Response 415 Unsupported Media Type**

```json
{
  "message": "Profile picture must be a JPEG, PNG or WebP",
  "error": "Unsupported Media Type",
  "statusCode": 415
}
```

### 56. Upload a picture (Bob)

`POST /auth/me/avatar` 🔒

**Request** (multipart/form-data)

- `file`: me.png (image/png, 128 bytes)

**Response 200 OK**

```json
{
  "id": "e8b0c791-0ecf-40ab-b2be-3c714a96f23e",
  "username": "demo_bob",
  "email": "demo.bob@example.com",
  "phone": "+919812345612",
  "name": "Bob Kumar",
  "avatarUrl": "http://localhost:3000/users/e8b0c791-0ecf-40ab-b2be-3c714a96f23e/avatar?v=6733c452-4b17-41c7-9e90-cf5f71d4392a",
  "emailVerified": true,
  "phoneVerified": true,
  "createdAt": "2026-10-14T08:57:59.240Z"
}
```

### 57. Remove my profile picture (back to initials)

`DELETE /auth/me/avatar` 🔒

**Response 200 OK**

```json
{
  "id": "e8b0c791-0ecf-40ab-b2be-3c714a96f23e",
  "username": "demo_bob",
  "email": "demo.bob@example.com",
  "phone": "+919812345612",
  "name": "Bob Kumar",
  "avatarUrl": null,
  "emailVerified": true,
  "phoneVerified": true,
  "createdAt": "2026-10-14T08:57:59.240Z"
}
```

### 58. Picture of someone without one

`GET /users/:userId/avatar`

**Response 404 Not Found**

```json
{
  "message": "This user has no profile picture",
  "error": "Not Found",
  "statusCode": 404
}
```

## Invites — email / SMS

### 59. Invite by email

`POST /groups/:groupId/invites` 🔒

**Request**
```json
{
  "channel": "EMAIL",
  "email": "demo.carol@example.com"
}
```

**Response 201 Created**

```json
{
  "id": "062191c2-6bbb-483a-8d42-b4093306f8f9",
  "groupId": "e03e87cf-d598-4969-ba7a-3d8ac6ebefff",
  "channel": "EMAIL",
  "status": "PENDING",
  "inviteeEmail": "demo.carol@example.com",
  "inviteePhone": null,
  "invitedBy": {
    "id": "64135665-35b8-4956-861a-e99b87c09958"
  },
  "expiresAt": "2026-10-21T08:58:07.814Z",
  "createdAt": "2026-10-14T08:58:07.826Z"
}
```

_Delivered: Email to demo.carol@example.com: "Join "Ladakh Ride 2026" on TravelGo"_

### 60. Invite the same person again

`POST /groups/:groupId/invites` 🔒

**Request**
```json
{
  "channel": "EMAIL",
  "email": "demo.carol@example.com"
}
```

**Response 409 Conflict**

```json
{
  "message": "A pending invite already exists for this person — revoke it to send a new one",
  "error": "Conflict",
  "statusCode": 409
}
```

### 61. Email invite without an email

`POST /groups/:groupId/invites` 🔒

**Request**
```json
{
  "channel": "EMAIL"
}
```

**Response 400 Bad Request**

```json
{
  "message": [
    "email must be an email"
  ],
  "error": "Bad Request",
  "statusCode": 400
}
```

### 62. List pending invites (admin)

`GET /groups/:groupId/invites` 🔒

**Response 200 OK**

```json
[
  {
    "id": "062191c2-6bbb-483a-8d42-b4093306f8f9",
    "groupId": "e03e87cf-d598-4969-ba7a-3d8ac6ebefff",
    "channel": "EMAIL",
    "status": "PENDING",
    "inviteeEmail": "demo.carol@example.com",
    "inviteePhone": null,
    "invitedBy": {
      "id": "64135665-35b8-4956-861a-e99b87c09958",
      "username": "demo_alice",
      "name": "Alice Rider"
    },
    "expiresAt": "2026-10-21T08:58:07.814Z",
    "createdAt": "2026-10-14T08:58:07.826Z"
  }
]
```

### 63. My pending invitations (Carol)

`GET /invites` 🔒

**Response 200 OK**

```json
[
  {
    "id": "062191c2-6bbb-483a-8d42-b4093306f8f9",
    "groupId": "e03e87cf-d598-4969-ba7a-3d8ac6ebefff",
    "channel": "EMAIL",
    "status": "PENDING",
    "inviteeEmail": "demo.carol@example.com",
    "inviteePhone": null,
    "invitedBy": {
      "id": "64135665-35b8-4956-861a-e99b87c09958",
      "username": "demo_alice",
      "name": "Alice Rider"
    },
    "expiresAt": "2026-10-21T08:58:07.814Z",
    "createdAt": "2026-10-14T08:58:07.826Z",
    "group": {
      "id": "e03e87cf-d598-4969-ba7a-3d8ac6ebefff",
      "name": "Ladakh Ride 2026",
      "description": "Manali → Leh, 9 days",
      "tripStart": "2026-10-10T00:00:00.000Z",
      "tripEnd": "2026-10-19T00:00:00.000Z"
    }
  }
]
```

### 64. Reject an invitation

`POST /invites/:inviteId/reject` 🔒

**Response 201 Created**

```json
{
  "groupId": "e03e87cf-d598-4969-ba7a-3d8ac6ebefff",
  "status": "REJECTED"
}
```

### 65. Accept an already-rejected invitation

`POST /invites/:inviteId/accept` 🔒

**Response 409 Conflict**

```json
{
  "message": "Invite has already been rejected",
  "error": "Conflict",
  "statusCode": 409
}
```

### 66. Invite by SMS (someone not on TravelGo yet)

`POST /groups/:groupId/invites` 🔒

**Request**
```json
{
  "channel": "SMS",
  "phone": "+919800000099"
}
```

**Response 201 Created**

```json
{
  "id": "6c4cc164-d645-47a9-8042-c66418d11dab",
  "groupId": "e03e87cf-d598-4969-ba7a-3d8ac6ebefff",
  "channel": "SMS",
  "status": "PENDING",
  "inviteeEmail": null,
  "inviteePhone": "+919800000099",
  "invitedBy": {
    "id": "64135665-35b8-4956-861a-e99b87c09958"
  },
  "expiresAt": "2026-10-21T08:58:08.991Z",
  "createdAt": "2026-10-14T08:58:09.000Z"
}
```

_Delivered: SMS to +919800000099: "Alice Rider (@demo_alice) invited you to join "Ladakh Ride 2026" on TravelGo. Sign in or sign up with this phone number to accept."_

### 67. Revoke an invite (admin)

`DELETE /groups/:groupId/invites/:inviteId` 🔒

**Response 200 OK**

_(empty body)_

### 68. Invite by email again

`POST /groups/:groupId/invites` 🔒

**Request**
```json
{
  "channel": "EMAIL",
  "email": "demo.carol@example.com"
}
```

**Response 201 Created**

```json
{
  "id": "a01eec5a-f150-48a3-b14d-20b8c1c25bb4",
  "groupId": "e03e87cf-d598-4969-ba7a-3d8ac6ebefff",
  "channel": "EMAIL",
  "status": "PENDING",
  "inviteeEmail": "demo.carol@example.com",
  "inviteePhone": null,
  "invitedBy": {
    "id": "64135665-35b8-4956-861a-e99b87c09958"
  },
  "expiresAt": "2026-10-21T08:58:09.321Z",
  "createdAt": "2026-10-14T08:58:09.330Z"
}
```

### 69. Accept an invitation

`POST /invites/:inviteId/accept` 🔒

**Response 201 Created**

```json
{
  "groupId": "e03e87cf-d598-4969-ba7a-3d8ac6ebefff",
  "status": "ACCEPTED"
}
```

**Event `member:joined` received by Alice**

```json
{
  "groupId": "e03e87cf-d598-4969-ba7a-3d8ac6ebefff",
  "member": {
    "userId": "378ba245-309f-497b-938a-8cfc74d924a6",
    "username": "demo_carol",
    "name": "Carol Singh",
    "avatarUrl": null,
    "role": "VIEWER",
    "joinedAt": "2026-10-14T08:58:09.504Z"
  },
  "via": "INVITE",
  "addedBy": "64135665-35b8-4956-861a-e99b87c09958",
  "timestamp": "2026-10-14T08:58:09.504Z"
}
```

### 70. Leave the group (own userId)

`DELETE /groups/:groupId/members/:userId` 🔒

**Response 200 OK**

_(empty body)_

**Event `member:removed` received by Alice (Carol gets it too)**

```json
{
  "groupId": "e03e87cf-d598-4969-ba7a-3d8ac6ebefff",
  "userId": "378ba245-309f-497b-938a-8cfc74d924a6",
  "removedBy": "378ba245-309f-497b-938a-8cfc74d924a6",
  "left": true,
  "timestamp": "2026-10-14T08:58:09.667Z"
}
```

## Invites — share link

### 71. Create a share link

`POST /groups/:groupId/invites` 🔒

**Request**
```json
{
  "channel": "LINK",
  "expiresInDays": 7
}
```

**Response 201 Created**

```json
{
  "id": "34e34df9-82ec-4061-8589-e874a371a939",
  "groupId": "e03e87cf-d598-4969-ba7a-3d8ac6ebefff",
  "channel": "LINK",
  "status": "PENDING",
  "inviteeEmail": null,
  "inviteePhone": null,
  "invitedBy": {
    "id": "64135665-35b8-4956-861a-e99b87c09958"
  },
  "expiresAt": "2026-10-21T08:58:09.832Z",
  "createdAt": "2026-10-14T08:58:09.840Z",
  "token": "hHwHkBZhvhKbqyrBVNlrCIMA2dcUxUHBlUJfHN889ps",
  "link": "https://travelgo.app/invite/hHwHkBZhvhKbqyrBVNlrCIMA2dcUxUHBlUJfHN889ps"
}
```

### 72. Preview a share link

`GET /invites/link/:token` 🔒

**Response 200 OK**

```json
{
  "group": {
    "id": "e03e87cf-d598-4969-ba7a-3d8ac6ebefff",
    "name": "Ladakh Ride 2026",
    "description": "Manali → Leh, 9 days",
    "tripStart": "2026-10-10T00:00:00.000Z",
    "tripEnd": "2026-10-19T00:00:00.000Z"
  },
  "invitedBy": {
    "id": "64135665-35b8-4956-861a-e99b87c09958",
    "username": "demo_alice",
    "name": "Alice Rider"
  },
  "expiresAt": "2026-10-21T08:58:09.832Z",
  "alreadyMember": false
}
```

### 73. Join via share link

`POST /invites/link/:token/accept` 🔒

**Response 201 Created**

```json
{
  "groupId": "e03e87cf-d598-4969-ba7a-3d8ac6ebefff"
}
```

**Event `member:joined` received by Alice**

```json
{
  "groupId": "e03e87cf-d598-4969-ba7a-3d8ac6ebefff",
  "member": {
    "userId": "378ba245-309f-497b-938a-8cfc74d924a6",
    "username": "demo_carol",
    "name": "Carol Singh",
    "avatarUrl": null,
    "role": "VIEWER",
    "joinedAt": "2026-10-14T08:58:10.177Z"
  },
  "via": "LINK",
  "addedBy": "64135665-35b8-4956-861a-e99b87c09958",
  "timestamp": "2026-10-14T08:58:10.172Z"
}
```

### 74. Viewer tries to remove another member

`DELETE /groups/:groupId/members/:userId` 🔒

**Response 403 Forbidden**

```json
{
  "message": "Only a group admin can remove other members",
  "error": "Forbidden",
  "statusCode": 403
}
```

### 75. Revoke the link (admin)

`DELETE /groups/:groupId/invites/:inviteId` 🔒

**Response 200 OK**

_(empty body)_

### 76. Preview a revoked link

`GET /invites/link/:token` 🔒

**Response 404 Not Found**

```json
{
  "message": "Invite link is invalid, revoked or expired",
  "error": "Not Found",
  "statusCode": 404
}
```

## Itinerary — draft & pins (admin)

### 77. No finalized itinerary yet

`GET /groups/:groupId/itinerary` 🔒

**Response 404 Not Found**

```json
{
  "message": "No finalized itinerary yet",
  "error": "Not Found",
  "statusCode": 404
}
```

### 78. Viewer tries to start a draft

`POST /groups/:groupId/itinerary/draft` 🔒

**Response 403 Forbidden**

```json
{
  "message": "Requires group role: ADMIN",
  "error": "Forbidden",
  "statusCode": 403
}
```

### 79. Start a draft

`POST /groups/:groupId/itinerary/draft` 🔒

**Response 201 Created**

```json
{
  "id": "0046507d-b984-4dee-9a72-e5e5c094790a",
  "groupId": "e03e87cf-d598-4969-ba7a-3d8ac6ebefff",
  "status": "DRAFT",
  "version": null,
  "basedOnVersion": null,
  "revision": 0,
  "createdById": "64135665-35b8-4956-861a-e99b87c09958",
  "createdAt": "2026-10-14T08:58:11.135Z",
  "lockedAt": null,
  "waypoints": []
}
```

### 80. Start a second draft

`POST /groups/:groupId/itinerary/draft` 🔒

**Response 409 Conflict**

```json
{
  "message": "This group already has a draft itinerary",
  "error": "Conflict",
  "statusCode": 409
}
```

### 81. Drop a pin (first pin = START)

`POST /groups/:groupId/itinerary/draft/waypoints` 🔒

**Request**
```json
{
  "name": "Manali",
  "lat": 32.2432,
  "lng": 77.1892,
  "date": "2026-10-10",
  "notes": "Meet at the bus stand, 6 am"
}
```

**Response 201 Created**

```json
{
  "id": "0046507d-b984-4dee-9a72-e5e5c094790a",
  "groupId": "e03e87cf-d598-4969-ba7a-3d8ac6ebefff",
  "status": "DRAFT",
  "version": null,
  "basedOnVersion": null,
  "revision": 1,
  "createdById": "64135665-35b8-4956-861a-e99b87c09958",
  "createdAt": "2026-10-14T08:58:11.135Z",
  "lockedAt": null,
  "waypoints": [
    {
      "id": "5da37780-b28f-48a9-b308-99b897f28282",
      "activityId": "ba9c2563-ed5b-46b6-b68b-77c3fcb8a229",
      "position": 1,
      "role": "START",
      "name": "Manali",
      "lat": 32.2432,
      "lng": 77.1892,
      "date": "2026-10-10",
      "outsideTripDates": false,
      "notes": "Meet at the bus stand, 6 am",
      "elevation": {
        "status": "OK",
        "meters": 1878,
        "oxygenPercentOfSeaLevel": 80,
        "effectiveOxygenPercent": 16.6,
        "zone": "HIGH"
      },
      "weather": {
        "status": "PAST_DATE",
        "fetchedAt": "2026-10-14T08:58:11.498Z"
      },
      "activity": {
        "status": "UPCOMING",
        "statusUpdatedAt": null,
        "statusUpdatedBy": null,
        "updateCount": 0
      }
    }
  ]
}
```

### 82. Finalize with only 1 pin

`POST /groups/:groupId/itinerary/draft/finalize` 🔒

**Response 400 Bad Request**

```json
{
  "message": "An itinerary needs at least 2 waypoints (a start and an end point) to be finalized",
  "error": "Bad Request",
  "statusCode": 400
}
```

### 83. Drop a second pin (appended = END)

`POST /groups/:groupId/itinerary/draft/waypoints` 🔒

**Request**
```json
{
  "name": "Leh",
  "lat": 34.1526,
  "lng": 77.5771,
  "date": "2026-10-13"
}
```

**Response 201 Created**

```json
{
  "id": "0046507d-b984-4dee-9a72-e5e5c094790a",
  "groupId": "e03e87cf-d598-4969-ba7a-3d8ac6ebefff",
  "status": "DRAFT",
  "version": null,
  "basedOnVersion": null,
  "revision": 2,
  "createdById": "64135665-35b8-4956-861a-e99b87c09958",
  "createdAt": "2026-10-14T08:58:11.135Z",
  "lockedAt": null,
  "waypoints": [
    {
      "id": "5da37780-b28f-48a9-b308-99b897f28282",
      "activityId": "ba9c2563-ed5b-46b6-b68b-77c3fcb8a229",
      "position": 1,
      "role": "START",
      "name": "Manali",
      "lat": 32.2432,
      "lng": 77.1892,
      "date": "2026-10-10",
      "outsideTripDates": false,
      "notes": "Meet at the bus stand, 6 am",
      "elevation": {
        "status": "OK",
        "meters": 1878,
        "oxygenPercentOfSeaLevel": 80,
        "effectiveOxygenPercent": 16.6,
        "zone": "HIGH"
      },
      "weather": {
        "status": "PAST_DATE",
        "fetchedAt": "2026-10-14T08:58:11.498Z"
      },
      "activity": {
        "status": "UPCOMING",
        "statusUpdatedAt": null,
        "statusUpdatedBy": null,
        "updateCount": 0
      }
    },
    {
      "id": "ab14f9f1-3536-4e81-91c7-39a70819ecc8",
      "activityId": "1730b97a-407d-4102-b57d-9a34b7ff364c",
      "position": 2,
      "role": "END",
      "name": "Leh",
      "lat": 34.1526,
      "lng": 77.5771,
      "date": "2026-10-13",
      "outsideTripDates": false,
      "notes": null,
      "elevation": {
        "status": "OK",
        "meters": 3414,
        "oxygenPercentOfSeaLevel": 66,
        "effectiveOxygenPercent": 13.7,
        "zone": "HIGH"
      },
      "weather": {
        "status": "UNAVAILABLE",
        "fetchedAt": "2026-10-14T08:58:12.833Z"
      },
      "activity": {
        "status": "UPCOMING",
        "statusUpdatedAt": null,
        "statusUpdatedBy": null,
        "updateCount": 0
      }
    }
  ]
}
```

### 84. Insert a pin in the middle (position 2)

`POST /groups/:groupId/itinerary/draft/waypoints` 🔒

**Request**
```json
{
  "name": "Keylong",
  "lat": 32.5715,
  "lng": 77.0326,
  "date": "2026-10-11",
  "position": 2
}
```

**Response 201 Created**

```json
{
  "id": "0046507d-b984-4dee-9a72-e5e5c094790a",
  "groupId": "e03e87cf-d598-4969-ba7a-3d8ac6ebefff",
  "status": "DRAFT",
  "version": null,
  "basedOnVersion": null,
  "revision": 3,
  "createdById": "64135665-35b8-4956-861a-e99b87c09958",
  "createdAt": "2026-10-14T08:58:11.135Z",
  "lockedAt": null,
  "waypoints": [
    {
      "id": "5da37780-b28f-48a9-b308-99b897f28282",
      "activityId": "ba9c2563-ed5b-46b6-b68b-77c3fcb8a229",
      "position": 1,
      "role": "START",
      "name": "Manali",
      "lat": 32.2432,
      "lng": 77.1892,
      "date": "2026-10-10",
      "outsideTripDates": false,
      "notes": "Meet at the bus stand, 6 am",
      "elevation": {
        "status": "OK",
        "meters": 1878,
        "oxygenPercentOfSeaLevel": 80,
        "effectiveOxygenPercent": 16.6,
        "zone": "HIGH"
      },
      "weather": {
        "status": "PAST_DATE",
        "fetchedAt": "2026-10-14T08:58:11.498Z"
      },
      "activity": {
        "status": "UPCOMING",
        "statusUpdatedAt": null,
        "statusUpdatedBy": null,
        "updateCount": 0
      }
    },
    {
      "id": "e33a5c95-2394-4fb4-b75f-6ba94cea7c6d",
      "activityId": "3fc88f43-f7bd-42fc-8678-45601f47401a",
      "position": 2,
      "role": "MID",
      "name": "Keylong",
      "lat": 32.5715,
      "lng": 77.0326,
      "date": "2026-10-11",
      "outsideTripDates": false,
      "notes": null,
      "elevation": {
        "status": "OK",
        "meters": 3112,
        "oxygenPercentOfSeaLevel": 68,
        "effectiveOxygenPercent": 14.3,
        "zone": "HIGH"
      },
      "weather": {
        "status": "PAST_DATE",
        "fetchedAt": "2026-10-14T08:58:13.231Z"
      },
      "activity": {
        "status": "UPCOMING",
        "statusUpdatedAt": null,
        "statusUpdatedBy": null,
        "updateCount": 0
      }
    },
    {
      "id": "ab14f9f1-3536-4e81-91c7-39a70819ecc8",
      "activityId": "1730b97a-407d-4102-b57d-9a34b7ff364c",
      "position": 3,
      "role": "END",
      "name": "Leh",
      "lat": 34.1526,
      "lng": 77.5771,
      "date": "2026-10-13",
      "outsideTripDates": false,
      "notes": null,
      "elevation": {
        "status": "OK",
        "meters": 3414,
        "oxygenPercentOfSeaLevel": 66,
        "effectiveOxygenPercent": 13.7,
        "zone": "HIGH"
      },
      "weather": {
        "status": "UNAVAILABLE",
        "fetchedAt": "2026-10-14T08:58:12.833Z"
      },
      "activity": {
        "status": "UPCOMING",
        "statusUpdatedAt": null,
        "statusUpdatedBy": null,
        "updateCount": 0
      }
    }
  ]
}
```

### 85. Invalid pin (lat out of range, bad date)

`POST /groups/:groupId/itinerary/draft/waypoints` 🔒

**Request**
```json
{
  "name": "Nowhere",
  "lat": 123,
  "lng": 77,
  "date": "13/10/2026"
}
```

**Response 400 Bad Request**

```json
{
  "message": [
    "lat must not be greater than 90",
    "date must be a valid ISO 8601 date string",
    "date must be YYYY-MM-DD"
  ],
  "error": "Bad Request",
  "statusCode": 400
}
```

### 86. Edit a pin (add notes)

`PATCH /groups/:groupId/itinerary/draft/waypoints/:waypointId` 🔒

**Request**
```json
{
  "notes": "Fuel up: last pump for 365 km"
}
```

**Response 200 OK**

```json
{
  "id": "0046507d-b984-4dee-9a72-e5e5c094790a",
  "groupId": "e03e87cf-d598-4969-ba7a-3d8ac6ebefff",
  "status": "DRAFT",
  "version": null,
  "basedOnVersion": null,
  "revision": 4,
  "createdById": "64135665-35b8-4956-861a-e99b87c09958",
  "createdAt": "2026-10-14T08:58:11.135Z",
  "lockedAt": null,
  "waypoints": [
    {
      "id": "5da37780-b28f-48a9-b308-99b897f28282",
      "activityId": "ba9c2563-ed5b-46b6-b68b-77c3fcb8a229",
      "position": 1,
      "role": "START",
      "name": "Manali",
      "lat": 32.2432,
      "lng": 77.1892,
      "date": "2026-10-10",
      "outsideTripDates": false,
      "notes": "Meet at the bus stand, 6 am",
      "elevation": {
        "status": "OK",
        "meters": 1878,
        "oxygenPercentOfSeaLevel": 80,
        "effectiveOxygenPercent": 16.6,
        "zone": "HIGH"
      },
      "weather": {
        "status": "PAST_DATE",
        "fetchedAt": "2026-10-14T08:58:11.498Z"
      },
      "activity": {
        "status": "UPCOMING",
        "statusUpdatedAt": null,
        "statusUpdatedBy": null,
        "updateCount": 0
      }
    },
    {
      "id": "e33a5c95-2394-4fb4-b75f-6ba94cea7c6d",
      "activityId": "3fc88f43-f7bd-42fc-8678-45601f47401a",
      "position": 2,
      "role": "MID",
      "name": "Keylong",
      "lat": 32.5715,
      "lng": 77.0326,
      "date": "2026-10-11",
      "outsideTripDates": false,
      "notes": "Fuel up: last pump for 365 km",
      "elevation": {
        "status": "OK",
        "meters": 3112,
        "oxygenPercentOfSeaLevel": 68,
        "effectiveOxygenPercent": 14.3,
        "zone": "HIGH"
      },
      "weather": {
        "status": "PAST_DATE",
        "fetchedAt": "2026-10-14T08:58:13.231Z"
      },
      "activity": {
        "status": "UPCOMING",
        "statusUpdatedAt": null,
        "statusUpdatedBy": null,
        "updateCount": 0
      }
    },
    {
      "id": "ab14f9f1-3536-4e81-91c7-39a70819ecc8",
      "activityId": "1730b97a-407d-4102-b57d-9a34b7ff364c",
      "position": 3,
      "role": "END",
      "name": "Leh",
      "lat": 34.1526,
      "lng": 77.5771,
      "date": "2026-10-13",
      "outsideTripDates": false,
      "notes": null,
      "elevation": {
        "status": "OK",
        "meters": 3414,
        "oxygenPercentOfSeaLevel": 66,
        "effectiveOxygenPercent": 13.7,
        "zone": "HIGH"
      },
      "weather": {
        "status": "UNAVAILABLE",
        "fetchedAt": "2026-10-14T08:58:12.833Z"
      },
      "activity": {
        "status": "UPCOMING",
        "statusUpdatedAt": null,
        "statusUpdatedBy": null,
        "updateCount": 0
      }
    }
  ]
}
```

### 87. Edit with an outdated revision (If-Match)

`PATCH /groups/:groupId/itinerary/draft/waypoints/:waypointId` 🔒

**Header** `If-Match: 3`

**Request**
```json
{
  "notes": "stale edit"
}
```

**Response 412 Precondition Failed**

```json
{
  "message": "The draft has changed since you loaded it (now revision 4). Reload it, then try again.",
  "error": "Precondition Failed",
  "statusCode": 412
}
```

### 88. Reorder with a missing pin

`PUT /groups/:groupId/itinerary/draft/waypoints/order` 🔒

**Request**
```json
{
  "waypointIds": [
    "5da37780-b28f-48a9-b308-99b897f28282",
    "e33a5c95-2394-4fb4-b75f-6ba94cea7c6d"
  ]
}
```

**Response 400 Bad Request**

```json
{
  "message": "waypointIds must list every waypoint in the draft exactly once",
  "error": "Bad Request",
  "statusCode": 400
}
```

### 89. Viewer tries to see the draft

`GET /groups/:groupId/itinerary/draft` 🔒

**Response 403 Forbidden**

```json
{
  "message": "Requires group role: ADMIN",
  "error": "Forbidden",
  "statusCode": 403
}
```

### 90. Get the draft

`GET /groups/:groupId/itinerary/draft` 🔒

**Response 200 OK**

```json
{
  "id": "0046507d-b984-4dee-9a72-e5e5c094790a",
  "groupId": "e03e87cf-d598-4969-ba7a-3d8ac6ebefff",
  "status": "DRAFT",
  "version": null,
  "basedOnVersion": null,
  "revision": 4,
  "createdById": "64135665-35b8-4956-861a-e99b87c09958",
  "createdAt": "2026-10-14T08:58:11.135Z",
  "lockedAt": null,
  "waypoints": [
    {
      "id": "5da37780-b28f-48a9-b308-99b897f28282",
      "activityId": "ba9c2563-ed5b-46b6-b68b-77c3fcb8a229",
      "position": 1,
      "role": "START",
      "name": "Manali",
      "lat": 32.2432,
      "lng": 77.1892,
      "date": "2026-10-10",
      "outsideTripDates": false,
      "notes": "Meet at the bus stand, 6 am",
      "elevation": {
        "status": "OK",
        "meters": 1878,
        "oxygenPercentOfSeaLevel": 80,
        "effectiveOxygenPercent": 16.6,
        "zone": "HIGH"
      },
      "weather": {
        "status": "PAST_DATE",
        "fetchedAt": "2026-10-14T08:58:11.498Z"
      },
      "activity": {
        "status": "UPCOMING",
        "statusUpdatedAt": null,
        "statusUpdatedBy": null,
        "updateCount": 0
      }
    },
    {
      "id": "e33a5c95-2394-4fb4-b75f-6ba94cea7c6d",
      "activityId": "3fc88f43-f7bd-42fc-8678-45601f47401a",
      "position": 2,
      "role": "MID",
      "name": "Keylong",
      "lat": 32.5715,
      "lng": 77.0326,
      "date": "2026-10-11",
      "outsideTripDates": false,
      "notes": "Fuel up: last pump for 365 km",
      "elevation": {
        "status": "OK",
        "meters": 3112,
        "oxygenPercentOfSeaLevel": 68,
        "effectiveOxygenPercent": 14.3,
        "zone": "HIGH"
      },
      "weather": {
        "status": "PAST_DATE",
        "fetchedAt": "2026-10-14T08:58:13.231Z"
      },
      "activity": {
        "status": "UPCOMING",
        "statusUpdatedAt": null,
        "statusUpdatedBy": null,
        "updateCount": 0
      }
    },
    {
      "id": "ab14f9f1-3536-4e81-91c7-39a70819ecc8",
      "activityId": "1730b97a-407d-4102-b57d-9a34b7ff364c",
      "position": 3,
      "role": "END",
      "name": "Leh",
      "lat": 34.1526,
      "lng": 77.5771,
      "date": "2026-10-13",
      "outsideTripDates": false,
      "notes": null,
      "elevation": {
        "status": "OK",
        "meters": 3414,
        "oxygenPercentOfSeaLevel": 66,
        "effectiveOxygenPercent": 13.7,
        "zone": "HIGH"
      },
      "weather": {
        "status": "UNAVAILABLE",
        "fetchedAt": "2026-10-14T08:58:12.833Z"
      },
      "activity": {
        "status": "UPCOMING",
        "statusUpdatedAt": null,
        "statusUpdatedBy": null,
        "updateCount": 0
      }
    }
  ]
}
```

## Itinerary — finalize, versions, PDF

### 91. Finalize (becomes version 1)

`POST /groups/:groupId/itinerary/draft/finalize` 🔒

**Response 201 Created**

```json
{
  "id": "0046507d-b984-4dee-9a72-e5e5c094790a",
  "groupId": "e03e87cf-d598-4969-ba7a-3d8ac6ebefff",
  "status": "LOCKED",
  "version": 1,
  "basedOnVersion": null,
  "revision": 4,
  "createdById": "64135665-35b8-4956-861a-e99b87c09958",
  "createdAt": "2026-10-14T08:58:11.135Z",
  "lockedAt": "2026-10-14T08:58:14.601Z",
  "waypoints": [
    {
      "id": "5da37780-b28f-48a9-b308-99b897f28282",
      "activityId": "ba9c2563-ed5b-46b6-b68b-77c3fcb8a229",
      "position": 1,
      "role": "START",
      "name": "Manali",
      "lat": 32.2432,
      "lng": 77.1892,
      "date": "2026-10-10",
      "outsideTripDates": false,
      "notes": "Meet at the bus stand, 6 am",
      "elevation": {
        "status": "OK",
        "meters": 1878,
        "oxygenPercentOfSeaLevel": 80,
        "effectiveOxygenPercent": 16.6,
        "zone": "HIGH"
      },
      "weather": {
        "status": "PAST_DATE",
        "fetchedAt": "2026-10-14T08:58:11.498Z"
      },
      "activity": {
        "status": "UPCOMING",
        "statusUpdatedAt": null,
        "statusUpdatedBy": null,
        "updateCount": 0
      }
    },
    {
      "id": "e33a5c95-2394-4fb4-b75f-6ba94cea7c6d",
      "activityId": "3fc88f43-f7bd-42fc-8678-45601f47401a",
      "position": 2,
      "role": "MID",
      "name": "Keylong",
      "lat": 32.5715,
      "lng": 77.0326,
      "date": "2026-10-11",
      "outsideTripDates": false,
      "notes": "Fuel up: last pump for 365 km",
      "elevation": {
        "status": "OK",
        "meters": 3112,
        "oxygenPercentOfSeaLevel": 68,
        "effectiveOxygenPercent": 14.3,
        "zone": "HIGH"
      },
      "weather": {
        "status": "PAST_DATE",
        "fetchedAt": "2026-10-14T08:58:13.231Z"
      },
      "activity": {
        "status": "UPCOMING",
        "statusUpdatedAt": null,
        "statusUpdatedBy": null,
        "updateCount": 0
      }
    },
    {
      "id": "ab14f9f1-3536-4e81-91c7-39a70819ecc8",
      "activityId": "1730b97a-407d-4102-b57d-9a34b7ff364c",
      "position": 3,
      "role": "END",
      "name": "Leh",
      "lat": 34.1526,
      "lng": 77.5771,
      "date": "2026-10-13",
      "outsideTripDates": false,
      "notes": null,
      "elevation": {
        "status": "OK",
        "meters": 3414,
        "oxygenPercentOfSeaLevel": 66,
        "effectiveOxygenPercent": 13.7,
        "zone": "HIGH"
      },
      "weather": {
        "status": "UNAVAILABLE",
        "fetchedAt": "2026-10-14T08:58:12.833Z"
      },
      "activity": {
        "status": "UPCOMING",
        "statusUpdatedAt": null,
        "statusUpdatedBy": null,
        "updateCount": 0
      }
    }
  ]
}
```

**Event `itinerary:updated` received by Bob**

```json
{
  "groupId": "e03e87cf-d598-4969-ba7a-3d8ac6ebefff",
  "version": 1,
  "lockedAt": "2026-10-14T08:58:14.601Z"
}
```

### 92. Latest finalized itinerary (viewer)

`GET /groups/:groupId/itinerary` 🔒

**Response 200 OK**

```json
{
  "id": "0046507d-b984-4dee-9a72-e5e5c094790a",
  "groupId": "e03e87cf-d598-4969-ba7a-3d8ac6ebefff",
  "status": "LOCKED",
  "version": 1,
  "basedOnVersion": null,
  "revision": 4,
  "createdById": "64135665-35b8-4956-861a-e99b87c09958",
  "createdAt": "2026-10-14T08:58:11.135Z",
  "lockedAt": "2026-10-14T08:58:14.601Z",
  "waypoints": [
    {
      "id": "5da37780-b28f-48a9-b308-99b897f28282",
      "activityId": "ba9c2563-ed5b-46b6-b68b-77c3fcb8a229",
      "position": 1,
      "role": "START",
      "name": "Manali",
      "lat": 32.2432,
      "lng": 77.1892,
      "date": "2026-10-10",
      "outsideTripDates": false,
      "notes": "Meet at the bus stand, 6 am",
      "elevation": {
        "status": "OK",
        "meters": 1878,
        "oxygenPercentOfSeaLevel": 80,
        "effectiveOxygenPercent": 16.6,
        "zone": "HIGH"
      },
      "weather": {
        "status": "PAST_DATE",
        "fetchedAt": "2026-10-14T08:58:11.498Z"
      },
      "activity": {
        "status": "UPCOMING",
        "statusUpdatedAt": null,
        "statusUpdatedBy": null,
        "updateCount": 0
      }
    },
    {
      "id": "e33a5c95-2394-4fb4-b75f-6ba94cea7c6d",
      "activityId": "3fc88f43-f7bd-42fc-8678-45601f47401a",
      "position": 2,
      "role": "MID",
      "name": "Keylong",
      "lat": 32.5715,
      "lng": 77.0326,
      "date": "2026-10-11",
      "outsideTripDates": false,
      "notes": "Fuel up: last pump for 365 km",
      "elevation": {
        "status": "OK",
        "meters": 3112,
        "oxygenPercentOfSeaLevel": 68,
        "effectiveOxygenPercent": 14.3,
        "zone": "HIGH"
      },
      "weather": {
        "status": "PAST_DATE",
        "fetchedAt": "2026-10-14T08:58:13.231Z"
      },
      "activity": {
        "status": "UPCOMING",
        "statusUpdatedAt": null,
        "statusUpdatedBy": null,
        "updateCount": 0
      }
    },
    {
      "id": "ab14f9f1-3536-4e81-91c7-39a70819ecc8",
      "activityId": "1730b97a-407d-4102-b57d-9a34b7ff364c",
      "position": 3,
      "role": "END",
      "name": "Leh",
      "lat": 34.1526,
      "lng": 77.5771,
      "date": "2026-10-13",
      "outsideTripDates": false,
      "notes": null,
      "elevation": {
        "status": "OK",
        "meters": 3414,
        "oxygenPercentOfSeaLevel": 66,
        "effectiveOxygenPercent": 13.7,
        "zone": "HIGH"
      },
      "weather": {
        "status": "UNAVAILABLE",
        "fetchedAt": "2026-10-14T08:58:12.833Z"
      },
      "activity": {
        "status": "UPCOMING",
        "statusUpdatedAt": null,
        "statusUpdatedBy": null,
        "updateCount": 0
      }
    }
  ]
}
```

### 93. Route map: the stops joined along roads

`GET /groups/:groupId/itinerary/route` 🔒

_Arrays are shortened here: `geometry.coordinates` has every point of the road line, `legs` one entry per pair of stops._


**Response 200 OK**

```json
{
  "itineraryId": "0046507d-b984-4dee-9a72-e5e5c094790a",
  "itineraryStatus": "LOCKED",
  "version": 1,
  "status": "OK",
  "profile": "driving",
  "distanceMeters": 425416,
  "durationSeconds": 21330,
  "geometry": {
    "type": "LineString",
    "coordinates": [
      [
        77.1892,
        "…1 more"
      ],
      "…12238 more"
    ]
  },
  "legs": [
    {
      "distanceMeters": 70592,
      "durationSeconds": 3286,
      "routed": true,
      "fromActivityId": "ba9c2563-ed5b-46b6-b68b-77c3fcb8a229",
      "toActivityId": "3fc88f43-f7bd-42fc-8678-45601f47401a"
    },
    "…1 more"
  ],
  "attribution": "Routes: OSRM, © OpenStreetMap contributors",
  "computedAt": "2026-10-14T08:58:16.253Z"
}
```

### 94. Download as PDF

`GET /groups/:groupId/itinerary/pdf` 🔒

**Response 200 OK**

`(binary, 489659 bytes) Content-Type: application/pdf; Content-Disposition: attachment; filename="ladakh-ride-2026-itinerary-v1.pdf"`

### 95. Start a new draft (copy of version 1, same activityIds)

`POST /groups/:groupId/itinerary/draft` 🔒

**Response 201 Created**

```json
{
  "id": "2998b6c6-0dab-47db-9a43-17a9005b9b37",
  "groupId": "e03e87cf-d598-4969-ba7a-3d8ac6ebefff",
  "status": "DRAFT",
  "version": null,
  "basedOnVersion": 1,
  "revision": 0,
  "createdById": "64135665-35b8-4956-861a-e99b87c09958",
  "createdAt": "2026-10-14T08:58:18.556Z",
  "lockedAt": null,
  "waypoints": [
    {
      "id": "e2a09900-dbe4-4686-b83f-953562233289",
      "activityId": "ba9c2563-ed5b-46b6-b68b-77c3fcb8a229",
      "position": 1,
      "role": "START",
      "name": "Manali",
      "lat": 32.2432,
      "lng": 77.1892,
      "date": "2026-10-10",
      "outsideTripDates": false,
      "notes": "Meet at the bus stand, 6 am",
      "elevation": {
        "status": "OK",
        "meters": 1878,
        "oxygenPercentOfSeaLevel": 80,
        "effectiveOxygenPercent": 16.6,
        "zone": "HIGH"
      },
      "weather": {
        "status": "PAST_DATE",
        "fetchedAt": "2026-10-14T08:58:11.498Z"
      },
      "activity": {
        "status": "UPCOMING",
        "statusUpdatedAt": null,
        "statusUpdatedBy": null,
        "updateCount": 0
      }
    },
    {
      "id": "f5f84872-9da9-411b-ba3b-fd3c7eebbd40",
      "activityId": "3fc88f43-f7bd-42fc-8678-45601f47401a",
      "position": 2,
      "role": "MID",
      "name": "Keylong",
      "lat": 32.5715,
      "lng": 77.0326,
      "date": "2026-10-11",
      "outsideTripDates": false,
      "notes": "Fuel up: last pump for 365 km",
      "elevation": {
        "status": "OK",
        "meters": 3112,
        "oxygenPercentOfSeaLevel": 68,
        "effectiveOxygenPercent": 14.3,
        "zone": "HIGH"
      },
      "weather": {
        "status": "PAST_DATE",
        "fetchedAt": "2026-10-14T08:58:13.231Z"
      },
      "activity": {
        "status": "UPCOMING",
        "statusUpdatedAt": null,
        "statusUpdatedBy": null,
        "updateCount": 0
      }
    },
    {
      "id": "688a61bf-a322-45a6-8b8c-3e4506539531",
      "activityId": "1730b97a-407d-4102-b57d-9a34b7ff364c",
      "position": 3,
      "role": "END",
      "name": "Leh",
      "lat": 34.1526,
      "lng": 77.5771,
      "date": "2026-10-13",
      "outsideTripDates": false,
      "notes": null,
      "elevation": {
        "status": "OK",
        "meters": 3414,
        "oxygenPercentOfSeaLevel": 66,
        "effectiveOxygenPercent": 13.7,
        "zone": "HIGH"
      },
      "weather": {
        "status": "UNAVAILABLE",
        "fetchedAt": "2026-10-14T08:58:12.833Z"
      },
      "activity": {
        "status": "UPCOMING",
        "statusUpdatedAt": null,
        "statusUpdatedBy": null,
        "updateCount": 0
      }
    }
  ]
}
```

### 96. Add a stop

`POST /groups/:groupId/itinerary/draft/waypoints` 🔒

_The draft's waypoints keep the activityIds of version 1 (e.g. Manali = `ba9c2563-ed5b-46b6-b68b-77c3fcb8a229`)._


**Request**
```json
{
  "name": "Jispa",
  "lat": 32.6403,
  "lng": 77.1887,
  "date": "2026-10-12",
  "position": 3
}
```

**Response 201 Created**

```json
{
  "id": "2998b6c6-0dab-47db-9a43-17a9005b9b37",
  "groupId": "e03e87cf-d598-4969-ba7a-3d8ac6ebefff",
  "status": "DRAFT",
  "version": null,
  "basedOnVersion": 1,
  "revision": 1,
  "createdById": "64135665-35b8-4956-861a-e99b87c09958",
  "createdAt": "2026-10-14T08:58:18.556Z",
  "lockedAt": null,
  "waypoints": [
    {
      "id": "e2a09900-dbe4-4686-b83f-953562233289",
      "activityId": "ba9c2563-ed5b-46b6-b68b-77c3fcb8a229",
      "position": 1,
      "role": "START",
      "name": "Manali",
      "lat": 32.2432,
      "lng": 77.1892,
      "date": "2026-10-10",
      "outsideTripDates": false,
      "notes": "Meet at the bus stand, 6 am",
      "elevation": {
        "status": "OK",
        "meters": 1878,
        "oxygenPercentOfSeaLevel": 80,
        "effectiveOxygenPercent": 16.6,
        "zone": "HIGH"
      },
      "weather": {
        "status": "PAST_DATE",
        "fetchedAt": "2026-10-14T08:58:11.498Z"
      },
      "activity": {
        "status": "UPCOMING",
        "statusUpdatedAt": null,
        "statusUpdatedBy": null,
        "updateCount": 0
      }
    },
    {
      "id": "f5f84872-9da9-411b-ba3b-fd3c7eebbd40",
      "activityId": "3fc88f43-f7bd-42fc-8678-45601f47401a",
      "position": 2,
      "role": "MID",
      "name": "Keylong",
      "lat": 32.5715,
      "lng": 77.0326,
      "date": "2026-10-11",
      "outsideTripDates": false,
      "notes": "Fuel up: last pump for 365 km",
      "elevation": {
        "status": "OK",
        "meters": 3112,
        "oxygenPercentOfSeaLevel": 68,
        "effectiveOxygenPercent": 14.3,
        "zone": "HIGH"
      },
      "weather": {
        "status": "PAST_DATE",
        "fetchedAt": "2026-10-14T08:58:13.231Z"
      },
      "activity": {
        "status": "UPCOMING",
        "statusUpdatedAt": null,
        "statusUpdatedBy": null,
        "updateCount": 0
      }
    },
    {
      "id": "b309aadf-3670-4112-b29c-64f60dad3520",
      "activityId": "861efa8d-3438-4998-ae35-ce515b57e715",
      "position": 3,
      "role": "MID",
      "name": "Jispa",
      "lat": 32.6403,
      "lng": 77.1887,
      "date": "2026-10-12",
      "outsideTripDates": false,
      "notes": null,
      "elevation": {
        "status": "OK",
        "meters": 3266,
        "oxygenPercentOfSeaLevel": 67,
        "effectiveOxygenPercent": 14,
        "zone": "HIGH"
      },
      "weather": {
        "status": "PAST_DATE",
        "fetchedAt": "2026-10-14T08:58:18.741Z"
      },
      "activity": {
        "status": "UPCOMING",
        "statusUpdatedAt": null,
        "statusUpdatedBy": null,
        "updateCount": 0
      }
    },
    {
      "id": "688a61bf-a322-45a6-8b8c-3e4506539531",
      "activityId": "1730b97a-407d-4102-b57d-9a34b7ff364c",
      "position": 4,
      "role": "END",
      "name": "Leh",
      "lat": 34.1526,
      "lng": 77.5771,
      "date": "2026-10-13",
      "outsideTripDates": false,
      "notes": null,
      "elevation": {
        "status": "OK",
        "meters": 3414,
        "oxygenPercentOfSeaLevel": 66,
        "effectiveOxygenPercent": 13.7,
        "zone": "HIGH"
      },
      "weather": {
        "status": "UNAVAILABLE",
        "fetchedAt": "2026-10-14T08:58:12.833Z"
      },
      "activity": {
        "status": "UPCOMING",
        "statusUpdatedAt": null,
        "statusUpdatedBy": null,
        "updateCount": 0
      }
    }
  ]
}
```

### 97. Preview the draft route (admin)

`GET /groups/:groupId/itinerary/draft/route` 🔒

**Response 200 OK**

```json
{
  "itineraryId": "2998b6c6-0dab-47db-9a43-17a9005b9b37",
  "itineraryStatus": "DRAFT",
  "version": null,
  "status": "OK",
  "profile": "driving",
  "distanceMeters": 426005,
  "durationSeconds": 21446,
  "geometry": {
    "type": "LineString",
    "coordinates": [
      [
        77.1892,
        "…1 more"
      ],
      "…12273 more"
    ]
  },
  "legs": [
    {
      "distanceMeters": 70592,
      "durationSeconds": 3286,
      "routed": true,
      "fromActivityId": "ba9c2563-ed5b-46b6-b68b-77c3fcb8a229",
      "toActivityId": "3fc88f43-f7bd-42fc-8678-45601f47401a"
    },
    "…2 more"
  ],
  "attribution": "Routes: OSRM, © OpenStreetMap contributors",
  "computedAt": "2026-10-14T08:58:20.440Z"
}
```

### 98. Finalize again (version 2)

`POST /groups/:groupId/itinerary/draft/finalize` 🔒

**Response 201 Created**

```json
{
  "id": "2998b6c6-0dab-47db-9a43-17a9005b9b37",
  "groupId": "e03e87cf-d598-4969-ba7a-3d8ac6ebefff",
  "status": "LOCKED",
  "version": 2,
  "basedOnVersion": 1,
  "revision": 1,
  "createdById": "64135665-35b8-4956-861a-e99b87c09958",
  "createdAt": "2026-10-14T08:58:18.556Z",
  "lockedAt": "2026-10-14T08:58:20.642Z",
  "waypoints": [
    {
      "id": "e2a09900-dbe4-4686-b83f-953562233289",
      "activityId": "ba9c2563-ed5b-46b6-b68b-77c3fcb8a229",
      "position": 1,
      "role": "START",
      "name": "Manali",
      "lat": 32.2432,
      "lng": 77.1892,
      "date": "2026-10-10",
      "outsideTripDates": false,
      "notes": "Meet at the bus stand, 6 am",
      "elevation": {
        "status": "OK",
        "meters": 1878,
        "oxygenPercentOfSeaLevel": 80,
        "effectiveOxygenPercent": 16.6,
        "zone": "HIGH"
      },
      "weather": {
        "status": "PAST_DATE",
        "fetchedAt": "2026-10-14T08:58:11.498Z"
      },
      "activity": {
        "status": "UPCOMING",
        "statusUpdatedAt": null,
        "statusUpdatedBy": null,
        "updateCount": 0
      }
    },
    {
      "id": "f5f84872-9da9-411b-ba3b-fd3c7eebbd40",
      "activityId": "3fc88f43-f7bd-42fc-8678-45601f47401a",
      "position": 2,
      "role": "MID",
      "name": "Keylong",
      "lat": 32.5715,
      "lng": 77.0326,
      "date": "2026-10-11",
      "outsideTripDates": false,
      "notes": "Fuel up: last pump for 365 km",
      "elevation": {
        "status": "OK",
        "meters": 3112,
        "oxygenPercentOfSeaLevel": 68,
        "effectiveOxygenPercent": 14.3,
        "zone": "HIGH"
      },
      "weather": {
        "status": "PAST_DATE",
        "fetchedAt": "2026-10-14T08:58:13.231Z"
      },
      "activity": {
        "status": "UPCOMING",
        "statusUpdatedAt": null,
        "statusUpdatedBy": null,
        "updateCount": 0
      }
    },
    {
      "id": "b309aadf-3670-4112-b29c-64f60dad3520",
      "activityId": "861efa8d-3438-4998-ae35-ce515b57e715",
      "position": 3,
      "role": "MID",
      "name": "Jispa",
      "lat": 32.6403,
      "lng": 77.1887,
      "date": "2026-10-12",
      "outsideTripDates": false,
      "notes": null,
      "elevation": {
        "status": "OK",
        "meters": 3266,
        "oxygenPercentOfSeaLevel": 67,
        "effectiveOxygenPercent": 14,
        "zone": "HIGH"
      },
      "weather": {
        "status": "PAST_DATE",
        "fetchedAt": "2026-10-14T08:58:18.741Z"
      },
      "activity": {
        "status": "UPCOMING",
        "statusUpdatedAt": null,
        "statusUpdatedBy": null,
        "updateCount": 0
      }
    },
    {
      "id": "688a61bf-a322-45a6-8b8c-3e4506539531",
      "activityId": "1730b97a-407d-4102-b57d-9a34b7ff364c",
      "position": 4,
      "role": "END",
      "name": "Leh",
      "lat": 34.1526,
      "lng": 77.5771,
      "date": "2026-10-13",
      "outsideTripDates": false,
      "notes": null,
      "elevation": {
        "status": "OK",
        "meters": 3414,
        "oxygenPercentOfSeaLevel": 66,
        "effectiveOxygenPercent": 13.7,
        "zone": "HIGH"
      },
      "weather": {
        "status": "UNAVAILABLE",
        "fetchedAt": "2026-10-14T08:58:12.833Z"
      },
      "activity": {
        "status": "UPCOMING",
        "statusUpdatedAt": null,
        "statusUpdatedBy": null,
        "updateCount": 0
      }
    }
  ]
}
```

### 99. List versions

`GET /groups/:groupId/itinerary/versions` 🔒

**Response 200 OK**

```json
[
  {
    "id": "2998b6c6-0dab-47db-9a43-17a9005b9b37",
    "version": 2,
    "lockedAt": "2026-10-14T08:58:20.642Z",
    "createdById": "64135665-35b8-4956-861a-e99b87c09958",
    "waypointCount": 4
  },
  {
    "id": "0046507d-b984-4dee-9a72-e5e5c094790a",
    "version": 1,
    "lockedAt": "2026-10-14T08:58:14.601Z",
    "createdById": "64135665-35b8-4956-861a-e99b87c09958",
    "waypointCount": 3
  }
]
```

### 100. Get version 1 (unchanged)

`GET /groups/:groupId/itinerary/versions/:version` 🔒

**Response 200 OK**

```json
{
  "id": "0046507d-b984-4dee-9a72-e5e5c094790a",
  "groupId": "e03e87cf-d598-4969-ba7a-3d8ac6ebefff",
  "status": "LOCKED",
  "version": 1,
  "basedOnVersion": null,
  "revision": 4,
  "createdById": "64135665-35b8-4956-861a-e99b87c09958",
  "createdAt": "2026-10-14T08:58:11.135Z",
  "lockedAt": "2026-10-14T08:58:14.601Z",
  "waypoints": [
    {
      "id": "5da37780-b28f-48a9-b308-99b897f28282",
      "activityId": "ba9c2563-ed5b-46b6-b68b-77c3fcb8a229",
      "position": 1,
      "role": "START",
      "name": "Manali",
      "lat": 32.2432,
      "lng": 77.1892,
      "date": "2026-10-10",
      "outsideTripDates": false,
      "notes": "Meet at the bus stand, 6 am",
      "elevation": {
        "status": "OK",
        "meters": 1878,
        "oxygenPercentOfSeaLevel": 80,
        "effectiveOxygenPercent": 16.6,
        "zone": "HIGH"
      },
      "weather": {
        "status": "PAST_DATE",
        "fetchedAt": "2026-10-14T08:58:11.498Z"
      },
      "activity": {
        "status": "UPCOMING",
        "statusUpdatedAt": null,
        "statusUpdatedBy": null,
        "updateCount": 0
      }
    },
    {
      "id": "e33a5c95-2394-4fb4-b75f-6ba94cea7c6d",
      "activityId": "3fc88f43-f7bd-42fc-8678-45601f47401a",
      "position": 2,
      "role": "MID",
      "name": "Keylong",
      "lat": 32.5715,
      "lng": 77.0326,
      "date": "2026-10-11",
      "outsideTripDates": false,
      "notes": "Fuel up: last pump for 365 km",
      "elevation": {
        "status": "OK",
        "meters": 3112,
        "oxygenPercentOfSeaLevel": 68,
        "effectiveOxygenPercent": 14.3,
        "zone": "HIGH"
      },
      "weather": {
        "status": "PAST_DATE",
        "fetchedAt": "2026-10-14T08:58:13.231Z"
      },
      "activity": {
        "status": "UPCOMING",
        "statusUpdatedAt": null,
        "statusUpdatedBy": null,
        "updateCount": 0
      }
    },
    {
      "id": "ab14f9f1-3536-4e81-91c7-39a70819ecc8",
      "activityId": "1730b97a-407d-4102-b57d-9a34b7ff364c",
      "position": 3,
      "role": "END",
      "name": "Leh",
      "lat": 34.1526,
      "lng": 77.5771,
      "date": "2026-10-13",
      "outsideTripDates": false,
      "notes": null,
      "elevation": {
        "status": "OK",
        "meters": 3414,
        "oxygenPercentOfSeaLevel": 66,
        "effectiveOxygenPercent": 13.7,
        "zone": "HIGH"
      },
      "weather": {
        "status": "UNAVAILABLE",
        "fetchedAt": "2026-10-14T08:58:12.833Z"
      },
      "activity": {
        "status": "UPCOMING",
        "statusUpdatedAt": null,
        "statusUpdatedBy": null,
        "updateCount": 0
      }
    }
  ]
}
```

### 101. Version that does not exist

`GET /groups/:groupId/itinerary/versions/:version` 🔒

**Response 404 Not Found**

```json
{
  "message": "Itinerary version 99 not found",
  "error": "Not Found",
  "statusCode": 404
}
```

### 102. Refresh elevation/weather on the latest version (admin)

`POST /groups/:groupId/itinerary/refresh` 🔒

**Response 201 Created**

```json
{
  "id": "2998b6c6-0dab-47db-9a43-17a9005b9b37",
  "groupId": "e03e87cf-d598-4969-ba7a-3d8ac6ebefff",
  "status": "LOCKED",
  "version": 2,
  "basedOnVersion": 1,
  "revision": 1,
  "createdById": "64135665-35b8-4956-861a-e99b87c09958",
  "createdAt": "2026-10-14T08:58:18.556Z",
  "lockedAt": "2026-10-14T08:58:20.642Z",
  "waypoints": [
    {
      "id": "e2a09900-dbe4-4686-b83f-953562233289",
      "activityId": "ba9c2563-ed5b-46b6-b68b-77c3fcb8a229",
      "position": 1,
      "role": "START",
      "name": "Manali",
      "lat": 32.2432,
      "lng": 77.1892,
      "date": "2026-10-10",
      "outsideTripDates": false,
      "notes": "Meet at the bus stand, 6 am",
      "elevation": {
        "status": "OK",
        "meters": 1878,
        "oxygenPercentOfSeaLevel": 80,
        "effectiveOxygenPercent": 16.6,
        "zone": "HIGH"
      },
      "weather": {
        "status": "PAST_DATE",
        "fetchedAt": "2026-10-14T08:58:21.340Z"
      },
      "activity": {
        "status": "UPCOMING",
        "statusUpdatedAt": null,
        "statusUpdatedBy": null,
        "updateCount": 0
      }
    },
    {
      "id": "f5f84872-9da9-411b-ba3b-fd3c7eebbd40",
      "activityId": "3fc88f43-f7bd-42fc-8678-45601f47401a",
      "position": 2,
      "role": "MID",
      "name": "Keylong",
      "lat": 32.5715,
      "lng": 77.0326,
      "date": "2026-10-11",
      "outsideTripDates": false,
      "notes": "Fuel up: last pump for 365 km",
      "elevation": {
        "status": "OK",
        "meters": 3112,
        "oxygenPercentOfSeaLevel": 68,
        "effectiveOxygenPercent": 14.3,
        "zone": "HIGH"
      },
      "weather": {
        "status": "PAST_DATE",
        "fetchedAt": "2026-10-14T08:58:21.341Z"
      },
      "activity": {
        "status": "UPCOMING",
        "statusUpdatedAt": null,
        "statusUpdatedBy": null,
        "updateCount": 0
      }
    },
    {
      "id": "b309aadf-3670-4112-b29c-64f60dad3520",
      "activityId": "861efa8d-3438-4998-ae35-ce515b57e715",
      "position": 3,
      "role": "MID",
      "name": "Jispa",
      "lat": 32.6403,
      "lng": 77.1887,
      "date": "2026-10-12",
      "outsideTripDates": false,
      "notes": null,
      "elevation": {
        "status": "OK",
        "meters": 3266,
        "oxygenPercentOfSeaLevel": 67,
        "effectiveOxygenPercent": 14,
        "zone": "HIGH"
      },
      "weather": {
        "status": "PAST_DATE",
        "fetchedAt": "2026-10-14T08:58:21.341Z"
      },
      "activity": {
        "status": "UPCOMING",
        "statusUpdatedAt": null,
        "statusUpdatedBy": null,
        "updateCount": 0
      }
    },
    {
      "id": "688a61bf-a322-45a6-8b8c-3e4506539531",
      "activityId": "1730b97a-407d-4102-b57d-9a34b7ff364c",
      "position": 4,
      "role": "END",
      "name": "Leh",
      "lat": 34.1526,
      "lng": 77.5771,
      "date": "2026-10-13",
      "outsideTripDates": false,
      "notes": null,
      "elevation": {
        "status": "OK",
        "meters": 3414,
        "oxygenPercentOfSeaLevel": 66,
        "effectiveOxygenPercent": 13.7,
        "zone": "HIGH"
      },
      "weather": {
        "status": "UNAVAILABLE",
        "fetchedAt": "2026-10-14T08:58:21.342Z"
      },
      "activity": {
        "status": "UPCOMING",
        "statusUpdatedAt": null,
        "statusUpdatedBy": null,
        "updateCount": 0
      }
    }
  ]
}
```

### 103. Start a draft to discard

`POST /groups/:groupId/itinerary/draft` 🔒

**Response 201 Created**

```json
{
  "id": "dad7d7b3-9354-4e29-95a4-27eb14170840",
  "groupId": "e03e87cf-d598-4969-ba7a-3d8ac6ebefff",
  "status": "DRAFT",
  "version": null,
  "basedOnVersion": 2,
  "revision": 0,
  "createdById": "64135665-35b8-4956-861a-e99b87c09958",
  "createdAt": "2026-10-14T08:58:22.411Z",
  "lockedAt": null,
  "waypoints": [
    {
      "id": "11fba6e3-c168-49e3-9b0b-b852069eeab8",
      "activityId": "ba9c2563-ed5b-46b6-b68b-77c3fcb8a229",
      "position": 1,
      "role": "START",
      "name": "Manali",
      "lat": 32.2432,
      "lng": 77.1892,
      "date": "2026-10-10",
      "outsideTripDates": false,
      "notes": "Meet at the bus stand, 6 am",
      "elevation": {
        "status": "OK",
        "meters": 1878,
        "oxygenPercentOfSeaLevel": 80,
        "effectiveOxygenPercent": 16.6,
        "zone": "HIGH"
      },
      "weather": {
        "status": "PAST_DATE",
        "fetchedAt": "2026-10-14T08:58:21.340Z"
      },
      "activity": {
        "status": "UPCOMING",
        "statusUpdatedAt": null,
        "statusUpdatedBy": null,
        "updateCount": 0
      }
    },
    {
      "id": "cbbdf903-ec0d-4a56-9ec6-8497d2a3900f",
      "activityId": "3fc88f43-f7bd-42fc-8678-45601f47401a",
      "position": 2,
      "role": "MID",
      "name": "Keylong",
      "lat": 32.5715,
      "lng": 77.0326,
      "date": "2026-10-11",
      "outsideTripDates": false,
      "notes": "Fuel up: last pump for 365 km",
      "elevation": {
        "status": "OK",
        "meters": 3112,
        "oxygenPercentOfSeaLevel": 68,
        "effectiveOxygenPercent": 14.3,
        "zone": "HIGH"
      },
      "weather": {
        "status": "PAST_DATE",
        "fetchedAt": "2026-10-14T08:58:21.341Z"
      },
      "activity": {
        "status": "UPCOMING",
        "statusUpdatedAt": null,
        "statusUpdatedBy": null,
        "updateCount": 0
      }
    },
    {
      "id": "476bc367-719c-4e7b-81fd-040376a06303",
      "activityId": "861efa8d-3438-4998-ae35-ce515b57e715",
      "position": 3,
      "role": "MID",
      "name": "Jispa",
      "lat": 32.6403,
      "lng": 77.1887,
      "date": "2026-10-12",
      "outsideTripDates": false,
      "notes": null,
      "elevation": {
        "status": "OK",
        "meters": 3266,
        "oxygenPercentOfSeaLevel": 67,
        "effectiveOxygenPercent": 14,
        "zone": "HIGH"
      },
      "weather": {
        "status": "PAST_DATE",
        "fetchedAt": "2026-10-14T08:58:21.341Z"
      },
      "activity": {
        "status": "UPCOMING",
        "statusUpdatedAt": null,
        "statusUpdatedBy": null,
        "updateCount": 0
      }
    },
    {
      "id": "0376ed55-c1e1-4d0b-a23e-121a4a7603c3",
      "activityId": "1730b97a-407d-4102-b57d-9a34b7ff364c",
      "position": 4,
      "role": "END",
      "name": "Leh",
      "lat": 34.1526,
      "lng": 77.5771,
      "date": "2026-10-13",
      "outsideTripDates": false,
      "notes": null,
      "elevation": {
        "status": "OK",
        "meters": 3414,
        "oxygenPercentOfSeaLevel": 66,
        "effectiveOxygenPercent": 13.7,
        "zone": "HIGH"
      },
      "weather": {
        "status": "UNAVAILABLE",
        "fetchedAt": "2026-10-14T08:58:21.342Z"
      },
      "activity": {
        "status": "UPCOMING",
        "statusUpdatedAt": null,
        "statusUpdatedBy": null,
        "updateCount": 0
      }
    }
  ]
}
```

### 104. Discard the draft

`DELETE /groups/:groupId/itinerary/draft` 🔒

**Response 200 OK**

_(empty body)_

### 105. Discard when there is no draft

`DELETE /groups/:groupId/itinerary/draft` 🔒

**Response 404 Not Found**

```json
{
  "message": "No draft itinerary",
  "error": "Not Found",
  "statusCode": 404
}
```

## Activities — status & updates

### 106. List activities (stops of the latest version)

`GET /groups/:groupId/activities` 🔒

**Response 200 OK**

```json
{
  "itineraryVersion": 2,
  "activities": [
    {
      "activityId": "ba9c2563-ed5b-46b6-b68b-77c3fcb8a229",
      "waypointId": "e2a09900-dbe4-4686-b83f-953562233289",
      "position": 1,
      "role": "START",
      "name": "Manali",
      "date": "2026-10-10",
      "status": "UPCOMING",
      "statusUpdatedAt": null,
      "statusUpdatedBy": null,
      "updateCount": 0
    },
    {
      "activityId": "3fc88f43-f7bd-42fc-8678-45601f47401a",
      "waypointId": "f5f84872-9da9-411b-ba3b-fd3c7eebbd40",
      "position": 2,
      "role": "MID",
      "name": "Keylong",
      "date": "2026-10-11",
      "status": "UPCOMING",
      "statusUpdatedAt": null,
      "statusUpdatedBy": null,
      "updateCount": 0
    },
    {
      "activityId": "861efa8d-3438-4998-ae35-ce515b57e715",
      "waypointId": "b309aadf-3670-4112-b29c-64f60dad3520",
      "position": 3,
      "role": "MID",
      "name": "Jispa",
      "date": "2026-10-12",
      "status": "UPCOMING",
      "statusUpdatedAt": null,
      "statusUpdatedBy": null,
      "updateCount": 0
    },
    {
      "activityId": "1730b97a-407d-4102-b57d-9a34b7ff364c",
      "waypointId": "688a61bf-a322-45a6-8b8c-3e4506539531",
      "position": 4,
      "role": "END",
      "name": "Leh",
      "date": "2026-10-13",
      "status": "UPCOMING",
      "statusUpdatedAt": null,
      "statusUpdatedBy": null,
      "updateCount": 0
    }
  ]
}
```

### 107. Viewer tries to set a status

`PATCH /groups/:groupId/activities/:activityId/status` 🔒

**Request**
```json
{
  "status": "CURRENT"
}
```

**Response 403 Forbidden**

```json
{
  "message": "Requires group role: ADMIN",
  "error": "Forbidden",
  "statusCode": 403
}
```

### 108. Set Manali CURRENT (admin)

`PATCH /groups/:groupId/activities/:activityId/status` 🔒

**Request**
```json
{
  "status": "CURRENT"
}
```

**Response 200 OK**

```json
{
  "activityId": "ba9c2563-ed5b-46b6-b68b-77c3fcb8a229",
  "waypointId": "e2a09900-dbe4-4686-b83f-953562233289",
  "position": 1,
  "role": "START",
  "name": "Manali",
  "date": "2026-10-10",
  "status": "CURRENT",
  "statusUpdatedAt": "2026-10-14T08:58:23.261Z",
  "statusUpdatedBy": {
    "userId": "64135665-35b8-4956-861a-e99b87c09958",
    "name": "Alice Rider"
  },
  "updateCount": 0
}
```

**Event `activity:status_updated` received by Bob**

```json
{
  "groupId": "e03e87cf-d598-4969-ba7a-3d8ac6ebefff",
  "activityId": "ba9c2563-ed5b-46b6-b68b-77c3fcb8a229",
  "status": "CURRENT",
  "updatedBy": "64135665-35b8-4956-861a-e99b87c09958",
  "timestamp": "2026-10-14T08:58:23.264Z"
}
```

### 109. Move on: Keylong CURRENT (Manali is completed automatically)

`PATCH /groups/:groupId/activities/:activityId/status` 🔒

**Request**
```json
{
  "status": "CURRENT"
}
```

**Response 200 OK**

```json
{
  "activityId": "3fc88f43-f7bd-42fc-8678-45601f47401a",
  "waypointId": "f5f84872-9da9-411b-ba3b-fd3c7eebbd40",
  "position": 2,
  "role": "MID",
  "name": "Keylong",
  "date": "2026-10-11",
  "status": "CURRENT",
  "statusUpdatedAt": "2026-10-14T08:58:23.452Z",
  "statusUpdatedBy": {
    "userId": "64135665-35b8-4956-861a-e99b87c09958",
    "name": "Alice Rider"
  },
  "updateCount": 0
}
```

**Event `activity:status_updated` received by Bob (1 of 2)**

```json
{
  "groupId": "e03e87cf-d598-4969-ba7a-3d8ac6ebefff",
  "activityId": "ba9c2563-ed5b-46b6-b68b-77c3fcb8a229",
  "status": "COMPLETED",
  "updatedBy": "64135665-35b8-4956-861a-e99b87c09958",
  "timestamp": "2026-10-14T08:58:23.455Z"
}
```

**Event `activity:status_updated` received by Bob (2 of 2)**

```json
{
  "groupId": "e03e87cf-d598-4969-ba7a-3d8ac6ebefff",
  "activityId": "3fc88f43-f7bd-42fc-8678-45601f47401a",
  "status": "CURRENT",
  "updatedBy": "64135665-35b8-4956-861a-e99b87c09958",
  "timestamp": "2026-10-14T08:58:23.455Z"
}
```

### 110. Unknown status

`PATCH /groups/:groupId/activities/:activityId/status` 🔒

**Request**
```json
{
  "status": "DONE"
}
```

**Response 400 Bad Request**

```json
{
  "message": [
    "status must be one of the following values: UPCOMING, CURRENT, COMPLETED"
  ],
  "error": "Bad Request",
  "statusCode": 400
}
```

### 111. Post an update (any member)

`POST /groups/:groupId/activities/:activityId/updates` 🔒

**Request**
```json
{
  "text": "Petrol pump at Tandi is open till 8 pm",
  "clientId": "1044a436-9fa9-42a7-8fd4-965197ed309a"
}
```

**Response 201 Created**

```json
{
  "id": "dc4f403e-0862-464d-87a3-84affe6a4c06",
  "groupId": "e03e87cf-d598-4969-ba7a-3d8ac6ebefff",
  "activityId": "3fc88f43-f7bd-42fc-8678-45601f47401a",
  "author": {
    "userId": "e8b0c791-0ecf-40ab-b2be-3c714a96f23e",
    "username": "demo_bob",
    "name": "Bob Kumar",
    "avatarUrl": null
  },
  "text": "Petrol pump at Tandi is open till 8 pm",
  "createdAt": "2026-10-14T08:58:23.806Z",
  "editedAt": null,
  "canEdit": true,
  "canDelete": true
}
```

**Event `activity:update_added` received by Alice**

```json
{
  "groupId": "e03e87cf-d598-4969-ba7a-3d8ac6ebefff",
  "activityId": "3fc88f43-f7bd-42fc-8678-45601f47401a",
  "updateId": "dc4f403e-0862-464d-87a3-84affe6a4c06",
  "update": {
    "id": "dc4f403e-0862-464d-87a3-84affe6a4c06",
    "groupId": "e03e87cf-d598-4969-ba7a-3d8ac6ebefff",
    "activityId": "3fc88f43-f7bd-42fc-8678-45601f47401a",
    "author": {
      "userId": "e8b0c791-0ecf-40ab-b2be-3c714a96f23e",
      "username": "demo_bob",
      "name": "Bob Kumar",
      "avatarUrl": null
    },
    "text": "Petrol pump at Tandi is open till 8 pm",
    "createdAt": "2026-10-14T08:58:23.806Z",
    "editedAt": null
  },
  "timestamp": "2026-10-14T08:58:23.806Z"
}
```

### 112. Another update

`POST /groups/:groupId/activities/:activityId/updates` 🔒

**Request**
```json
{
  "text": "Lunch at the dhaba near the bridge"
}
```

**Response 201 Created**

```json
{
  "id": "936ef3be-b1f2-47a1-8c36-fd1f32932615",
  "groupId": "e03e87cf-d598-4969-ba7a-3d8ac6ebefff",
  "activityId": "3fc88f43-f7bd-42fc-8678-45601f47401a",
  "author": {
    "userId": "64135665-35b8-4956-861a-e99b87c09958",
    "username": "demo_alice",
    "name": "Alice Rider",
    "avatarUrl": "http://localhost:3000/users/64135665-35b8-4956-861a-e99b87c09958/avatar?v=c87a688c-e509-4399-ae6b-fb93cd28a665"
  },
  "text": "Lunch at the dhaba near the bridge",
  "createdAt": "2026-10-14T08:58:23.981Z",
  "editedAt": null,
  "canEdit": true,
  "canDelete": true
}
```

### 113. An activity's updates (newest first, paged)

`GET /groups/:groupId/activities/:activityId/updates?limit=1` 🔒

**Response 200 OK**

```json
{
  "items": [
    {
      "id": "936ef3be-b1f2-47a1-8c36-fd1f32932615",
      "groupId": "e03e87cf-d598-4969-ba7a-3d8ac6ebefff",
      "activityId": "3fc88f43-f7bd-42fc-8678-45601f47401a",
      "author": {
        "userId": "64135665-35b8-4956-861a-e99b87c09958",
        "username": "demo_alice",
        "name": "Alice Rider",
        "avatarUrl": "http://localhost:3000/users/64135665-35b8-4956-861a-e99b87c09958/avatar?v=c87a688c-e509-4399-ae6b-fb93cd28a665"
      },
      "text": "Lunch at the dhaba near the bridge",
      "createdAt": "2026-10-14T08:58:23.981Z",
      "editedAt": null,
      "canEdit": false,
      "canDelete": false
    }
  ],
  "nextBefore": "936ef3be-b1f2-47a1-8c36-fd1f32932615"
}
```

### 114. Next page

`GET /groups/:groupId/activities/:activityId/updates?limit=1&before=936ef3be-b1f2-47a1-8c36-fd1f32932615` 🔒

**Response 200 OK**

```json
{
  "items": [
    {
      "id": "dc4f403e-0862-464d-87a3-84affe6a4c06",
      "groupId": "e03e87cf-d598-4969-ba7a-3d8ac6ebefff",
      "activityId": "3fc88f43-f7bd-42fc-8678-45601f47401a",
      "author": {
        "userId": "e8b0c791-0ecf-40ab-b2be-3c714a96f23e",
        "username": "demo_bob",
        "name": "Bob Kumar",
        "avatarUrl": null
      },
      "text": "Petrol pump at Tandi is open till 8 pm",
      "createdAt": "2026-10-14T08:58:23.806Z",
      "editedAt": null,
      "canEdit": true,
      "canDelete": true
    }
  ],
  "nextBefore": null
}
```

### 115. Edit someone else's update

`PATCH /groups/:groupId/activity-updates/:updateId` 🔒

**Request**
```json
{
  "text": "changed"
}
```

**Response 403 Forbidden**

```json
{
  "message": "Only the author can edit an update",
  "error": "Forbidden",
  "statusCode": 403
}
```

### 116. Edit my own update

`PATCH /groups/:groupId/activity-updates/:updateId` 🔒

**Request**
```json
{
  "text": "Petrol pump at Tandi closes at 8 pm sharp"
}
```

**Response 200 OK**

```json
{
  "id": "dc4f403e-0862-464d-87a3-84affe6a4c06",
  "groupId": "e03e87cf-d598-4969-ba7a-3d8ac6ebefff",
  "activityId": "3fc88f43-f7bd-42fc-8678-45601f47401a",
  "author": {
    "userId": "e8b0c791-0ecf-40ab-b2be-3c714a96f23e",
    "username": "demo_bob",
    "name": "Bob Kumar",
    "avatarUrl": null
  },
  "text": "Petrol pump at Tandi closes at 8 pm sharp",
  "createdAt": "2026-10-14T08:58:23.806Z",
  "editedAt": "2026-10-14T08:58:24.613Z",
  "canEdit": true,
  "canDelete": true
}
```

**Event `activity:update_edited` received by Alice**

```json
{
  "groupId": "e03e87cf-d598-4969-ba7a-3d8ac6ebefff",
  "activityId": "3fc88f43-f7bd-42fc-8678-45601f47401a",
  "updateId": "dc4f403e-0862-464d-87a3-84affe6a4c06",
  "update": {
    "id": "dc4f403e-0862-464d-87a3-84affe6a4c06",
    "groupId": "e03e87cf-d598-4969-ba7a-3d8ac6ebefff",
    "activityId": "3fc88f43-f7bd-42fc-8678-45601f47401a",
    "author": {
      "userId": "e8b0c791-0ecf-40ab-b2be-3c714a96f23e",
      "username": "demo_bob",
      "name": "Bob Kumar",
      "avatarUrl": null
    },
    "text": "Petrol pump at Tandi closes at 8 pm sharp",
    "createdAt": "2026-10-14T08:58:23.806Z",
    "editedAt": "2026-10-14T08:58:24.613Z"
  },
  "timestamp": "2026-10-14T08:58:24.613Z"
}
```

### 117. Admin deletes someone's update

`DELETE /groups/:groupId/activity-updates/:updateId` 🔒

**Response 200 OK**

_(empty body)_

**Event `activity:update_deleted` received by Bob**

```json
{
  "groupId": "e03e87cf-d598-4969-ba7a-3d8ac6ebefff",
  "activityId": "3fc88f43-f7bd-42fc-8678-45601f47401a",
  "updateId": "dc4f403e-0862-464d-87a3-84affe6a4c06",
  "deletedBy": "64135665-35b8-4956-861a-e99b87c09958",
  "timestamp": "2026-10-14T08:58:24.789Z"
}
```

### 118. Post to a stop that is not in the itinerary

`POST /groups/:groupId/activities/:activityId/updates` 🔒

**Request**
```json
{
  "text": "hi"
}
```

**Response 404 Not Found**

```json
{
  "message": "Activity not found in the current itinerary",
  "error": "Not Found",
  "statusCode": 404
}
```

### 119. Activities with status and update counts

`GET /groups/:groupId/activities` 🔒

**Response 200 OK**

```json
{
  "itineraryVersion": 2,
  "activities": [
    {
      "activityId": "ba9c2563-ed5b-46b6-b68b-77c3fcb8a229",
      "waypointId": "e2a09900-dbe4-4686-b83f-953562233289",
      "position": 1,
      "role": "START",
      "name": "Manali",
      "date": "2026-10-10",
      "status": "COMPLETED",
      "statusUpdatedAt": "2026-10-14T08:58:23.452Z",
      "statusUpdatedBy": {
        "userId": "64135665-35b8-4956-861a-e99b87c09958",
        "name": "Alice Rider"
      },
      "updateCount": 0
    },
    {
      "activityId": "3fc88f43-f7bd-42fc-8678-45601f47401a",
      "waypointId": "f5f84872-9da9-411b-ba3b-fd3c7eebbd40",
      "position": 2,
      "role": "MID",
      "name": "Keylong",
      "date": "2026-10-11",
      "status": "CURRENT",
      "statusUpdatedAt": "2026-10-14T08:58:23.452Z",
      "statusUpdatedBy": {
        "userId": "64135665-35b8-4956-861a-e99b87c09958",
        "name": "Alice Rider"
      },
      "updateCount": 1
    },
    {
      "activityId": "861efa8d-3438-4998-ae35-ce515b57e715",
      "waypointId": "b309aadf-3670-4112-b29c-64f60dad3520",
      "position": 3,
      "role": "MID",
      "name": "Jispa",
      "date": "2026-10-12",
      "status": "UPCOMING",
      "statusUpdatedAt": null,
      "statusUpdatedBy": null,
      "updateCount": 0
    },
    {
      "activityId": "1730b97a-407d-4102-b57d-9a34b7ff364c",
      "waypointId": "688a61bf-a322-45a6-8b8c-3e4506539531",
      "position": 4,
      "role": "END",
      "name": "Leh",
      "date": "2026-10-13",
      "status": "UPCOMING",
      "statusUpdatedAt": null,
      "statusUpdatedBy": null,
      "updateCount": 0
    }
  ]
}
```

## Trip status

### 120. Current status (nobody has set one)

`GET /groups/:groupId/status` 🔒

**Response 200 OK**

```json
[
  {
    "userId": "64135665-35b8-4956-861a-e99b87c09958",
    "username": "demo_alice",
    "name": "Alice Rider",
    "avatarUrl": "http://localhost:3000/users/64135665-35b8-4956-861a-e99b87c09958/avatar?v=c87a688c-e509-4399-ae6b-fb93cd28a665",
    "role": "ADMIN",
    "status": null
  },
  {
    "userId": "e8b0c791-0ecf-40ab-b2be-3c714a96f23e",
    "username": "demo_bob",
    "name": "Bob Kumar",
    "avatarUrl": null,
    "role": "VIEWER",
    "status": null
  },
  {
    "userId": "378ba245-309f-497b-938a-8cfc74d924a6",
    "username": "demo_carol",
    "name": "Carol Singh",
    "avatarUrl": null,
    "role": "VIEWER",
    "status": null
  }
]
```

### 121. Set my status

`POST /groups/:groupId/status` 🔒

**Request**
```json
{
  "status": "IN_TRANSIT"
}
```

**Response 201 Created**

```json
{
  "id": "2c15020f-fc80-44bd-b87e-2e2bcf7bc083",
  "groupId": "e03e87cf-d598-4969-ba7a-3d8ac6ebefff",
  "userId": "e8b0c791-0ecf-40ab-b2be-3c714a96f23e",
  "username": "demo_bob",
  "name": "Bob Kumar",
  "avatarUrl": null,
  "status": "IN_TRANSIT",
  "note": null,
  "createdAt": "2026-10-14T08:58:25.463Z"
}
```

**Event `status:updated` received by Alice**

```json
{
  "id": "2c15020f-fc80-44bd-b87e-2e2bcf7bc083",
  "groupId": "e03e87cf-d598-4969-ba7a-3d8ac6ebefff",
  "userId": "e8b0c791-0ecf-40ab-b2be-3c714a96f23e",
  "username": "demo_bob",
  "name": "Bob Kumar",
  "avatarUrl": null,
  "status": "IN_TRANSIT",
  "note": null,
  "createdAt": "2026-10-14T08:58:25.463Z"
}
```

### 122. Set my status with a note

`POST /groups/:groupId/status` 🔒

**Request**
```json
{
  "status": "STOPPED",
  "note": "Tea break at Marhi"
}
```

**Response 201 Created**

```json
{
  "id": "161b9591-5759-4bda-a19a-ab658fad69f7",
  "groupId": "e03e87cf-d598-4969-ba7a-3d8ac6ebefff",
  "userId": "64135665-35b8-4956-861a-e99b87c09958",
  "username": "demo_alice",
  "name": "Alice Rider",
  "avatarUrl": "http://localhost:3000/users/64135665-35b8-4956-861a-e99b87c09958/avatar?v=c87a688c-e509-4399-ae6b-fb93cd28a665",
  "status": "STOPPED",
  "note": "Tea break at Marhi",
  "createdAt": "2026-10-14T08:58:25.635Z"
}
```

### 123. Unknown status

`POST /groups/:groupId/status` 🔒

**Request**
```json
{
  "status": "LOST"
}
```

**Response 400 Bad Request**

```json
{
  "message": [
    "status must be one of the following values: ARRIVED, STOPPED, NEED_HELP, IN_TRANSIT"
  ],
  "error": "Bad Request",
  "statusCode": 400
}
```

### 124. Current status per member

`GET /groups/:groupId/status` 🔒

**Response 200 OK**

```json
[
  {
    "userId": "64135665-35b8-4956-861a-e99b87c09958",
    "username": "demo_alice",
    "name": "Alice Rider",
    "avatarUrl": "http://localhost:3000/users/64135665-35b8-4956-861a-e99b87c09958/avatar?v=c87a688c-e509-4399-ae6b-fb93cd28a665",
    "role": "ADMIN",
    "status": {
      "status": "STOPPED",
      "note": "Tea break at Marhi",
      "updatedAt": "2026-10-14T08:58:25.635Z"
    }
  },
  {
    "userId": "e8b0c791-0ecf-40ab-b2be-3c714a96f23e",
    "username": "demo_bob",
    "name": "Bob Kumar",
    "avatarUrl": null,
    "role": "VIEWER",
    "status": {
      "status": "IN_TRANSIT",
      "note": null,
      "updatedAt": "2026-10-14T08:58:25.463Z"
    }
  },
  {
    "userId": "378ba245-309f-497b-938a-8cfc74d924a6",
    "username": "demo_carol",
    "name": "Carol Singh",
    "avatarUrl": null,
    "role": "VIEWER",
    "status": null
  }
]
```

### 125. History (newest first)

`GET /groups/:groupId/status/history` 🔒

**Response 200 OK**

```json
{
  "items": [
    {
      "id": "161b9591-5759-4bda-a19a-ab658fad69f7",
      "groupId": "e03e87cf-d598-4969-ba7a-3d8ac6ebefff",
      "userId": "64135665-35b8-4956-861a-e99b87c09958",
      "username": "demo_alice",
      "name": "Alice Rider",
      "avatarUrl": "http://localhost:3000/users/64135665-35b8-4956-861a-e99b87c09958/avatar?v=c87a688c-e509-4399-ae6b-fb93cd28a665",
      "status": "STOPPED",
      "note": "Tea break at Marhi",
      "createdAt": "2026-10-14T08:58:25.635Z"
    },
    {
      "id": "2c15020f-fc80-44bd-b87e-2e2bcf7bc083",
      "groupId": "e03e87cf-d598-4969-ba7a-3d8ac6ebefff",
      "userId": "e8b0c791-0ecf-40ab-b2be-3c714a96f23e",
      "username": "demo_bob",
      "name": "Bob Kumar",
      "avatarUrl": null,
      "status": "IN_TRANSIT",
      "note": null,
      "createdAt": "2026-10-14T08:58:25.463Z"
    }
  ],
  "nextBefore": null
}
```

### 126. One member's history

`GET /groups/:groupId/status/history?userId=64135665-35b8-4956-861a-e99b87c09958&limit=1` 🔒

**Response 200 OK**

```json
{
  "items": [
    {
      "id": "161b9591-5759-4bda-a19a-ab658fad69f7",
      "groupId": "e03e87cf-d598-4969-ba7a-3d8ac6ebefff",
      "userId": "64135665-35b8-4956-861a-e99b87c09958",
      "username": "demo_alice",
      "name": "Alice Rider",
      "avatarUrl": "http://localhost:3000/users/64135665-35b8-4956-861a-e99b87c09958/avatar?v=c87a688c-e509-4399-ae6b-fb93cd28a665",
      "status": "STOPPED",
      "note": "Tea break at Marhi",
      "createdAt": "2026-10-14T08:58:25.635Z"
    }
  ],
  "nextBefore": null
}
```

## Live location (with the group)

### 127. My sharing state

`GET /groups/:groupId/location/share` 🔒

**Response 200 OK**

```json
{
  "sharing": false,
  "updateIntervalSeconds": 10
}
```

### 128. Send a position while not sharing

`POST /groups/:groupId/location` 🔒

**Request**
```json
{
  "points": [
    {
      "lat": 32.24,
      "lng": 77.18
    }
  ]
}
```

**Response 409 Conflict**

```json
{
  "message": "Location sharing is off. Start sharing first.",
  "error": "Conflict",
  "statusCode": 409
}
```

### 129. Invalid duration

`PUT /groups/:groupId/location/share` 🔒

**Request**
```json
{
  "duration": "TWO_DAYS"
}
```

**Response 400 Bad Request**

```json
{
  "message": [
    "duration must be one of the following values: ONE_HOUR, FOUR_HOURS, EIGHT_HOURS, ALWAYS"
  ],
  "error": "Bad Request",
  "statusCode": 400
}
```

### 130. Start sharing for 1 hour

`PUT /groups/:groupId/location/share` 🔒

**Request**
```json
{
  "duration": "ONE_HOUR"
}
```

**Response 200 OK**

```json
{
  "sharing": true,
  "duration": "ONE_HOUR",
  "startedAt": "2026-10-14T08:58:26.955Z",
  "expiresAt": "2026-10-14T09:58:26.955Z",
  "remainingSeconds": 3600,
  "updateIntervalSeconds": 10
}
```

**Event `location:sharing-started` received by Alice**

```json
{
  "groupId": "e03e87cf-d598-4969-ba7a-3d8ac6ebefff",
  "userId": "e8b0c791-0ecf-40ab-b2be-3c714a96f23e",
  "username": "demo_bob",
  "name": "Bob Kumar",
  "duration": "ONE_HOUR",
  "startedAt": "2026-10-14T08:58:26.955Z",
  "expiresAt": "2026-10-14T09:58:26.955Z"
}
```

### 131. Send a position (this group only)

`POST /groups/:groupId/location` 🔒

**Request**
```json
{
  "points": [
    {
      "lat": 32.2441,
      "lng": 77.1903,
      "accuracy": 6,
      "heading": 30,
      "speed": 11.5
    }
  ]
}
```

**Response 201 Created**

```json
{
  "accepted": 1,
  "latest": {
    "lat": 32.2441,
    "lng": 77.1903,
    "accuracy": 6,
    "heading": 30,
    "speed": 11.5,
    "recordedAt": "2026-10-14T08:58:27.132Z"
  }
}
```

**Event `location:updated` received by Alice**

```json
{
  "groupId": "e03e87cf-d598-4969-ba7a-3d8ac6ebefff",
  "userId": "e8b0c791-0ecf-40ab-b2be-3c714a96f23e",
  "lat": 32.2441,
  "lng": 77.1903,
  "accuracy": 6,
  "heading": 30,
  "speed": 11.5,
  "recordedAt": "2026-10-14T08:58:27.132Z"
}
```

### 132. Send a background batch to every group I share with (POST /location)

`POST /location` 🔒

**Request**
```json
{
  "points": [
    {
      "lat": 32.3101,
      "lng": 77.1702,
      "recordedAt": "2026-10-14T08:58:07.286Z"
    },
    {
      "lat": 32.3155,
      "lng": 77.1698,
      "accuracy": 9,
      "recordedAt": "2026-10-14T08:58:17.286Z"
    }
  ]
}
```

**Response 201 Created**

```json
{
  "groups": [
    {
      "groupId": "e03e87cf-d598-4969-ba7a-3d8ac6ebefff",
      "accepted": 0,
      "latest": null
    }
  ],
  "liveLinks": null
}
```

### 133. Invalid coordinates

`POST /location` 🔒

**Request**
```json
{
  "points": [
    {
      "lat": 100,
      "lng": 77
    }
  ]
}
```

**Response 400 Bad Request**

```json
{
  "message": [
    "points.0.lat must not be greater than 90"
  ],
  "error": "Bad Request",
  "statusCode": 400
}
```

### 134. The groups I share with

`GET /location/sharing` 🔒

**Response 200 OK**

```json
{
  "updateIntervalSeconds": 10,
  "groups": [
    {
      "groupId": "e03e87cf-d598-4969-ba7a-3d8ac6ebefff",
      "groupName": "Ladakh Ride 2026",
      "duration": "ONE_HOUR",
      "startedAt": "2026-10-14T08:58:26.955Z",
      "expiresAt": "2026-10-14T09:58:26.955Z",
      "remainingSeconds": 3599
    }
  ]
}
```

### 135. Group map feed

`GET /groups/:groupId/location` 🔒

**Response 200 OK**

```json
{
  "updateIntervalSeconds": 10,
  "members": [
    {
      "userId": "64135665-35b8-4956-861a-e99b87c09958",
      "username": "demo_alice",
      "name": "Alice Rider",
      "avatarUrl": "http://localhost:3000/users/64135665-35b8-4956-861a-e99b87c09958/avatar?v=c87a688c-e509-4399-ae6b-fb93cd28a665",
      "role": "ADMIN",
      "tripStatus": {
        "status": "STOPPED",
        "note": "Tea break at Marhi",
        "updatedAt": "2026-10-14T08:58:25.635Z"
      },
      "sharing": null,
      "location": null
    },
    {
      "userId": "e8b0c791-0ecf-40ab-b2be-3c714a96f23e",
      "username": "demo_bob",
      "name": "Bob Kumar",
      "avatarUrl": null,
      "role": "VIEWER",
      "tripStatus": {
        "status": "IN_TRANSIT",
        "note": null,
        "updatedAt": "2026-10-14T08:58:25.463Z"
      },
      "sharing": {
        "duration": "ONE_HOUR",
        "startedAt": "2026-10-14T08:58:26.955Z",
        "expiresAt": "2026-10-14T09:58:26.955Z",
        "remainingSeconds": 3599
      },
      "location": {
        "lat": 32.2441,
        "lng": 77.1903,
        "accuracy": 6,
        "heading": 30,
        "speed": 11.5,
        "recordedAt": "2026-10-14T08:58:27.132Z"
      }
    },
    {
      "userId": "378ba245-309f-497b-938a-8cfc74d924a6",
      "username": "demo_carol",
      "name": "Carol Singh",
      "avatarUrl": null,
      "role": "VIEWER",
      "tripStatus": null,
      "sharing": null,
      "location": null
    }
  ]
}
```

### 136. Switch to ALWAYS (no timer)

`PUT /groups/:groupId/location/share` 🔒

**Request**
```json
{
  "duration": "ALWAYS"
}
```

**Response 200 OK**

```json
{
  "sharing": true,
  "duration": "ALWAYS",
  "startedAt": "2026-10-14T08:58:27.932Z",
  "expiresAt": null,
  "remainingSeconds": null,
  "updateIntervalSeconds": 10
}
```

### 137. Stop sharing

`DELETE /groups/:groupId/location/share` 🔒

**Response 200 OK**

```json
{
  "sharing": false,
  "updateIntervalSeconds": 10
}
```

**Event `location:sharing-stopped` received by Alice**

```json
{
  "groupId": "e03e87cf-d598-4969-ba7a-3d8ac6ebefff",
  "userId": "e8b0c791-0ecf-40ab-b2be-3c714a96f23e",
  "reason": "STOPPED"
}
```

## Live location for loved ones (people outside the app)

### 138. Share my live location with someone (link shown once)

`POST /location-share/sessions` 🔒

**Request**
```json
{
  "duration": "ONE_HOUR",
  "recipientLabel": "Mom"
}
```

**Response 201 Created**

```json
{
  "id": "57ade98b-1164-40cf-92bf-46780c00ae83",
  "recipientLabel": "Mom",
  "duration": "ONE_HOUR",
  "startedAt": "2026-10-14T08:58:28.258Z",
  "expiresAt": "2026-10-14T09:58:28.250Z",
  "remainingSeconds": 3600,
  "firstViewedAt": null,
  "lastViewedAt": null,
  "token": "Mah0ItVjMLB0pW8qrwNNGC-7uw-yhbjGAAskO9Y46_w",
  "link": "https://travelgo.app/live/Mah0ItVjMLB0pW8qrwNNGC-7uw-yhbjGAAskO9Y46_w"
}
```

**Event `location_share:started` received by Alice's own devices**

```json
{
  "id": "57ade98b-1164-40cf-92bf-46780c00ae83",
  "recipientLabel": "Mom",
  "duration": "ONE_HOUR",
  "startedAt": "2026-10-14T08:58:28.258Z",
  "expiresAt": "2026-10-14T09:58:28.250Z",
  "remainingSeconds": 3600,
  "firstViewedAt": null,
  "lastViewedAt": null
}
```

### 139. Invalid duration

`POST /location-share/sessions` 🔒

**Request**
```json
{
  "duration": "FOREVER"
}
```

**Response 400 Bad Request**

```json
{
  "message": [
    "duration must be one of the following values: FIFTEEN_MINUTES, ONE_HOUR, EIGHT_HOURS"
  ],
  "error": "Bad Request",
  "statusCode": 400
}
```

### 140. My active links

`GET /location-share/sessions` 🔒

**Response 200 OK**

```json
[
  {
    "id": "57ade98b-1164-40cf-92bf-46780c00ae83",
    "recipientLabel": "Mom",
    "duration": "ONE_HOUR",
    "startedAt": "2026-10-14T08:58:28.258Z",
    "expiresAt": "2026-10-14T09:58:28.250Z",
    "remainingSeconds": 3600,
    "firstViewedAt": null,
    "lastViewedAt": null
  }
]
```

### 141. Recipient opens the link (no login): no position yet

`GET /public/live/:token`

**Response 200 OK**

```json
{
  "sessionId": "57ade98b-1164-40cf-92bf-46780c00ae83",
  "sharer": {
    "name": "Alice Rider",
    "avatarUrl": "http://localhost:3000/users/64135665-35b8-4956-861a-e99b87c09958/avatar?v=c87a688c-e509-4399-ae6b-fb93cd28a665"
  },
  "recipientLabel": "Mom",
  "startedAt": "2026-10-14T08:58:28.258Z",
  "expiresAt": "2026-10-14T09:58:28.250Z",
  "remainingSeconds": 3600,
  "updateIntervalSeconds": 10,
  "location": null
}
```

**Push sent to Alice**

```json
{
  "title": "Your live location was opened",
  "body": "Mom opened your live location link.",
  "data": {
    "type": "LIVE_SHARE_VIEWED",
    "sessionId": "57ade98b-1164-40cf-92bf-46780c00ae83"
  }
}
```

### 142. Recipient page connects to the `/live` socket (no login)

`io(baseUrl + '/live', { auth: { token } })` → `on ready` 🔌

```json
{
  "sessionId": "57ade98b-1164-40cf-92bf-46780c00ae83"
}
```

### 143. Alice keeps sending positions (POST /location reaches her links)

`POST /location` 🔒

**Request**
```json
{
  "points": [
    {
      "lat": 32.2432,
      "lng": 77.1892,
      "accuracy": 5
    }
  ]
}
```

**Response 201 Created**

```json
{
  "groups": [],
  "liveLinks": {
    "active": 1,
    "latest": {
      "lat": 32.2432,
      "lng": 77.1892,
      "accuracy": 5,
      "heading": null,
      "speed": null,
      "recordedAt": "2026-10-14T08:58:28.907Z"
    }
  }
}
```

**Event `location:update` received by the recipient's page**

```json
{
  "sessionId": "57ade98b-1164-40cf-92bf-46780c00ae83",
  "lat": 32.2432,
  "lng": 77.1892,
  "accuracy": 5,
  "heading": null,
  "speed": null,
  "recordedAt": "2026-10-14T08:58:28.907Z"
}
```

### 144. Recipient polls the link

`GET /public/live/:token`

**Response 200 OK**

```json
{
  "sessionId": "57ade98b-1164-40cf-92bf-46780c00ae83",
  "sharer": {
    "name": "Alice Rider",
    "avatarUrl": "http://localhost:3000/users/64135665-35b8-4956-861a-e99b87c09958/avatar?v=c87a688c-e509-4399-ae6b-fb93cd28a665"
  },
  "recipientLabel": "Mom",
  "startedAt": "2026-10-14T08:58:28.258Z",
  "expiresAt": "2026-10-14T09:58:28.250Z",
  "remainingSeconds": 3599,
  "updateIntervalSeconds": 10,
  "location": {
    "lat": 32.2432,
    "lng": 77.1892,
    "accuracy": 5,
    "heading": null,
    "speed": null,
    "recordedAt": "2026-10-14T08:58:28.907Z"
  }
}
```

### 145. Unknown link

`GET /public/live/:token`

**Response 404 Not Found**

```json
{
  "message": "This live location link is not valid",
  "error": "Not Found",
  "statusCode": 404
}
```

### 146. Stop sharing with Mom

`DELETE /location-share/sessions/:sessionId` 🔒

**Response 200 OK**

_(empty body)_

**Event `location_share:stopped` received by the recipient's page (then disconnected)**

```json
{
  "sessionId": "57ade98b-1164-40cf-92bf-46780c00ae83",
  "reason": "STOPPED",
  "endedAt": "2026-10-14T08:58:29.391Z"
}
```

### 147. Recipient after it ended

`GET /public/live/:token`

**Response 410 Gone**

```json
{
  "message": "This live location has ended",
  "error": "Gone",
  "statusCode": 410
}
```

### 148. Recipient socket after it ended

`on connect_error` 🔌

```json
{
  "message": "Gone"
}
```

### 149. Send a position while sharing with nobody

`POST /location` 🔒

**Request**
```json
{
  "points": [
    {
      "lat": 1,
      "lng": 1
    }
  ]
}
```

**Response 409 Conflict**

```json
{
  "message": "Location sharing is off. Start sharing first.",
  "error": "Conflict",
  "statusCode": 409
}
```

## Nearby places (homepage)

_Real OpenStreetMap data around Manali. The public data server is rate-limited, so a `503` here would mean it was busy._

### 150. Fuel stations

`GET /location/fuel-stations?lat=32.2432&lng=77.1892&radius=3000&limit=3` 🔒

**Response 200 OK**

```json
{
  "category": "FUEL",
  "center": {
    "lat": 32.2432,
    "lng": 77.1892
  },
  "radiusMeters": 3000,
  "source": "openstreetmap",
  "attribution": "© OpenStreetMap contributors",
  "places": [
    {
      "id": "osm:node/856402274",
      "name": null,
      "kind": "fuel",
      "lat": 32.2395569,
      "lng": 77.1882886,
      "address": null,
      "openingHours": null,
      "phone": null,
      "website": null,
      "brand": null,
      "distanceMeters": 414,
      "category": "FUEL"
    },
    {
      "id": "osm:node/795826239",
      "name": "Indian oil",
      "kind": "fuel",
      "lat": 32.2583689,
      "lng": 77.1880018,
      "address": null,
      "openingHours": null,
      "phone": null,
      "website": null,
      "brand": "Indian Oil",
      "distanceMeters": 1690,
      "category": "FUEL"
    },
    {
      "id": "osm:node/884337175",
      "name": "H.P.",
      "kind": "fuel",
      "lat": 32.2223059,
      "lng": 77.1908253,
      "address": null,
      "openingHours": null,
      "phone": null,
      "website": null,
      "brand": null,
      "distanceMeters": 2328,
      "category": "FUEL"
    }
  ]
}
```

### 151. Restaurants

`GET /location/restaurants?lat=32.2432&lng=77.1892&radius=3000&limit=3` 🔒

**Response 200 OK**

```json
{
  "category": "RESTAURANT",
  "center": {
    "lat": 32.2432,
    "lng": 77.1892
  },
  "radiusMeters": 3000,
  "source": "openstreetmap",
  "attribution": "© OpenStreetMap contributors",
  "places": [
    {
      "id": "osm:node/6067870385",
      "name": "Himalayan Dhaba",
      "kind": "restaurant",
      "lat": 32.2437191,
      "lng": 77.1892149,
      "address": null,
      "openingHours": null,
      "phone": null,
      "website": null,
      "brand": null,
      "distanceMeters": 58,
      "category": "RESTAURANT"
    },
    {
      "id": "osm:node/5511322838",
      "name": "Chopsticks",
      "kind": "restaurant",
      "lat": 32.24376,
      "lng": 77.1892318,
      "address": null,
      "openingHours": null,
      "phone": null,
      "website": null,
      "brand": null,
      "distanceMeters": 62,
      "category": "RESTAURANT"
    },
    {
      "id": "osm:node/9959557217",
      "name": "Noodles",
      "kind": "restaurant",
      "lat": 32.2438202,
      "lng": 77.1892389,
      "address": null,
      "openingHours": null,
      "phone": null,
      "website": null,
      "brand": null,
      "distanceMeters": 69,
      "category": "RESTAURANT"
    }
  ]
}
```

### 152. Garages

`GET /location/garages?lat=32.2432&lng=77.1892&radius=3000&limit=3` 🔒

**Response 200 OK**

```json
{
  "category": "GARAGE",
  "center": {
    "lat": 32.2432,
    "lng": 77.1892
  },
  "radiusMeters": 3000,
  "source": "openstreetmap",
  "attribution": "© OpenStreetMap contributors",
  "places": [
    {
      "id": "osm:node/4135408490",
      "name": null,
      "kind": "car_repair",
      "lat": 32.2483509,
      "lng": 77.190927,
      "address": null,
      "openingHours": null,
      "phone": null,
      "website": null,
      "brand": null,
      "distanceMeters": 595,
      "category": "GARAGE"
    },
    {
      "id": "osm:node/4347360590",
      "name": "Hari Bike Repair & Hire",
      "kind": "car_repair",
      "lat": 32.2493659,
      "lng": 77.185693,
      "address": "Circuit House Road",
      "openingHours": null,
      "phone": null,
      "website": null,
      "brand": null,
      "distanceMeters": 761,
      "category": "GARAGE"
    }
  ]
}
```

### 153. Missing coordinates

`GET /location/garages?radius=3000` 🔒

**Response 400 Bad Request**

```json
{
  "message": [
    "lat must not be greater than 90",
    "lat must not be less than -90",
    "lat must be a number conforming to the specified constraints",
    "lng must not be greater than 180",
    "lng must not be less than -180",
    "lng must be a number conforming to the specified constraints"
  ],
  "error": "Bad Request",
  "statusCode": 400
}
```

## Presence

### 154. Who's online

`GET /groups/:groupId/presence` 🔒

**Response 200 OK**

```json
[
  {
    "userId": "64135665-35b8-4956-861a-e99b87c09958",
    "username": "demo_alice",
    "name": "Alice Rider",
    "avatarUrl": "http://localhost:3000/users/64135665-35b8-4956-861a-e99b87c09958/avatar?v=c87a688c-e509-4399-ae6b-fb93cd28a665",
    "online": true,
    "lastSeenAt": null
  },
  {
    "userId": "e8b0c791-0ecf-40ab-b2be-3c714a96f23e",
    "username": "demo_bob",
    "name": "Bob Kumar",
    "avatarUrl": null,
    "online": true,
    "lastSeenAt": null
  },
  {
    "userId": "378ba245-309f-497b-938a-8cfc74d924a6",
    "username": "demo_carol",
    "name": "Carol Singh",
    "avatarUrl": null,
    "online": true,
    "lastSeenAt": null
  }
]
```

## Chat (socket + HTTP)

### 155. Chat history before any message

`GET /groups/:groupId/messages` 🔒

**Response 200 OK**

```json
{
  "items": [],
  "nextBefore": null
}
```

### 156. Send a message

`emit chat:send` 🔌 (sent by Alice)

**Payload**
```json
{
  "groupId": "e03e87cf-d598-4969-ba7a-3d8ac6ebefff",
  "body": "Morning all! Leaving Manali at 6 sharp 🏍️",
  "clientMsgId": "7129e827-262e-4e73-a3ef-8a445745cd53"
}
```

**Ack (reply)**

```json
{
  "ok": true,
  "data": {
    "id": "70b198f5-0112-49f6-bcdf-6e80cbce9c99",
    "groupId": "e03e87cf-d598-4969-ba7a-3d8ac6ebefff",
    "type": "NORMAL",
    "kind": "TEXT",
    "category": null,
    "body": "Morning all! Leaving Manali at 6 sharp 🏍️",
    "clientMsgId": "7129e827-262e-4e73-a3ef-8a445745cd53",
    "sender": {
      "userId": "64135665-35b8-4956-861a-e99b87c09958",
      "username": "demo_alice",
      "name": "Alice Rider",
      "avatarUrl": "http://localhost:3000/users/64135665-35b8-4956-861a-e99b87c09958/avatar?v=c87a688c-e509-4399-ae6b-fb93cd28a665"
    },
    "location": null,
    "voice": null,
    "createdAt": "2026-10-14T09:01:06.700Z",
    "readByCount": 0
  }
}
```

**Event `chat:message` received by Bob**

```json
{
  "id": "70b198f5-0112-49f6-bcdf-6e80cbce9c99",
  "groupId": "e03e87cf-d598-4969-ba7a-3d8ac6ebefff",
  "type": "NORMAL",
  "kind": "TEXT",
  "category": null,
  "body": "Morning all! Leaving Manali at 6 sharp 🏍️",
  "clientMsgId": "7129e827-262e-4e73-a3ef-8a445745cd53",
  "sender": {
    "userId": "64135665-35b8-4956-861a-e99b87c09958",
    "username": "demo_alice",
    "name": "Alice Rider",
    "avatarUrl": "http://localhost:3000/users/64135665-35b8-4956-861a-e99b87c09958/avatar?v=c87a688c-e509-4399-ae6b-fb93cd28a665"
  },
  "location": null,
  "voice": null,
  "createdAt": "2026-10-14T09:01:06.700Z",
  "readByCount": 0
}
```

### 157. Resend with the same clientMsgId (no duplicate, no broadcast)

`emit chat:send` 🔌 (sent by Alice)

**Payload**
```json
{
  "groupId": "e03e87cf-d598-4969-ba7a-3d8ac6ebefff",
  "body": "Morning all! Leaving Manali at 6 sharp 🏍️",
  "clientMsgId": "7129e827-262e-4e73-a3ef-8a445745cd53"
}
```

**Ack (reply)**

```json
{
  "ok": true,
  "data": {
    "id": "70b198f5-0112-49f6-bcdf-6e80cbce9c99",
    "groupId": "e03e87cf-d598-4969-ba7a-3d8ac6ebefff",
    "type": "NORMAL",
    "kind": "TEXT",
    "category": null,
    "body": "Morning all! Leaving Manali at 6 sharp 🏍️",
    "clientMsgId": "7129e827-262e-4e73-a3ef-8a445745cd53",
    "sender": {
      "userId": "64135665-35b8-4956-861a-e99b87c09958",
      "username": "demo_alice",
      "name": "Alice Rider",
      "avatarUrl": "http://localhost:3000/users/64135665-35b8-4956-861a-e99b87c09958/avatar?v=c87a688c-e509-4399-ae6b-fb93cd28a665"
    },
    "location": null,
    "voice": null,
    "createdAt": "2026-10-14T09:01:06.700Z",
    "readByCount": 0
  }
}
```

### 158. Send an empty message

`emit chat:send` 🔌 (sent by Alice)

**Payload**
```json
{
  "groupId": "e03e87cf-d598-4969-ba7a-3d8ac6ebefff",
  "body": "   "
}
```

**Ack (reply)**

```json
{
  "ok": false,
  "error": {
    "status": 400,
    "message": "body is required"
  }
}
```

### 159. Send to a group you are not in

`emit chat:send` 🔌 (sent by Dave)

**Payload**
```json
{
  "groupId": "e03e87cf-d598-4969-ba7a-3d8ac6ebefff",
  "body": "hello?"
}
```

**Ack (reply)**

```json
{
  "ok": false,
  "error": {
    "status": 404,
    "message": "Group not found"
  }
}
```

### 160. Typing indicator

`emit chat:typing` 🔌 (sent by Alice)

**Payload**
```json
{
  "groupId": "e03e87cf-d598-4969-ba7a-3d8ac6ebefff",
  "isTyping": true
}
```

**Ack (reply)**

```json
{
  "ok": true,
  "data": {
    "groupId": "e03e87cf-d598-4969-ba7a-3d8ac6ebefff",
    "isTyping": true
  }
}
```

**Event `chat:typing` received by Bob**

```json
{
  "groupId": "e03e87cf-d598-4969-ba7a-3d8ac6ebefff",
  "userId": "64135665-35b8-4956-861a-e99b87c09958",
  "username": "demo_alice",
  "name": "Alice Rider",
  "avatarUrl": "http://localhost:3000/users/64135665-35b8-4956-861a-e99b87c09958/avatar?v=c87a688c-e509-4399-ae6b-fb93cd28a665",
  "isTyping": true
}
```

### 161. Unread count before reading

`GET /groups/:groupId/messages/unread` 🔒

**Response 200 OK**

```json
{
  "unreadCount": 1,
  "lastReadMessageId": null,
  "lastReadAt": null
}
```

### 162. Reply

`emit chat:send` 🔌 (sent by Bob)

**Payload**
```json
{
  "groupId": "e03e87cf-d598-4969-ba7a-3d8ac6ebefff",
  "body": "On my way 👍",
  "clientMsgId": "02093e6b-36d7-4b7e-9cb6-03826f549abf"
}
```

**Ack (reply)**

```json
{
  "ok": true,
  "data": {
    "id": "cba0b525-b7e5-442d-b18d-698b6a40207b",
    "groupId": "e03e87cf-d598-4969-ba7a-3d8ac6ebefff",
    "type": "NORMAL",
    "kind": "TEXT",
    "category": null,
    "body": "On my way 👍",
    "clientMsgId": "02093e6b-36d7-4b7e-9cb6-03826f549abf",
    "sender": {
      "userId": "e8b0c791-0ecf-40ab-b2be-3c714a96f23e",
      "username": "demo_bob",
      "name": "Bob Kumar",
      "avatarUrl": null
    },
    "location": null,
    "voice": null,
    "createdAt": "2026-10-14T09:01:07.770Z",
    "readByCount": 0
  }
}
```

### 163. Mark read over the socket

`emit chat:read` 🔌 (sent by Carol)

**Payload**
```json
{
  "groupId": "e03e87cf-d598-4969-ba7a-3d8ac6ebefff",
  "messageId": "70b198f5-0112-49f6-bcdf-6e80cbce9c99"
}
```

**Ack (reply)**

```json
{
  "ok": true,
  "data": {
    "unreadCount": 1,
    "lastReadMessageId": "70b198f5-0112-49f6-bcdf-6e80cbce9c99",
    "lastReadAt": "2026-10-14T09:01:06.700Z"
  }
}
```

**Event `chat:read` received by Alice**

```json
{
  "groupId": "e03e87cf-d598-4969-ba7a-3d8ac6ebefff",
  "userId": "378ba245-309f-497b-938a-8cfc74d924a6",
  "lastReadMessageId": "70b198f5-0112-49f6-bcdf-6e80cbce9c99",
  "lastReadAt": "2026-10-14T09:01:06.700Z"
}
```

### 164. Share a location

`emit chat:send` 🔌 (sent by Alice)

**Payload**
```json
{
  "groupId": "e03e87cf-d598-4969-ba7a-3d8ac6ebefff",
  "kind": "LOCATION",
  "location": {
    "lat": 32.5715,
    "lng": 77.0326,
    "accuracy": 10,
    "label": "Keylong petrol pump"
  },
  "body": "Meet here"
}
```

**Ack (reply)**

```json
{
  "ok": true,
  "data": {
    "id": "d45e2ebb-8447-474a-9492-b742ab0c2291",
    "groupId": "e03e87cf-d598-4969-ba7a-3d8ac6ebefff",
    "type": "NORMAL",
    "kind": "LOCATION",
    "category": null,
    "body": "Meet here",
    "clientMsgId": null,
    "sender": {
      "userId": "64135665-35b8-4956-861a-e99b87c09958",
      "username": "demo_alice",
      "name": "Alice Rider",
      "avatarUrl": "http://localhost:3000/users/64135665-35b8-4956-861a-e99b87c09958/avatar?v=c87a688c-e509-4399-ae6b-fb93cd28a665"
    },
    "location": {
      "lat": 32.5715,
      "lng": 77.0326,
      "label": "Keylong petrol pump",
      "source": "DEVICE",
      "accuracy": 10,
      "recordedAt": "2026-10-14T09:01:08.106Z"
    },
    "voice": null,
    "createdAt": "2026-10-14T09:01:08.107Z",
    "readByCount": 0
  }
}
```

**Event `chat:message` received by Bob**

```json
{
  "id": "d45e2ebb-8447-474a-9492-b742ab0c2291",
  "groupId": "e03e87cf-d598-4969-ba7a-3d8ac6ebefff",
  "type": "NORMAL",
  "kind": "LOCATION",
  "category": null,
  "body": "Meet here",
  "clientMsgId": null,
  "sender": {
    "userId": "64135665-35b8-4956-861a-e99b87c09958",
    "username": "demo_alice",
    "name": "Alice Rider",
    "avatarUrl": "http://localhost:3000/users/64135665-35b8-4956-861a-e99b87c09958/avatar?v=c87a688c-e509-4399-ae6b-fb93cd28a665"
  },
  "location": {
    "lat": 32.5715,
    "lng": 77.0326,
    "label": "Keylong petrol pump",
    "source": "DEVICE",
    "accuracy": 10,
    "recordedAt": "2026-10-14T09:01:08.106Z"
  },
  "voice": null,
  "createdAt": "2026-10-14T09:01:08.107Z",
  "readByCount": 0
}
```

### 165. Location message without a location

`emit chat:send` 🔌 (sent by Alice)

**Payload**
```json
{
  "groupId": "e03e87cf-d598-4969-ba7a-3d8ac6ebefff",
  "kind": "LOCATION"
}
```

**Ack (reply)**

```json
{
  "ok": false,
  "error": {
    "status": 400,
    "message": "location is required for a LOCATION message"
  }
}
```

### 166. Send a voice message (HTTP upload)

`POST /groups/:groupId/messages/voice` 🔒

**Request** (multipart/form-data)

- `durationMs`: `14500`
- `clientMsgId`: `8cf14510-e383-47d6-a526-02142d34fc9e`
- `file`: voice-note.m4a (audio/mp4, 464 bytes)

**Response 201 Created**

```json
{
  "id": "7a83adfe-0428-4c96-aca3-d33dfaeb0e61",
  "groupId": "e03e87cf-d598-4969-ba7a-3d8ac6ebefff",
  "type": "NORMAL",
  "kind": "VOICE",
  "category": null,
  "body": "",
  "clientMsgId": "8cf14510-e383-47d6-a526-02142d34fc9e",
  "sender": {
    "userId": "e8b0c791-0ecf-40ab-b2be-3c714a96f23e",
    "username": "demo_bob",
    "name": "Bob Kumar",
    "avatarUrl": null
  },
  "location": null,
  "voice": {
    "durationMs": 14500,
    "contentType": "audio/mp4"
  },
  "createdAt": "2026-10-14T09:01:08.458Z",
  "readByCount": 0
}
```

**Event `chat:message` received by Alice**

```json
{
  "id": "7a83adfe-0428-4c96-aca3-d33dfaeb0e61",
  "groupId": "e03e87cf-d598-4969-ba7a-3d8ac6ebefff",
  "type": "NORMAL",
  "kind": "VOICE",
  "category": null,
  "body": "",
  "clientMsgId": "8cf14510-e383-47d6-a526-02142d34fc9e",
  "sender": {
    "userId": "e8b0c791-0ecf-40ab-b2be-3c714a96f23e",
    "username": "demo_bob",
    "name": "Bob Kumar",
    "avatarUrl": null
  },
  "location": null,
  "voice": {
    "durationMs": 14500,
    "contentType": "audio/mp4"
  },
  "createdAt": "2026-10-14T09:01:08.458Z",
  "readByCount": 0
}
```

### 167. Play a voice message

`GET /groups/:groupId/messages/:messageId/voice` 🔒

**Response 200 OK**

`(binary, 464 bytes) Content-Type: audio/mp4; Content-Disposition: inline; filename="voice-7a83adfe.m4a"`

### 168. Upload something that is not audio (a PNG)

`POST /groups/:groupId/messages/voice` 🔒

**Request** (multipart/form-data)

- `durationMs`: `1000`
- `file`: photo.png (image/png, 72 bytes)

**Response 415 Unsupported Media Type**

```json
{
  "message": "A voice message must be an AAC/M4A or Ogg audio recording",
  "error": "Unsupported Media Type",
  "statusCode": 415
}
```

### 169. Voice message longer than 2 minutes

`POST /groups/:groupId/messages/voice` 🔒

**Request** (multipart/form-data)

- `durationMs`: `130000`
- `file`: long.m4a (audio/mp4, 464 bytes)

**Response 400 Bad Request**

```json
{
  "message": [
    "A voice message can be at most 2 minutes long"
  ],
  "error": "Bad Request",
  "statusCode": 400
}
```

### 170. Chat history (newest page, oldest first)

`GET /groups/:groupId/messages` 🔒

**Response 200 OK**

```json
{
  "items": [
    {
      "id": "70b198f5-0112-49f6-bcdf-6e80cbce9c99",
      "groupId": "e03e87cf-d598-4969-ba7a-3d8ac6ebefff",
      "type": "NORMAL",
      "kind": "TEXT",
      "category": null,
      "body": "Morning all! Leaving Manali at 6 sharp 🏍️",
      "clientMsgId": "7129e827-262e-4e73-a3ef-8a445745cd53",
      "sender": {
        "userId": "64135665-35b8-4956-861a-e99b87c09958",
        "username": "demo_alice",
        "name": "Alice Rider",
        "avatarUrl": "http://localhost:3000/users/64135665-35b8-4956-861a-e99b87c09958/avatar?v=c87a688c-e509-4399-ae6b-fb93cd28a665"
      },
      "location": null,
      "voice": null,
      "createdAt": "2026-10-14T09:01:06.700Z",
      "readByCount": 2
    },
    {
      "id": "cba0b525-b7e5-442d-b18d-698b6a40207b",
      "groupId": "e03e87cf-d598-4969-ba7a-3d8ac6ebefff",
      "type": "NORMAL",
      "kind": "TEXT",
      "category": null,
      "body": "On my way 👍",
      "clientMsgId": "02093e6b-36d7-4b7e-9cb6-03826f549abf",
      "sender": {
        "userId": "e8b0c791-0ecf-40ab-b2be-3c714a96f23e",
        "username": "demo_bob",
        "name": "Bob Kumar",
        "avatarUrl": null
      },
      "location": null,
      "voice": null,
      "createdAt": "2026-10-14T09:01:07.770Z",
      "readByCount": 1
    },
    {
      "id": "d45e2ebb-8447-474a-9492-b742ab0c2291",
      "groupId": "e03e87cf-d598-4969-ba7a-3d8ac6ebefff",
      "type": "NORMAL",
      "kind": "LOCATION",
      "category": null,
      "body": "Meet here",
      "clientMsgId": null,
      "sender": {
        "userId": "64135665-35b8-4956-861a-e99b87c09958",
        "username": "demo_alice",
        "name": "Alice Rider",
        "avatarUrl": "http://localhost:3000/users/64135665-35b8-4956-861a-e99b87c09958/avatar?v=c87a688c-e509-4399-ae6b-fb93cd28a665"
      },
      "location": {
        "lat": 32.5715,
        "lng": 77.0326,
        "label": "Keylong petrol pump",
        "source": "DEVICE",
        "accuracy": 10,
        "recordedAt": "2026-10-14T09:01:08.106Z"
      },
      "voice": null,
      "createdAt": "2026-10-14T09:01:08.107Z",
      "readByCount": 1
    },
    {
      "id": "7a83adfe-0428-4c96-aca3-d33dfaeb0e61",
      "groupId": "e03e87cf-d598-4969-ba7a-3d8ac6ebefff",
      "type": "NORMAL",
      "kind": "VOICE",
      "category": null,
      "body": "",
      "clientMsgId": "8cf14510-e383-47d6-a526-02142d34fc9e",
      "sender": {
        "userId": "e8b0c791-0ecf-40ab-b2be-3c714a96f23e",
        "username": "demo_bob",
        "name": "Bob Kumar",
        "avatarUrl": null
      },
      "location": null,
      "voice": {
        "durationMs": 14500,
        "contentType": "audio/mp4"
      },
      "createdAt": "2026-10-14T09:01:08.458Z",
      "readByCount": 0
    }
  ],
  "nextBefore": null
}
```

### 171. History, paged (1 per page)

`GET /groups/:groupId/messages?limit=1` 🔒

**Response 200 OK**

```json
{
  "items": [
    {
      "id": "7a83adfe-0428-4c96-aca3-d33dfaeb0e61",
      "groupId": "e03e87cf-d598-4969-ba7a-3d8ac6ebefff",
      "type": "NORMAL",
      "kind": "VOICE",
      "category": null,
      "body": "",
      "clientMsgId": "8cf14510-e383-47d6-a526-02142d34fc9e",
      "sender": {
        "userId": "e8b0c791-0ecf-40ab-b2be-3c714a96f23e",
        "username": "demo_bob",
        "name": "Bob Kumar",
        "avatarUrl": null
      },
      "location": null,
      "voice": {
        "durationMs": 14500,
        "contentType": "audio/mp4"
      },
      "createdAt": "2026-10-14T09:01:08.458Z",
      "readByCount": 0
    }
  ],
  "nextBefore": "7a83adfe-0428-4c96-aca3-d33dfaeb0e61"
}
```

### 172. Search the chat

`GET /groups/:groupId/messages?search=manali` 🔒

**Response 200 OK**

```json
{
  "items": [
    {
      "id": "70b198f5-0112-49f6-bcdf-6e80cbce9c99",
      "groupId": "e03e87cf-d598-4969-ba7a-3d8ac6ebefff",
      "type": "NORMAL",
      "kind": "TEXT",
      "category": null,
      "body": "Morning all! Leaving Manali at 6 sharp 🏍️",
      "clientMsgId": "7129e827-262e-4e73-a3ef-8a445745cd53",
      "sender": {
        "userId": "64135665-35b8-4956-861a-e99b87c09958",
        "username": "demo_alice",
        "name": "Alice Rider",
        "avatarUrl": "http://localhost:3000/users/64135665-35b8-4956-861a-e99b87c09958/avatar?v=c87a688c-e509-4399-ae6b-fb93cd28a665"
      },
      "location": null,
      "voice": null,
      "createdAt": "2026-10-14T09:01:06.700Z",
      "readByCount": 2
    }
  ],
  "nextBefore": null
}
```

### 173. Search text too short

`GET /groups/:groupId/messages?search=m` 🔒

**Response 400 Bad Request**

```json
{
  "message": [
    "search must be longer than or equal to 2 characters"
  ],
  "error": "Bad Request",
  "statusCode": 400
}
```

### 174. Read receipts for a message

`GET /groups/:groupId/messages/:messageId/reads` 🔒

**Response 200 OK**

```json
{
  "messageId": "70b198f5-0112-49f6-bcdf-6e80cbce9c99",
  "readBy": [
    {
      "userId": "e8b0c791-0ecf-40ab-b2be-3c714a96f23e",
      "username": "demo_bob",
      "name": "Bob Kumar",
      "avatarUrl": null
    },
    {
      "userId": "378ba245-309f-497b-938a-8cfc74d924a6",
      "username": "demo_carol",
      "name": "Carol Singh",
      "avatarUrl": null
    }
  ],
  "notReadYet": []
}
```

## Alerts & SOS

### 175. Send a CRITICAL alert (admin)

`POST /groups/:groupId/alerts` 🔒

**Request**
```json
{
  "type": "CRITICAL",
  "category": "ROAD_CLOSURE",
  "body": "Rohtang Pass closed after a landslide. Take the Atal Tunnel."
}
```

**Response 201 Created**

```json
{
  "id": "70842cb1-0e24-42f7-a050-17260712a5f7",
  "groupId": "e03e87cf-d598-4969-ba7a-3d8ac6ebefff",
  "type": "CRITICAL",
  "kind": "TEXT",
  "category": "ROAD_CLOSURE",
  "body": "Rohtang Pass closed after a landslide. Take the Atal Tunnel.",
  "clientMsgId": null,
  "sender": {
    "userId": "64135665-35b8-4956-861a-e99b87c09958",
    "username": "demo_alice",
    "name": "Alice Rider",
    "avatarUrl": "http://localhost:3000/users/64135665-35b8-4956-861a-e99b87c09958/avatar?v=c87a688c-e509-4399-ae6b-fb93cd28a665"
  },
  "location": null,
  "voice": null,
  "createdAt": "2026-10-14T09:01:09.917Z",
  "readByCount": 0,
  "alert": {
    "requiresAck": true,
    "active": true,
    "ackCount": 0,
    "pendingCount": 2,
    "acknowledgedByMe": false,
    "resolvedAt": null,
    "resolvedBy": null
  }
}
```

**Push sent to Bob**

```json
{
  "title": "Critical alert: Ladakh Ride 2026",
  "body": "Rohtang Pass closed after a landslide. Take the Atal Tunnel.",
  "data": {
    "type": "CRITICAL_ALERT",
    "groupId": "e03e87cf-d598-4969-ba7a-3d8ac6ebefff",
    "alertId": "70842cb1-0e24-42f7-a050-17260712a5f7",
    "category": "ROAD_CLOSURE"
  }
}
```

**Push sent to Carol**

```json
{
  "title": "Critical alert: Ladakh Ride 2026",
  "body": "Rohtang Pass closed after a landslide. Take the Atal Tunnel.",
  "data": {
    "type": "CRITICAL_ALERT",
    "groupId": "e03e87cf-d598-4969-ba7a-3d8ac6ebefff",
    "alertId": "70842cb1-0e24-42f7-a050-17260712a5f7",
    "category": "ROAD_CLOSURE"
  }
}
```

**Event `alert:raised` received by Bob**

```json
{
  "id": "70842cb1-0e24-42f7-a050-17260712a5f7",
  "groupId": "e03e87cf-d598-4969-ba7a-3d8ac6ebefff",
  "type": "CRITICAL",
  "kind": "TEXT",
  "category": "ROAD_CLOSURE",
  "body": "Rohtang Pass closed after a landslide. Take the Atal Tunnel.",
  "clientMsgId": null,
  "sender": {
    "userId": "64135665-35b8-4956-861a-e99b87c09958",
    "username": "demo_alice",
    "name": "Alice Rider",
    "avatarUrl": "http://localhost:3000/users/64135665-35b8-4956-861a-e99b87c09958/avatar?v=c87a688c-e509-4399-ae6b-fb93cd28a665"
  },
  "location": null,
  "voice": null,
  "createdAt": "2026-10-14T09:01:09.917Z",
  "readByCount": 0,
  "alert": {
    "requiresAck": true,
    "active": true,
    "ackCount": 0,
    "pendingCount": 2,
    "acknowledgedByMe": false,
    "resolvedAt": null,
    "resolvedBy": null
  }
}
```

### 176. Viewer tries a CRITICAL alert

`POST /groups/:groupId/alerts` 🔒

**Request**
```json
{
  "type": "CRITICAL",
  "category": "SAFETY",
  "body": "x"
}
```

**Response 403 Forbidden**

```json
{
  "message": "Requires group role: ADMIN",
  "error": "Forbidden",
  "statusCode": 403
}
```

### 177. CRITICAL without a category

`POST /groups/:groupId/alerts` 🔒

**Request**
```json
{
  "type": "CRITICAL",
  "body": "x"
}
```

**Response 400 Bad Request**

```json
{
  "message": [
    "category must be one of WEATHER, ROAD_CLOSURE, SAFETY, OTHER (required for CRITICAL)"
  ],
  "error": "Bad Request",
  "statusCode": 400
}
```

### 178. Send a GENERAL announcement

`POST /groups/:groupId/alerts` 🔒

**Request**
```json
{
  "type": "GENERAL",
  "body": "Dinner at 8 at the camp"
}
```

**Response 201 Created**

```json
{
  "id": "27a2b882-69b7-4a91-a658-655f66c49a09",
  "groupId": "e03e87cf-d598-4969-ba7a-3d8ac6ebefff",
  "type": "GENERAL",
  "kind": "TEXT",
  "category": null,
  "body": "Dinner at 8 at the camp",
  "clientMsgId": null,
  "sender": {
    "userId": "64135665-35b8-4956-861a-e99b87c09958",
    "username": "demo_alice",
    "name": "Alice Rider",
    "avatarUrl": "http://localhost:3000/users/64135665-35b8-4956-861a-e99b87c09958/avatar?v=c87a688c-e509-4399-ae6b-fb93cd28a665"
  },
  "location": null,
  "voice": null,
  "createdAt": "2026-10-14T09:01:10.462Z",
  "readByCount": 0,
  "alert": {
    "requiresAck": false,
    "active": false,
    "ackCount": 0,
    "pendingCount": 0,
    "acknowledgedByMe": false,
    "resolvedAt": null,
    "resolvedBy": null
  }
}
```

**Push sent to Bob**

```json
{
  "title": "Ladakh Ride 2026",
  "body": "Dinner at 8 at the camp",
  "data": {
    "type": "GENERAL_ALERT",
    "groupId": "e03e87cf-d598-4969-ba7a-3d8ac6ebefff",
    "alertId": "27a2b882-69b7-4a91-a658-655f66c49a09"
  }
}
```

**Push sent to Carol**

```json
{
  "title": "Ladakh Ride 2026",
  "body": "Dinner at 8 at the camp",
  "data": {
    "type": "GENERAL_ALERT",
    "groupId": "e03e87cf-d598-4969-ba7a-3d8ac6ebefff",
    "alertId": "27a2b882-69b7-4a91-a658-655f66c49a09"
  }
}
```

### 179. Raise an SOS with the phone coordinates

`POST /groups/:groupId/alerts/sos` 🔒

**Request**
```json
{
  "body": "Bike skidded near Gata Loops, ankle injured",
  "lat": 32.9,
  "lng": 77.6,
  "accuracy": 12
}
```

**Response 201 Created**

```json
{
  "id": "befa82d9-760e-40d5-8fce-b2113a6f7888",
  "groupId": "e03e87cf-d598-4969-ba7a-3d8ac6ebefff",
  "type": "SOS",
  "kind": "TEXT",
  "category": null,
  "body": "Bike skidded near Gata Loops, ankle injured",
  "clientMsgId": null,
  "sender": {
    "userId": "e8b0c791-0ecf-40ab-b2be-3c714a96f23e",
    "username": "demo_bob",
    "name": "Bob Kumar",
    "avatarUrl": null
  },
  "location": {
    "lat": 32.9,
    "lng": 77.6,
    "source": "DEVICE",
    "accuracy": 12,
    "recordedAt": "2026-10-14T09:01:10.638Z"
  },
  "voice": null,
  "createdAt": "2026-10-14T09:01:10.639Z",
  "readByCount": 0,
  "alert": {
    "requiresAck": true,
    "active": true,
    "ackCount": 0,
    "pendingCount": 2,
    "acknowledgedByMe": false,
    "resolvedAt": null,
    "resolvedBy": null
  }
}
```

**Push sent to Alice**

```json
{
  "title": "SOS from Bob Kumar",
  "body": "Ladakh Ride 2026: Bike skidded near Gata Loops, ankle injured",
  "data": {
    "type": "SOS",
    "groupId": "e03e87cf-d598-4969-ba7a-3d8ac6ebefff",
    "alertId": "befa82d9-760e-40d5-8fce-b2113a6f7888",
    "lat": "32.9",
    "lng": "77.6"
  }
}
```

**Push sent to Carol**

```json
{
  "title": "SOS from Bob Kumar",
  "body": "Ladakh Ride 2026: Bike skidded near Gata Loops, ankle injured",
  "data": {
    "type": "SOS",
    "groupId": "e03e87cf-d598-4969-ba7a-3d8ac6ebefff",
    "alertId": "befa82d9-760e-40d5-8fce-b2113a6f7888",
    "lat": "32.9",
    "lng": "77.6"
  }
}
```

### 180. Tap SOS again (returns the same active SOS)

`POST /groups/:groupId/alerts/sos` 🔒

**Request**
```json
{}
```

**Response 201 Created**

```json
{
  "id": "befa82d9-760e-40d5-8fce-b2113a6f7888",
  "groupId": "e03e87cf-d598-4969-ba7a-3d8ac6ebefff",
  "type": "SOS",
  "kind": "TEXT",
  "category": null,
  "body": "Bike skidded near Gata Loops, ankle injured",
  "clientMsgId": null,
  "sender": {
    "userId": "e8b0c791-0ecf-40ab-b2be-3c714a96f23e",
    "username": "demo_bob",
    "name": "Bob Kumar",
    "avatarUrl": null
  },
  "location": {
    "lat": 32.9,
    "lng": 77.6,
    "source": "DEVICE",
    "accuracy": 12,
    "recordedAt": "2026-10-14T09:01:10.638Z"
  },
  "voice": null,
  "createdAt": "2026-10-14T09:01:10.639Z",
  "readByCount": 0,
  "alert": {
    "requiresAck": true,
    "active": true,
    "ackCount": 0,
    "pendingCount": 2,
    "acknowledgedByMe": false,
    "resolvedAt": null,
    "resolvedBy": null
  }
}
```

### 181. SOS with lat but no lng

`POST /groups/:groupId/alerts/sos` 🔒

**Request**
```json
{
  "lat": 32.9
}
```

**Response 400 Bad Request**

```json
{
  "message": [
    "lat and lng must be sent together, as valid coordinates"
  ],
  "error": "Bad Request",
  "statusCode": 400
}
```

### 182. Active banners

`GET /groups/:groupId/alerts?active=true` 🔒

**Response 200 OK**

```json
{
  "items": [
    {
      "id": "befa82d9-760e-40d5-8fce-b2113a6f7888",
      "groupId": "e03e87cf-d598-4969-ba7a-3d8ac6ebefff",
      "type": "SOS",
      "kind": "TEXT",
      "category": null,
      "body": "Bike skidded near Gata Loops, ankle injured",
      "clientMsgId": null,
      "sender": {
        "userId": "e8b0c791-0ecf-40ab-b2be-3c714a96f23e",
        "username": "demo_bob",
        "name": "Bob Kumar",
        "avatarUrl": null
      },
      "location": {
        "lat": 32.9,
        "lng": 77.6,
        "source": "DEVICE",
        "accuracy": 12,
        "recordedAt": "2026-10-14T09:01:10.638Z"
      },
      "voice": null,
      "createdAt": "2026-10-14T09:01:10.639Z",
      "readByCount": 0,
      "alert": {
        "requiresAck": true,
        "active": true,
        "ackCount": 0,
        "pendingCount": 2,
        "acknowledgedByMe": false,
        "resolvedAt": null,
        "resolvedBy": null
      }
    },
    {
      "id": "70842cb1-0e24-42f7-a050-17260712a5f7",
      "groupId": "e03e87cf-d598-4969-ba7a-3d8ac6ebefff",
      "type": "CRITICAL",
      "kind": "TEXT",
      "category": "ROAD_CLOSURE",
      "body": "Rohtang Pass closed after a landslide. Take the Atal Tunnel.",
      "clientMsgId": null,
      "sender": {
        "userId": "64135665-35b8-4956-861a-e99b87c09958",
        "username": "demo_alice",
        "name": "Alice Rider",
        "avatarUrl": "http://localhost:3000/users/64135665-35b8-4956-861a-e99b87c09958/avatar?v=c87a688c-e509-4399-ae6b-fb93cd28a665"
      },
      "location": null,
      "voice": null,
      "createdAt": "2026-10-14T09:01:09.917Z",
      "readByCount": 1,
      "alert": {
        "requiresAck": true,
        "active": true,
        "ackCount": 0,
        "pendingCount": 2,
        "acknowledgedByMe": false,
        "resolvedAt": null,
        "resolvedBy": null
      }
    }
  ],
  "nextBefore": null
}
```

### 183. Acknowledge Bob's SOS

`POST /groups/:groupId/alerts/:alertId/ack` 🔒

**Response 200 OK**

```json
{
  "id": "befa82d9-760e-40d5-8fce-b2113a6f7888",
  "groupId": "e03e87cf-d598-4969-ba7a-3d8ac6ebefff",
  "type": "SOS",
  "kind": "TEXT",
  "category": null,
  "body": "Bike skidded near Gata Loops, ankle injured",
  "clientMsgId": null,
  "sender": {
    "userId": "e8b0c791-0ecf-40ab-b2be-3c714a96f23e",
    "username": "demo_bob",
    "name": "Bob Kumar",
    "avatarUrl": null
  },
  "location": {
    "lat": 32.9,
    "lng": 77.6,
    "source": "DEVICE",
    "accuracy": 12,
    "recordedAt": "2026-10-14T09:01:10.638Z"
  },
  "voice": null,
  "createdAt": "2026-10-14T09:01:10.639Z",
  "readByCount": 0,
  "alert": {
    "requiresAck": true,
    "active": true,
    "ackCount": 1,
    "pendingCount": 1,
    "acknowledgedByMe": true,
    "resolvedAt": null,
    "resolvedBy": null
  }
}
```

**Push sent to Bob**

```json
{
  "title": "Alice Rider saw your SOS",
  "body": "1 of 2 members have seen it",
  "data": {
    "type": "SOS_ACKNOWLEDGED",
    "groupId": "e03e87cf-d598-4969-ba7a-3d8ac6ebefff",
    "alertId": "befa82d9-760e-40d5-8fce-b2113a6f7888",
    "userId": "64135665-35b8-4956-861a-e99b87c09958"
  }
}
```

**Event `alert:acknowledged` received by Bob**

```json
{
  "groupId": "e03e87cf-d598-4969-ba7a-3d8ac6ebefff",
  "alertId": "befa82d9-760e-40d5-8fce-b2113a6f7888",
  "type": "SOS",
  "userId": "64135665-35b8-4956-861a-e99b87c09958",
  "username": "demo_alice",
  "name": "Alice Rider",
  "avatarUrl": "http://localhost:3000/users/64135665-35b8-4956-861a-e99b87c09958/avatar?v=c87a688c-e509-4399-ae6b-fb93cd28a665",
  "ackedAt": "2026-10-14T09:01:11.331Z",
  "ackCount": 1,
  "pendingCount": 1
}
```

### 184. Acknowledge your own SOS

`POST /groups/:groupId/alerts/:alertId/ack` 🔒

**Response 400 Bad Request**

```json
{
  "message": "You raised this alert",
  "error": "Bad Request",
  "statusCode": 400
}
```

### 185. Who has seen the SOS

`GET /groups/:groupId/alerts/:alertId` 🔒

**Response 200 OK**

```json
{
  "id": "befa82d9-760e-40d5-8fce-b2113a6f7888",
  "groupId": "e03e87cf-d598-4969-ba7a-3d8ac6ebefff",
  "type": "SOS",
  "kind": "TEXT",
  "category": null,
  "body": "Bike skidded near Gata Loops, ankle injured",
  "clientMsgId": null,
  "sender": {
    "userId": "e8b0c791-0ecf-40ab-b2be-3c714a96f23e",
    "username": "demo_bob",
    "name": "Bob Kumar",
    "avatarUrl": null
  },
  "location": {
    "lat": 32.9,
    "lng": 77.6,
    "source": "DEVICE",
    "accuracy": 12,
    "recordedAt": "2026-10-14T09:01:10.638Z"
  },
  "voice": null,
  "createdAt": "2026-10-14T09:01:10.639Z",
  "readByCount": 0,
  "alert": {
    "requiresAck": true,
    "active": true,
    "ackCount": 1,
    "pendingCount": 1,
    "acknowledgedByMe": false,
    "resolvedAt": null,
    "resolvedBy": null
  },
  "acknowledgements": [
    {
      "userId": "64135665-35b8-4956-861a-e99b87c09958",
      "username": "demo_alice",
      "name": "Alice Rider",
      "avatarUrl": "http://localhost:3000/users/64135665-35b8-4956-861a-e99b87c09958/avatar?v=c87a688c-e509-4399-ae6b-fb93cd28a665",
      "ackedAt": "2026-10-14T09:01:11.331Z"
    }
  ],
  "pending": [
    {
      "userId": "378ba245-309f-497b-938a-8cfc74d924a6",
      "username": "demo_carol",
      "name": "Carol Singh",
      "avatarUrl": null
    }
  ]
}
```

### 186. Resolve your SOS ("I'm safe")

`POST /groups/:groupId/alerts/:alertId/resolve` 🔒

**Response 200 OK**

```json
{
  "id": "befa82d9-760e-40d5-8fce-b2113a6f7888",
  "groupId": "e03e87cf-d598-4969-ba7a-3d8ac6ebefff",
  "type": "SOS",
  "kind": "TEXT",
  "category": null,
  "body": "Bike skidded near Gata Loops, ankle injured",
  "clientMsgId": null,
  "sender": {
    "userId": "e8b0c791-0ecf-40ab-b2be-3c714a96f23e",
    "username": "demo_bob",
    "name": "Bob Kumar",
    "avatarUrl": null
  },
  "location": {
    "lat": 32.9,
    "lng": 77.6,
    "source": "DEVICE",
    "accuracy": 12,
    "recordedAt": "2026-10-14T09:01:10.638Z"
  },
  "voice": null,
  "createdAt": "2026-10-14T09:01:10.639Z",
  "readByCount": 0,
  "alert": {
    "requiresAck": true,
    "active": false,
    "ackCount": 1,
    "pendingCount": 1,
    "acknowledgedByMe": false,
    "resolvedAt": "2026-10-14T09:01:11.866Z",
    "resolvedBy": {
      "userId": "e8b0c791-0ecf-40ab-b2be-3c714a96f23e",
      "username": "demo_bob",
      "name": "Bob Kumar",
      "avatarUrl": null
    }
  }
}
```

**Push sent to Alice**

```json
{
  "title": "Bob Kumar is safe",
  "body": "Bob Kumar marked their SOS as resolved.",
  "data": {
    "type": "SOS_RESOLVED",
    "groupId": "e03e87cf-d598-4969-ba7a-3d8ac6ebefff",
    "alertId": "befa82d9-760e-40d5-8fce-b2113a6f7888"
  }
}
```

**Push sent to Carol**

```json
{
  "title": "Bob Kumar is safe",
  "body": "Bob Kumar marked their SOS as resolved.",
  "data": {
    "type": "SOS_RESOLVED",
    "groupId": "e03e87cf-d598-4969-ba7a-3d8ac6ebefff",
    "alertId": "befa82d9-760e-40d5-8fce-b2113a6f7888"
  }
}
```

**Event `alert:resolved` received by Alice**

```json
{
  "groupId": "e03e87cf-d598-4969-ba7a-3d8ac6ebefff",
  "alertId": "befa82d9-760e-40d5-8fce-b2113a6f7888",
  "type": "SOS",
  "resolvedAt": "2026-10-14T09:01:11.866Z",
  "resolvedBy": {
    "userId": "e8b0c791-0ecf-40ab-b2be-3c714a96f23e",
    "username": "demo_bob",
    "name": "Bob Kumar",
    "avatarUrl": null
  }
}
```

### 187. Viewer tries to resolve the CRITICAL alert

`POST /groups/:groupId/alerts/:alertId/resolve` 🔒

**Response 403 Forbidden**

```json
{
  "message": "Only admins can resolve a critical alert",
  "error": "Forbidden",
  "statusCode": 403
}
```

### 188. Resolve the CRITICAL alert (admin)

`POST /groups/:groupId/alerts/:alertId/resolve` 🔒

**Response 200 OK**

```json
{
  "id": "70842cb1-0e24-42f7-a050-17260712a5f7",
  "groupId": "e03e87cf-d598-4969-ba7a-3d8ac6ebefff",
  "type": "CRITICAL",
  "kind": "TEXT",
  "category": "ROAD_CLOSURE",
  "body": "Rohtang Pass closed after a landslide. Take the Atal Tunnel.",
  "clientMsgId": null,
  "sender": {
    "userId": "64135665-35b8-4956-861a-e99b87c09958",
    "username": "demo_alice",
    "name": "Alice Rider",
    "avatarUrl": "http://localhost:3000/users/64135665-35b8-4956-861a-e99b87c09958/avatar?v=c87a688c-e509-4399-ae6b-fb93cd28a665"
  },
  "location": null,
  "voice": null,
  "createdAt": "2026-10-14T09:01:09.917Z",
  "readByCount": 1,
  "alert": {
    "requiresAck": true,
    "active": false,
    "ackCount": 0,
    "pendingCount": 2,
    "acknowledgedByMe": false,
    "resolvedAt": "2026-10-14T09:01:12.218Z",
    "resolvedBy": {
      "userId": "64135665-35b8-4956-861a-e99b87c09958",
      "username": "demo_alice",
      "name": "Alice Rider",
      "avatarUrl": "http://localhost:3000/users/64135665-35b8-4956-861a-e99b87c09958/avatar?v=c87a688c-e509-4399-ae6b-fb93cd28a665"
    }
  }
}
```

### 189. All alerts, newest first

`GET /groups/:groupId/alerts` 🔒

**Response 200 OK**

```json
{
  "items": [
    {
      "id": "befa82d9-760e-40d5-8fce-b2113a6f7888",
      "groupId": "e03e87cf-d598-4969-ba7a-3d8ac6ebefff",
      "type": "SOS",
      "kind": "TEXT",
      "category": null,
      "body": "Bike skidded near Gata Loops, ankle injured",
      "clientMsgId": null,
      "sender": {
        "userId": "e8b0c791-0ecf-40ab-b2be-3c714a96f23e",
        "username": "demo_bob",
        "name": "Bob Kumar",
        "avatarUrl": null
      },
      "location": {
        "lat": 32.9,
        "lng": 77.6,
        "source": "DEVICE",
        "accuracy": 12,
        "recordedAt": "2026-10-14T09:01:10.638Z"
      },
      "voice": null,
      "createdAt": "2026-10-14T09:01:10.639Z",
      "readByCount": 0,
      "alert": {
        "requiresAck": true,
        "active": false,
        "ackCount": 1,
        "pendingCount": 1,
        "acknowledgedByMe": false,
        "resolvedAt": "2026-10-14T09:01:11.866Z",
        "resolvedBy": {
          "userId": "e8b0c791-0ecf-40ab-b2be-3c714a96f23e",
          "username": "demo_bob",
          "name": "Bob Kumar",
          "avatarUrl": null
        }
      }
    },
    "…2 more"
  ],
  "nextBefore": null
}
```

### 190. Only SOS alerts, paged

`GET /groups/:groupId/alerts?type=SOS&limit=1` 🔒

**Response 200 OK**

```json
{
  "items": [
    {
      "id": "befa82d9-760e-40d5-8fce-b2113a6f7888",
      "groupId": "e03e87cf-d598-4969-ba7a-3d8ac6ebefff",
      "type": "SOS",
      "kind": "TEXT",
      "category": null,
      "body": "Bike skidded near Gata Loops, ankle injured",
      "clientMsgId": null,
      "sender": {
        "userId": "e8b0c791-0ecf-40ab-b2be-3c714a96f23e",
        "username": "demo_bob",
        "name": "Bob Kumar",
        "avatarUrl": null
      },
      "location": {
        "lat": 32.9,
        "lng": 77.6,
        "source": "DEVICE",
        "accuracy": 12,
        "recordedAt": "2026-10-14T09:01:10.638Z"
      },
      "voice": null,
      "createdAt": "2026-10-14T09:01:10.639Z",
      "readByCount": 0,
      "alert": {
        "requiresAck": true,
        "active": false,
        "ackCount": 1,
        "pendingCount": 1,
        "acknowledgedByMe": false,
        "resolvedAt": "2026-10-14T09:01:11.866Z",
        "resolvedBy": {
          "userId": "e8b0c791-0ecf-40ab-b2be-3c714a96f23e",
          "username": "demo_bob",
          "name": "Bob Kumar",
          "avatarUrl": null
        }
      }
    }
  ],
  "nextBefore": null
}
```

## Chat — read state after the alerts

### 191. Unread count

`GET /groups/:groupId/messages/unread` 🔒

**Response 200 OK**

```json
{
  "unreadCount": 6,
  "lastReadMessageId": "70b198f5-0112-49f6-bcdf-6e80cbce9c99",
  "lastReadAt": "2026-10-14T09:01:06.700Z"
}
```

### 192. Mark read over HTTP

`POST /groups/:groupId/messages/read` 🔒

**Request**
```json
{
  "messageId": "70842cb1-0e24-42f7-a050-17260712a5f7"
}
```

**Response 200 OK**

```json
{
  "unreadCount": 2,
  "lastReadMessageId": "70842cb1-0e24-42f7-a050-17260712a5f7",
  "lastReadAt": "2026-10-14T09:01:09.917Z"
}
```

### 193. Read receipts for an unknown message

`GET /groups/:groupId/messages/:messageId/reads` 🔒

**Response 404 Not Found**

```json
{
  "message": "Message not found",
  "error": "Not Found",
  "statusCode": 404
}
```

## Expenses

### 194. Add an expense split equally between everyone

`POST /groups/:groupId/expenses` 🔒

**Request**
```json
{
  "amount": 900,
  "category": "FUEL",
  "date": "2026-10-11",
  "description": "Diesel at Tandi",
  "splitType": "EQUAL",
  "clientId": "0d4ed757-569e-4ea7-887a-bdaa3edc1409"
}
```

**Response 201 Created**

```json
{
  "id": "1436786b-83f4-476e-8166-4b6498064203",
  "groupId": "e03e87cf-d598-4969-ba7a-3d8ac6ebefff",
  "amount": 900,
  "currency": "INR",
  "category": "FUEL",
  "date": "2026-10-11",
  "description": "Diesel at Tandi",
  "splitType": "EQUAL",
  "paidBy": {
    "userId": "64135665-35b8-4956-861a-e99b87c09958",
    "username": "demo_alice",
    "name": "Alice Rider",
    "avatarUrl": "http://localhost:3000/users/64135665-35b8-4956-861a-e99b87c09958/avatar?v=c87a688c-e509-4399-ae6b-fb93cd28a665"
  },
  "payments": [
    {
      "userId": "64135665-35b8-4956-861a-e99b87c09958",
      "username": "demo_alice",
      "name": "Alice Rider",
      "avatarUrl": "http://localhost:3000/users/64135665-35b8-4956-861a-e99b87c09958/avatar?v=c87a688c-e509-4399-ae6b-fb93cd28a665",
      "amount": 900
    }
  ],
  "createdBy": {
    "userId": "64135665-35b8-4956-861a-e99b87c09958",
    "username": "demo_alice",
    "name": "Alice Rider",
    "avatarUrl": "http://localhost:3000/users/64135665-35b8-4956-861a-e99b87c09958/avatar?v=c87a688c-e509-4399-ae6b-fb93cd28a665"
  },
  "splits": [
    {
      "userId": "64135665-35b8-4956-861a-e99b87c09958",
      "username": "demo_alice",
      "name": "Alice Rider",
      "avatarUrl": "http://localhost:3000/users/64135665-35b8-4956-861a-e99b87c09958/avatar?v=c87a688c-e509-4399-ae6b-fb93cd28a665",
      "amount": 300
    },
    {
      "userId": "e8b0c791-0ecf-40ab-b2be-3c714a96f23e",
      "username": "demo_bob",
      "name": "Bob Kumar",
      "avatarUrl": null,
      "amount": 300
    },
    {
      "userId": "378ba245-309f-497b-938a-8cfc74d924a6",
      "username": "demo_carol",
      "name": "Carol Singh",
      "avatarUrl": null,
      "amount": 300
    }
  ],
  "myShare": 300,
  "hasReceipt": false,
  "receiptContentType": null,
  "canEdit": true,
  "createdAt": "2026-10-14T09:01:13.268Z",
  "updatedAt": "2026-10-14T09:01:13.268Z"
}
```

**Push sent to Bob**

```json
{
  "title": "Ladakh Ride 2026",
  "body": "Alice Rider added Diesel at Tandi: INR 900.00. Your share: INR 300.00",
  "data": {
    "type": "EXPENSE_ADDED",
    "groupId": "e03e87cf-d598-4969-ba7a-3d8ac6ebefff",
    "expenseId": "1436786b-83f4-476e-8166-4b6498064203"
  }
}
```

**Push sent to Carol**

```json
{
  "title": "Ladakh Ride 2026",
  "body": "Alice Rider added Diesel at Tandi: INR 900.00. Your share: INR 300.00",
  "data": {
    "type": "EXPENSE_ADDED",
    "groupId": "e03e87cf-d598-4969-ba7a-3d8ac6ebefff",
    "expenseId": "1436786b-83f4-476e-8166-4b6498064203"
  }
}
```

**Event `expense:created` received by Bob**

```json
{
  "groupId": "e03e87cf-d598-4969-ba7a-3d8ac6ebefff",
  "expenseId": "1436786b-83f4-476e-8166-4b6498064203",
  "byUserId": "64135665-35b8-4956-861a-e99b87c09958",
  "timestamp": "2026-10-14T09:01:13.305Z",
  "expense": {
    "id": "1436786b-83f4-476e-8166-4b6498064203",
    "groupId": "e03e87cf-d598-4969-ba7a-3d8ac6ebefff",
    "amount": 900,
    "currency": "INR",
    "category": "FUEL",
    "date": "2026-10-11",
    "description": "Diesel at Tandi",
    "splitType": "EQUAL",
    "paidBy": {
      "userId": "64135665-35b8-4956-861a-e99b87c09958",
      "username": "demo_alice",
      "name": "Alice Rider",
      "avatarUrl": "http://localhost:3000/users/64135665-35b8-4956-861a-e99b87c09958/avatar?v=c87a688c-e509-4399-ae6b-fb93cd28a665"
    },
    "payments": [
      {
        "userId": "64135665-35b8-4956-861a-e99b87c09958",
        "username": "demo_alice",
        "name": "Alice Rider",
        "avatarUrl": "http://localhost:3000/users/64135665-35b8-4956-861a-e99b87c09958/avatar?v=c87a688c-e509-4399-ae6b-fb93cd28a665",
        "amount": 900
      }
    ],
    "createdBy": {
      "userId": "64135665-35b8-4956-861a-e99b87c09958",
      "username": "demo_alice",
      "name": "Alice Rider",
      "avatarUrl": "http://localhost:3000/users/64135665-35b8-4956-861a-e99b87c09958/avatar?v=c87a688c-e509-4399-ae6b-fb93cd28a665"
    },
    "splits": [
      {
        "userId": "64135665-35b8-4956-861a-e99b87c09958",
        "username": "demo_alice",
        "name": "Alice Rider",
        "avatarUrl": "http://localhost:3000/users/64135665-35b8-4956-861a-e99b87c09958/avatar?v=c87a688c-e509-4399-ae6b-fb93cd28a665",
        "amount": 300
      },
      {
        "userId": "e8b0c791-0ecf-40ab-b2be-3c714a96f23e",
        "username": "demo_bob",
        "name": "Bob Kumar",
        "avatarUrl": null,
        "amount": 300
      },
      {
        "userId": "378ba245-309f-497b-938a-8cfc74d924a6",
        "username": "demo_carol",
        "name": "Carol Singh",
        "avatarUrl": null,
        "amount": 300
      }
    ],
    "hasReceipt": false,
    "receiptContentType": null,
    "createdAt": "2026-10-14T09:01:13.268Z",
    "updatedAt": "2026-10-14T09:01:13.268Z"
  }
}
```

### 195. Split equally between chosen members only

`POST /groups/:groupId/expenses` 🔒

**Request**
```json
{
  "amount": 100.01,
  "category": "FOOD",
  "date": "2026-10-12",
  "description": "Maggi + chai",
  "splitType": "EQUAL",
  "splitBetween": [
    "e8b0c791-0ecf-40ab-b2be-3c714a96f23e",
    "378ba245-309f-497b-938a-8cfc74d924a6"
  ]
}
```

**Response 201 Created**

```json
{
  "id": "346c44f0-8d98-4dbb-affb-c192fecd5095",
  "groupId": "e03e87cf-d598-4969-ba7a-3d8ac6ebefff",
  "amount": 100.01,
  "currency": "INR",
  "category": "FOOD",
  "date": "2026-10-12",
  "description": "Maggi + chai",
  "splitType": "EQUAL",
  "paidBy": {
    "userId": "e8b0c791-0ecf-40ab-b2be-3c714a96f23e",
    "username": "demo_bob",
    "name": "Bob Kumar",
    "avatarUrl": null
  },
  "payments": [
    {
      "userId": "e8b0c791-0ecf-40ab-b2be-3c714a96f23e",
      "username": "demo_bob",
      "name": "Bob Kumar",
      "avatarUrl": null,
      "amount": 100.01
    }
  ],
  "createdBy": {
    "userId": "e8b0c791-0ecf-40ab-b2be-3c714a96f23e",
    "username": "demo_bob",
    "name": "Bob Kumar",
    "avatarUrl": null
  },
  "splits": [
    {
      "userId": "e8b0c791-0ecf-40ab-b2be-3c714a96f23e",
      "username": "demo_bob",
      "name": "Bob Kumar",
      "avatarUrl": null,
      "amount": 50.01
    },
    {
      "userId": "378ba245-309f-497b-938a-8cfc74d924a6",
      "username": "demo_carol",
      "name": "Carol Singh",
      "avatarUrl": null,
      "amount": 50
    }
  ],
  "myShare": 50.01,
  "hasReceipt": false,
  "receiptContentType": null,
  "canEdit": true,
  "createdAt": "2026-10-14T09:01:13.468Z",
  "updatedAt": "2026-10-14T09:01:13.468Z"
}
```

**Push sent to Carol**

```json
{
  "title": "Ladakh Ride 2026",
  "body": "Bob Kumar added Maggi + chai: INR 100.01. Your share: INR 50.00",
  "data": {
    "type": "EXPENSE_ADDED",
    "groupId": "e03e87cf-d598-4969-ba7a-3d8ac6ebefff",
    "expenseId": "346c44f0-8d98-4dbb-affb-c192fecd5095"
  }
}
```

### 196. Custom split, paid by someone else

`POST /groups/:groupId/expenses` 🔒

**Request**
```json
{
  "amount": 3000,
  "category": "ACCOMMODATION",
  "date": "2026-10-12",
  "description": "Homestay in Jispa",
  "paidBy": "378ba245-309f-497b-938a-8cfc74d924a6",
  "splitType": "CUSTOM",
  "shares": [
    {
      "userId": "64135665-35b8-4956-861a-e99b87c09958",
      "amount": 1200
    },
    {
      "userId": "e8b0c791-0ecf-40ab-b2be-3c714a96f23e",
      "amount": 900
    },
    {
      "userId": "378ba245-309f-497b-938a-8cfc74d924a6",
      "amount": 900
    }
  ]
}
```

**Response 201 Created**

```json
{
  "id": "028cd456-3d6d-45fa-80d0-ee33fc41934c",
  "groupId": "e03e87cf-d598-4969-ba7a-3d8ac6ebefff",
  "amount": 3000,
  "currency": "INR",
  "category": "ACCOMMODATION",
  "date": "2026-10-12",
  "description": "Homestay in Jispa",
  "splitType": "CUSTOM",
  "paidBy": {
    "userId": "378ba245-309f-497b-938a-8cfc74d924a6",
    "username": "demo_carol",
    "name": "Carol Singh",
    "avatarUrl": null
  },
  "payments": [
    {
      "userId": "378ba245-309f-497b-938a-8cfc74d924a6",
      "username": "demo_carol",
      "name": "Carol Singh",
      "avatarUrl": null,
      "amount": 3000
    }
  ],
  "createdBy": {
    "userId": "64135665-35b8-4956-861a-e99b87c09958",
    "username": "demo_alice",
    "name": "Alice Rider",
    "avatarUrl": "http://localhost:3000/users/64135665-35b8-4956-861a-e99b87c09958/avatar?v=c87a688c-e509-4399-ae6b-fb93cd28a665"
  },
  "splits": [
    {
      "userId": "64135665-35b8-4956-861a-e99b87c09958",
      "username": "demo_alice",
      "name": "Alice Rider",
      "avatarUrl": "http://localhost:3000/users/64135665-35b8-4956-861a-e99b87c09958/avatar?v=c87a688c-e509-4399-ae6b-fb93cd28a665",
      "amount": 1200
    },
    {
      "userId": "e8b0c791-0ecf-40ab-b2be-3c714a96f23e",
      "username": "demo_bob",
      "name": "Bob Kumar",
      "avatarUrl": null,
      "amount": 900
    },
    {
      "userId": "378ba245-309f-497b-938a-8cfc74d924a6",
      "username": "demo_carol",
      "name": "Carol Singh",
      "avatarUrl": null,
      "amount": 900
    }
  ],
  "myShare": 1200,
  "hasReceipt": false,
  "receiptContentType": null,
  "canEdit": true,
  "createdAt": "2026-10-14T09:01:13.644Z",
  "updatedAt": "2026-10-14T09:01:13.644Z"
}
```

**Push sent to Bob**

```json
{
  "title": "Ladakh Ride 2026",
  "body": "Alice Rider added Homestay in Jispa: INR 3,000.00. Your share: INR 900.00",
  "data": {
    "type": "EXPENSE_ADDED",
    "groupId": "e03e87cf-d598-4969-ba7a-3d8ac6ebefff",
    "expenseId": "028cd456-3d6d-45fa-80d0-ee33fc41934c"
  }
}
```

**Push sent to Carol**

```json
{
  "title": "Ladakh Ride 2026",
  "body": "Alice Rider added Homestay in Jispa: INR 3,000.00. Your share: INR 900.00",
  "data": {
    "type": "EXPENSE_ADDED",
    "groupId": "e03e87cf-d598-4969-ba7a-3d8ac6ebefff",
    "expenseId": "028cd456-3d6d-45fa-80d0-ee33fc41934c"
  }
}
```

### 197. Several people paid one expense

`POST /groups/:groupId/expenses` 🔒

**Request**
```json
{
  "amount": 1200,
  "category": "FOOD",
  "date": "2026-10-13",
  "description": "Dinner in Leh",
  "splitType": "EQUAL",
  "splitBetween": [
    "64135665-35b8-4956-861a-e99b87c09958",
    "e8b0c791-0ecf-40ab-b2be-3c714a96f23e",
    "378ba245-309f-497b-938a-8cfc74d924a6"
  ],
  "payments": [
    {
      "userId": "64135665-35b8-4956-861a-e99b87c09958",
      "amount": 800
    },
    {
      "userId": "e8b0c791-0ecf-40ab-b2be-3c714a96f23e",
      "amount": 400
    }
  ]
}
```

**Response 201 Created**

```json
{
  "id": "848eec71-d074-4a98-8ba1-b932312a8284",
  "groupId": "e03e87cf-d598-4969-ba7a-3d8ac6ebefff",
  "amount": 1200,
  "currency": "INR",
  "category": "FOOD",
  "date": "2026-10-13",
  "description": "Dinner in Leh",
  "splitType": "EQUAL",
  "paidBy": {
    "userId": "64135665-35b8-4956-861a-e99b87c09958",
    "username": "demo_alice",
    "name": "Alice Rider",
    "avatarUrl": "http://localhost:3000/users/64135665-35b8-4956-861a-e99b87c09958/avatar?v=c87a688c-e509-4399-ae6b-fb93cd28a665"
  },
  "payments": [
    {
      "userId": "64135665-35b8-4956-861a-e99b87c09958",
      "username": "demo_alice",
      "name": "Alice Rider",
      "avatarUrl": "http://localhost:3000/users/64135665-35b8-4956-861a-e99b87c09958/avatar?v=c87a688c-e509-4399-ae6b-fb93cd28a665",
      "amount": 800
    },
    {
      "userId": "e8b0c791-0ecf-40ab-b2be-3c714a96f23e",
      "username": "demo_bob",
      "name": "Bob Kumar",
      "avatarUrl": null,
      "amount": 400
    }
  ],
  "createdBy": {
    "userId": "64135665-35b8-4956-861a-e99b87c09958",
    "username": "demo_alice",
    "name": "Alice Rider",
    "avatarUrl": "http://localhost:3000/users/64135665-35b8-4956-861a-e99b87c09958/avatar?v=c87a688c-e509-4399-ae6b-fb93cd28a665"
  },
  "splits": [
    {
      "userId": "64135665-35b8-4956-861a-e99b87c09958",
      "username": "demo_alice",
      "name": "Alice Rider",
      "avatarUrl": "http://localhost:3000/users/64135665-35b8-4956-861a-e99b87c09958/avatar?v=c87a688c-e509-4399-ae6b-fb93cd28a665",
      "amount": 400
    },
    {
      "userId": "e8b0c791-0ecf-40ab-b2be-3c714a96f23e",
      "username": "demo_bob",
      "name": "Bob Kumar",
      "avatarUrl": null,
      "amount": 400
    },
    {
      "userId": "378ba245-309f-497b-938a-8cfc74d924a6",
      "username": "demo_carol",
      "name": "Carol Singh",
      "avatarUrl": null,
      "amount": 400
    }
  ],
  "myShare": 400,
  "hasReceipt": false,
  "receiptContentType": null,
  "canEdit": true,
  "createdAt": "2026-10-14T09:01:13.821Z",
  "updatedAt": "2026-10-14T09:01:13.821Z"
}
```

**Push sent to Bob**

```json
{
  "title": "Ladakh Ride 2026",
  "body": "Alice Rider added Dinner in Leh: INR 1,200.00. Your share: INR 400.00",
  "data": {
    "type": "EXPENSE_ADDED",
    "groupId": "e03e87cf-d598-4969-ba7a-3d8ac6ebefff",
    "expenseId": "848eec71-d074-4a98-8ba1-b932312a8284"
  }
}
```

**Push sent to Carol**

```json
{
  "title": "Ladakh Ride 2026",
  "body": "Alice Rider added Dinner in Leh: INR 1,200.00. Your share: INR 400.00",
  "data": {
    "type": "EXPENSE_ADDED",
    "groupId": "e03e87cf-d598-4969-ba7a-3d8ac6ebefff",
    "expenseId": "848eec71-d074-4a98-8ba1-b932312a8284"
  }
}
```

### 198. Custom shares that do not add up

`POST /groups/:groupId/expenses` 🔒

**Request**
```json
{
  "amount": 100,
  "category": "OTHER",
  "date": "2026-10-13",
  "splitType": "CUSTOM",
  "shares": [
    {
      "userId": "64135665-35b8-4956-861a-e99b87c09958",
      "amount": 60
    }
  ]
}
```

**Response 400 Bad Request**

```json
{
  "message": "shares add up to 60.00, but the amount is 100.00",
  "error": "Bad Request",
  "statusCode": 400
}
```

### 199. Both paidBy and payments

`POST /groups/:groupId/expenses` 🔒

**Request**
```json
{
  "amount": 100,
  "category": "OTHER",
  "date": "2026-10-13",
  "splitType": "EQUAL",
  "paidBy": "64135665-35b8-4956-861a-e99b87c09958",
  "payments": [
    {
      "userId": "64135665-35b8-4956-861a-e99b87c09958",
      "amount": 100
    }
  ]
}
```

**Response 400 Bad Request**

```json
{
  "message": "Send paidBy (one payer) or payments (several), not both",
  "error": "Bad Request",
  "statusCode": 400
}
```

### 200. List expenses (newest day first)

`GET /groups/:groupId/expenses` 🔒

**Response 200 OK**

```json
{
  "items": [
    {
      "id": "848eec71-d074-4a98-8ba1-b932312a8284",
      "groupId": "e03e87cf-d598-4969-ba7a-3d8ac6ebefff",
      "amount": 1200,
      "currency": "INR",
      "category": "FOOD",
      "date": "2026-10-13",
      "description": "Dinner in Leh",
      "splitType": "EQUAL",
      "paidBy": {
        "userId": "64135665-35b8-4956-861a-e99b87c09958",
        "username": "demo_alice",
        "name": "Alice Rider",
        "avatarUrl": "http://localhost:3000/users/64135665-35b8-4956-861a-e99b87c09958/avatar?v=c87a688c-e509-4399-ae6b-fb93cd28a665"
      },
      "payments": [
        {
          "userId": "64135665-35b8-4956-861a-e99b87c09958",
          "username": "demo_alice",
          "name": "Alice Rider",
          "avatarUrl": "http://localhost:3000/users/64135665-35b8-4956-861a-e99b87c09958/avatar?v=c87a688c-e509-4399-ae6b-fb93cd28a665",
          "amount": 800
        },
        "…1 more"
      ],
      "createdBy": {
        "userId": "64135665-35b8-4956-861a-e99b87c09958",
        "username": "demo_alice",
        "name": "Alice Rider",
        "avatarUrl": "http://localhost:3000/users/64135665-35b8-4956-861a-e99b87c09958/avatar?v=c87a688c-e509-4399-ae6b-fb93cd28a665"
      },
      "splits": [
        {
          "userId": "64135665-35b8-4956-861a-e99b87c09958",
          "username": "demo_alice",
          "name": "Alice Rider",
          "avatarUrl": "http://localhost:3000/users/64135665-35b8-4956-861a-e99b87c09958/avatar?v=c87a688c-e509-4399-ae6b-fb93cd28a665",
          "amount": 400
        },
        "…2 more"
      ],
      "myShare": 400,
      "hasReceipt": false,
      "receiptContentType": null,
      "canEdit": false,
      "createdAt": "2026-10-14T09:01:13.821Z",
      "updatedAt": "2026-10-14T09:01:13.821Z"
    },
    "…3 more"
  ],
  "nextBefore": null
}
```

### 201. Expenses Bob paid (all or part of)

`GET /groups/:groupId/expenses?paidBy=e8b0c791-0ecf-40ab-b2be-3c714a96f23e` 🔒

**Response 200 OK**

```json
{
  "items": [
    {
      "id": "848eec71-d074-4a98-8ba1-b932312a8284",
      "groupId": "e03e87cf-d598-4969-ba7a-3d8ac6ebefff",
      "amount": 1200,
      "currency": "INR",
      "category": "FOOD",
      "date": "2026-10-13",
      "description": "Dinner in Leh",
      "splitType": "EQUAL",
      "paidBy": {
        "userId": "64135665-35b8-4956-861a-e99b87c09958",
        "username": "demo_alice",
        "name": "Alice Rider",
        "avatarUrl": "http://localhost:3000/users/64135665-35b8-4956-861a-e99b87c09958/avatar?v=c87a688c-e509-4399-ae6b-fb93cd28a665"
      },
      "payments": [
        {
          "userId": "64135665-35b8-4956-861a-e99b87c09958",
          "username": "demo_alice",
          "name": "Alice Rider",
          "avatarUrl": "http://localhost:3000/users/64135665-35b8-4956-861a-e99b87c09958/avatar?v=c87a688c-e509-4399-ae6b-fb93cd28a665",
          "amount": 800
        },
        "…1 more"
      ],
      "createdBy": {
        "userId": "64135665-35b8-4956-861a-e99b87c09958",
        "username": "demo_alice",
        "name": "Alice Rider",
        "avatarUrl": "http://localhost:3000/users/64135665-35b8-4956-861a-e99b87c09958/avatar?v=c87a688c-e509-4399-ae6b-fb93cd28a665"
      },
      "splits": [
        {
          "userId": "64135665-35b8-4956-861a-e99b87c09958",
          "username": "demo_alice",
          "name": "Alice Rider",
          "avatarUrl": "http://localhost:3000/users/64135665-35b8-4956-861a-e99b87c09958/avatar?v=c87a688c-e509-4399-ae6b-fb93cd28a665",
          "amount": 400
        },
        "…2 more"
      ],
      "myShare": 400,
      "hasReceipt": false,
      "receiptContentType": null,
      "canEdit": false,
      "createdAt": "2026-10-14T09:01:13.821Z",
      "updatedAt": "2026-10-14T09:01:13.821Z"
    },
    "…1 more"
  ],
  "nextBefore": null
}
```

### 202. One expense

`GET /groups/:groupId/expenses/:expenseId` 🔒

**Response 200 OK**

```json
{
  "id": "1436786b-83f4-476e-8166-4b6498064203",
  "groupId": "e03e87cf-d598-4969-ba7a-3d8ac6ebefff",
  "amount": 900,
  "currency": "INR",
  "category": "FUEL",
  "date": "2026-10-11",
  "description": "Diesel at Tandi",
  "splitType": "EQUAL",
  "paidBy": {
    "userId": "64135665-35b8-4956-861a-e99b87c09958",
    "username": "demo_alice",
    "name": "Alice Rider",
    "avatarUrl": "http://localhost:3000/users/64135665-35b8-4956-861a-e99b87c09958/avatar?v=c87a688c-e509-4399-ae6b-fb93cd28a665"
  },
  "payments": [
    {
      "userId": "64135665-35b8-4956-861a-e99b87c09958",
      "username": "demo_alice",
      "name": "Alice Rider",
      "avatarUrl": "http://localhost:3000/users/64135665-35b8-4956-861a-e99b87c09958/avatar?v=c87a688c-e509-4399-ae6b-fb93cd28a665",
      "amount": 900
    }
  ],
  "createdBy": {
    "userId": "64135665-35b8-4956-861a-e99b87c09958",
    "username": "demo_alice",
    "name": "Alice Rider",
    "avatarUrl": "http://localhost:3000/users/64135665-35b8-4956-861a-e99b87c09958/avatar?v=c87a688c-e509-4399-ae6b-fb93cd28a665"
  },
  "splits": [
    {
      "userId": "64135665-35b8-4956-861a-e99b87c09958",
      "username": "demo_alice",
      "name": "Alice Rider",
      "avatarUrl": "http://localhost:3000/users/64135665-35b8-4956-861a-e99b87c09958/avatar?v=c87a688c-e509-4399-ae6b-fb93cd28a665",
      "amount": 300
    },
    {
      "userId": "e8b0c791-0ecf-40ab-b2be-3c714a96f23e",
      "username": "demo_bob",
      "name": "Bob Kumar",
      "avatarUrl": null,
      "amount": 300
    },
    {
      "userId": "378ba245-309f-497b-938a-8cfc74d924a6",
      "username": "demo_carol",
      "name": "Carol Singh",
      "avatarUrl": null,
      "amount": 300
    }
  ],
  "myShare": 300,
  "hasReceipt": false,
  "receiptContentType": null,
  "canEdit": false,
  "createdAt": "2026-10-14T09:01:13.268Z",
  "updatedAt": "2026-10-14T09:01:13.268Z"
}
```

### 203. Viewer edits someone else's expense

`PATCH /groups/:groupId/expenses/:expenseId` 🔒

**Request**
```json
{
  "description": "mine"
}
```

**Response 403 Forbidden**

```json
{
  "message": "Only whoever recorded this expense, or an admin, can change it",
  "error": "Forbidden",
  "statusCode": 403
}
```

### 204. Change the amount (EQUAL re-splits)

`PATCH /groups/:groupId/expenses/:expenseId` 🔒

**Request**
```json
{
  "amount": 1200
}
```

**Response 200 OK**

```json
{
  "id": "1436786b-83f4-476e-8166-4b6498064203",
  "groupId": "e03e87cf-d598-4969-ba7a-3d8ac6ebefff",
  "amount": 1200,
  "currency": "INR",
  "category": "FUEL",
  "date": "2026-10-11",
  "description": "Diesel at Tandi",
  "splitType": "EQUAL",
  "paidBy": {
    "userId": "64135665-35b8-4956-861a-e99b87c09958",
    "username": "demo_alice",
    "name": "Alice Rider",
    "avatarUrl": "http://localhost:3000/users/64135665-35b8-4956-861a-e99b87c09958/avatar?v=c87a688c-e509-4399-ae6b-fb93cd28a665"
  },
  "payments": [
    {
      "userId": "64135665-35b8-4956-861a-e99b87c09958",
      "username": "demo_alice",
      "name": "Alice Rider",
      "avatarUrl": "http://localhost:3000/users/64135665-35b8-4956-861a-e99b87c09958/avatar?v=c87a688c-e509-4399-ae6b-fb93cd28a665",
      "amount": 1200
    }
  ],
  "createdBy": {
    "userId": "64135665-35b8-4956-861a-e99b87c09958",
    "username": "demo_alice",
    "name": "Alice Rider",
    "avatarUrl": "http://localhost:3000/users/64135665-35b8-4956-861a-e99b87c09958/avatar?v=c87a688c-e509-4399-ae6b-fb93cd28a665"
  },
  "splits": [
    {
      "userId": "64135665-35b8-4956-861a-e99b87c09958",
      "username": "demo_alice",
      "name": "Alice Rider",
      "avatarUrl": "http://localhost:3000/users/64135665-35b8-4956-861a-e99b87c09958/avatar?v=c87a688c-e509-4399-ae6b-fb93cd28a665",
      "amount": 400
    },
    {
      "userId": "e8b0c791-0ecf-40ab-b2be-3c714a96f23e",
      "username": "demo_bob",
      "name": "Bob Kumar",
      "avatarUrl": null,
      "amount": 400
    },
    {
      "userId": "378ba245-309f-497b-938a-8cfc74d924a6",
      "username": "demo_carol",
      "name": "Carol Singh",
      "avatarUrl": null,
      "amount": 400
    }
  ],
  "myShare": 400,
  "hasReceipt": false,
  "receiptContentType": null,
  "canEdit": true,
  "createdAt": "2026-10-14T09:01:13.268Z",
  "updatedAt": "2026-10-14T09:01:15.011Z"
}
```

**Event `expense:updated` received by Bob**

```json
{
  "groupId": "e03e87cf-d598-4969-ba7a-3d8ac6ebefff",
  "expenseId": "1436786b-83f4-476e-8166-4b6498064203",
  "byUserId": "64135665-35b8-4956-861a-e99b87c09958",
  "timestamp": "2026-10-14T09:01:15.022Z",
  "expense": {
    "id": "1436786b-83f4-476e-8166-4b6498064203",
    "groupId": "e03e87cf-d598-4969-ba7a-3d8ac6ebefff",
    "amount": 1200,
    "currency": "INR",
    "category": "FUEL",
    "date": "2026-10-11",
    "description": "Diesel at Tandi",
    "splitType": "EQUAL",
    "paidBy": {
      "userId": "64135665-35b8-4956-861a-e99b87c09958",
      "username": "demo_alice",
      "name": "Alice Rider",
      "avatarUrl": "http://localhost:3000/users/64135665-35b8-4956-861a-e99b87c09958/avatar?v=c87a688c-e509-4399-ae6b-fb93cd28a665"
    },
    "payments": [
      {
        "userId": "64135665-35b8-4956-861a-e99b87c09958",
        "username": "demo_alice",
        "name": "Alice Rider",
        "avatarUrl": "http://localhost:3000/users/64135665-35b8-4956-861a-e99b87c09958/avatar?v=c87a688c-e509-4399-ae6b-fb93cd28a665",
        "amount": 1200
      }
    ],
    "createdBy": {
      "userId": "64135665-35b8-4956-861a-e99b87c09958",
      "username": "demo_alice",
      "name": "Alice Rider",
      "avatarUrl": "http://localhost:3000/users/64135665-35b8-4956-861a-e99b87c09958/avatar?v=c87a688c-e509-4399-ae6b-fb93cd28a665"
    },
    "splits": [
      {
        "userId": "64135665-35b8-4956-861a-e99b87c09958",
        "username": "demo_alice",
        "name": "Alice Rider",
        "avatarUrl": "http://localhost:3000/users/64135665-35b8-4956-861a-e99b87c09958/avatar?v=c87a688c-e509-4399-ae6b-fb93cd28a665",
        "amount": 400
      },
      {
        "userId": "e8b0c791-0ecf-40ab-b2be-3c714a96f23e",
        "username": "demo_bob",
        "name": "Bob Kumar",
        "avatarUrl": null,
        "amount": 400
      },
      {
        "userId": "378ba245-309f-497b-938a-8cfc74d924a6",
        "username": "demo_carol",
        "name": "Carol Singh",
        "avatarUrl": null,
        "amount": 400
      }
    ],
    "hasReceipt": false,
    "receiptContentType": null,
    "createdAt": "2026-10-14T09:01:13.268Z",
    "updatedAt": "2026-10-14T09:01:15.011Z"
  }
}
```

### 205. Change the amount of a several-payer expense without new payments

`PATCH /groups/:groupId/expenses/:expenseId` 🔒

**Request**
```json
{
  "amount": 1500
}
```

**Response 400 Bad Request**

```json
{
  "message": "Send the new payments when changing the amount of an expense several people paid",
  "error": "Bad Request",
  "statusCode": 400
}
```

### 206. Attach a receipt

`PUT /groups/:groupId/expenses/:expenseId/receipt` 🔒

**Request** (multipart/form-data)

- `file`: bill.png (image/png, 128 bytes)

**Response 200 OK**

```json
{
  "id": "1436786b-83f4-476e-8166-4b6498064203",
  "groupId": "e03e87cf-d598-4969-ba7a-3d8ac6ebefff",
  "amount": 1200,
  "currency": "INR",
  "category": "FUEL",
  "date": "2026-10-11",
  "description": "Diesel at Tandi",
  "splitType": "EQUAL",
  "paidBy": {
    "userId": "64135665-35b8-4956-861a-e99b87c09958",
    "username": "demo_alice",
    "name": "Alice Rider",
    "avatarUrl": "http://localhost:3000/users/64135665-35b8-4956-861a-e99b87c09958/avatar?v=c87a688c-e509-4399-ae6b-fb93cd28a665"
  },
  "payments": [
    {
      "userId": "64135665-35b8-4956-861a-e99b87c09958",
      "username": "demo_alice",
      "name": "Alice Rider",
      "avatarUrl": "http://localhost:3000/users/64135665-35b8-4956-861a-e99b87c09958/avatar?v=c87a688c-e509-4399-ae6b-fb93cd28a665",
      "amount": 1200
    }
  ],
  "createdBy": {
    "userId": "64135665-35b8-4956-861a-e99b87c09958",
    "username": "demo_alice",
    "name": "Alice Rider",
    "avatarUrl": "http://localhost:3000/users/64135665-35b8-4956-861a-e99b87c09958/avatar?v=c87a688c-e509-4399-ae6b-fb93cd28a665"
  },
  "splits": [
    {
      "userId": "64135665-35b8-4956-861a-e99b87c09958",
      "username": "demo_alice",
      "name": "Alice Rider",
      "avatarUrl": "http://localhost:3000/users/64135665-35b8-4956-861a-e99b87c09958/avatar?v=c87a688c-e509-4399-ae6b-fb93cd28a665",
      "amount": 400
    },
    {
      "userId": "e8b0c791-0ecf-40ab-b2be-3c714a96f23e",
      "username": "demo_bob",
      "name": "Bob Kumar",
      "avatarUrl": null,
      "amount": 400
    },
    {
      "userId": "378ba245-309f-497b-938a-8cfc74d924a6",
      "username": "demo_carol",
      "name": "Carol Singh",
      "avatarUrl": null,
      "amount": 400
    }
  ],
  "myShare": 400,
  "hasReceipt": true,
  "receiptContentType": "image/png",
  "canEdit": true,
  "createdAt": "2026-10-14T09:01:13.268Z",
  "updatedAt": "2026-10-14T09:01:15.368Z"
}
```

### 207. Download the receipt

`GET /groups/:groupId/expenses/:expenseId/receipt` 🔒

**Response 200 OK**

`(binary, 128 bytes) Content-Type: image/png; Content-Disposition: inline; filename="receipt-2026-10-11-1436786b.png"`

### 208. Receipt that is not an image or PDF

`PUT /groups/:groupId/expenses/:expenseId/receipt` 🔒

**Request** (multipart/form-data)

- `file`: bill.png (image/png, 29 bytes)

**Response 415 Unsupported Media Type**

```json
{
  "message": "Receipt must be a JPEG, PNG, WebP or HEIC photo, or a PDF",
  "error": "Unsupported Media Type",
  "statusCode": 415
}
```

### 209. Summary: totals, balances, who owes whom

`GET /groups/:groupId/expenses/summary` 🔒

**Response 200 OK**

```json
{
  "currency": "INR",
  "totalSpent": 5500.01,
  "expenseCount": 4,
  "byCategory": [
    {
      "category": "ACCOMMODATION",
      "total": 3000,
      "count": 1,
      "percent": 54.5
    },
    {
      "category": "FOOD",
      "total": 1300.01,
      "count": 2,
      "percent": 23.6
    },
    {
      "category": "FUEL",
      "total": 1200,
      "count": 1,
      "percent": 21.8
    }
  ],
  "members": [
    {
      "userId": "64135665-35b8-4956-861a-e99b87c09958",
      "username": "demo_alice",
      "name": "Alice Rider",
      "avatarUrl": "http://localhost:3000/users/64135665-35b8-4956-861a-e99b87c09958/avatar?v=c87a688c-e509-4399-ae6b-fb93cd28a665",
      "isMember": true,
      "paid": 2000,
      "share": 2000,
      "repaid": 0,
      "received": 0,
      "balance": 0
    },
    {
      "userId": "e8b0c791-0ecf-40ab-b2be-3c714a96f23e",
      "username": "demo_bob",
      "name": "Bob Kumar",
      "avatarUrl": null,
      "isMember": true,
      "paid": 500.01,
      "share": 1750.01,
      "repaid": 0,
      "received": 0,
      "balance": -1250
    },
    {
      "userId": "378ba245-309f-497b-938a-8cfc74d924a6",
      "username": "demo_carol",
      "name": "Carol Singh",
      "avatarUrl": null,
      "isMember": true,
      "paid": 3000,
      "share": 1750,
      "repaid": 0,
      "received": 0,
      "balance": 1250
    }
  ],
  "settleUp": [
    {
      "from": {
        "userId": "e8b0c791-0ecf-40ab-b2be-3c714a96f23e",
        "username": "demo_bob",
        "name": "Bob Kumar",
        "avatarUrl": null
      },
      "to": {
        "userId": "378ba245-309f-497b-938a-8cfc74d924a6",
        "username": "demo_carol",
        "name": "Carol Singh",
        "avatarUrl": null
      },
      "amount": 1250
    }
  ],
  "myBalance": -1250
}
```

### 210. Record a repayment

`POST /groups/:groupId/expenses/settlements` 🔒

**Request**
```json
{
  "toUserId": "378ba245-309f-497b-938a-8cfc74d924a6",
  "amount": 500,
  "date": "2026-10-14",
  "note": "UPI"
}
```

**Response 201 Created**

```json
{
  "id": "46dffd19-b4cb-4114-89ac-db7a66baaec0",
  "groupId": "e03e87cf-d598-4969-ba7a-3d8ac6ebefff",
  "from": {
    "userId": "e8b0c791-0ecf-40ab-b2be-3c714a96f23e",
    "username": "demo_bob",
    "name": "Bob Kumar",
    "avatarUrl": null
  },
  "to": {
    "userId": "378ba245-309f-497b-938a-8cfc74d924a6",
    "username": "demo_carol",
    "name": "Carol Singh",
    "avatarUrl": null
  },
  "amount": 500,
  "currency": "INR",
  "date": "2026-10-14",
  "note": "UPI",
  "createdBy": {
    "userId": "e8b0c791-0ecf-40ab-b2be-3c714a96f23e",
    "username": "demo_bob",
    "name": "Bob Kumar",
    "avatarUrl": null
  },
  "canDelete": true,
  "createdAt": "2026-10-14T09:01:16.103Z"
}
```

**Push sent to Carol**

```json
{
  "title": "Repayment recorded",
  "body": "Bob Kumar paid Carol Singh INR 500.00",
  "data": {
    "type": "EXPENSE_SETTLEMENT",
    "groupId": "e03e87cf-d598-4969-ba7a-3d8ac6ebefff",
    "settlementId": "46dffd19-b4cb-4114-89ac-db7a66baaec0"
  }
}
```

**Event `expense:settlement_recorded` received by Alice**

```json
{
  "groupId": "e03e87cf-d598-4969-ba7a-3d8ac6ebefff",
  "settlementId": "46dffd19-b4cb-4114-89ac-db7a66baaec0",
  "byUserId": "e8b0c791-0ecf-40ab-b2be-3c714a96f23e",
  "timestamp": "2026-10-14T09:01:16.116Z"
}
```

### 211. Repayments

`GET /groups/:groupId/expenses/settlements` 🔒

**Response 200 OK**

```json
[
  {
    "id": "46dffd19-b4cb-4114-89ac-db7a66baaec0",
    "groupId": "e03e87cf-d598-4969-ba7a-3d8ac6ebefff",
    "from": {
      "userId": "e8b0c791-0ecf-40ab-b2be-3c714a96f23e",
      "username": "demo_bob",
      "name": "Bob Kumar",
      "avatarUrl": null
    },
    "to": {
      "userId": "378ba245-309f-497b-938a-8cfc74d924a6",
      "username": "demo_carol",
      "name": "Carol Singh",
      "avatarUrl": null
    },
    "amount": 500,
    "currency": "INR",
    "date": "2026-10-14",
    "note": "UPI",
    "createdBy": {
      "userId": "e8b0c791-0ecf-40ab-b2be-3c714a96f23e",
      "username": "demo_bob",
      "name": "Bob Kumar",
      "avatarUrl": null
    },
    "canDelete": false,
    "createdAt": "2026-10-14T09:01:16.103Z"
  }
]
```

### 212. Record someone else's repayment (not admin)

`POST /groups/:groupId/expenses/settlements` 🔒

**Request**
```json
{
  "fromUserId": "64135665-35b8-4956-861a-e99b87c09958",
  "toUserId": "e8b0c791-0ecf-40ab-b2be-3c714a96f23e",
  "amount": 10
}
```

**Response 403 Forbidden**

```json
{
  "message": "You can only record repayments you made or received (admins can record any)",
  "error": "Forbidden",
  "statusCode": 403
}
```

### 213. Report as PDF

`GET /groups/:groupId/expenses/report` 🔒

**Response 200 OK**

`(binary, 2984 bytes) Content-Type: application/pdf; Content-Disposition: attachment; filename="ladakh-ride-2026-expenses-2026-10-14.pdf"`

### 214. Report as CSV

`GET /groups/:groupId/expenses/report?format=csv` 🔒

**Response 200 OK**

Header `Content-Type: text/csv; charset=utf-8`

```csv
Type,Date,Category,Description,Paid by,Amount,Currency,Split,Shares
EXPENSE,2026-10-11,FUEL,Diesel at Tandi,Alice Rider,1200.00,INR,EQUAL,Alice Rider: 400.00; Bob Kumar: 400.00; Carol Singh: 400.00
EXPENSE,2026-10-12,FOOD,Maggi + chai,Bob Kumar,100.01,INR,EQUAL,Bob Kumar: 50.01; Carol Singh: 50.00
EXPENSE,2026-10-12,ACCOMMODATION,Homestay in Jispa,Carol Singh,3000.00,INR,CUSTOM,Alice Rider: 1200.00; Bob Kumar: 900.00; Carol Singh: 900.00
EXPENSE,2026-10-13,FOOD,Dinner in Leh,Alice Rider: 800.00; Bob Kumar: 400.00,1200.00,INR,EQUAL,Alice Rider: 400.00; Bob Kumar: 400.00; Carol Singh: 400.00
REPAYMENT,2026-10-14,,UPI,Bob Kumar,500.00,INR,,To Carol Singh
```

### 215. Delete a repayment

`DELETE /groups/:groupId/expenses/settlements/:settlementId` 🔒

**Response 200 OK**

_(empty body)_

**Event `expense:settlement_deleted` received by Alice**

```json
{
  "groupId": "e03e87cf-d598-4969-ba7a-3d8ac6ebefff",
  "settlementId": "46dffd19-b4cb-4114-89ac-db7a66baaec0",
  "byUserId": "e8b0c791-0ecf-40ab-b2be-3c714a96f23e",
  "timestamp": "2026-10-14T09:01:17.106Z"
}
```

### 216. Delete an expense

`DELETE /groups/:groupId/expenses/:expenseId` 🔒

**Response 200 OK**

_(empty body)_

**Event `expense:deleted` received by Bob**

```json
{
  "groupId": "e03e87cf-d598-4969-ba7a-3d8ac6ebefff",
  "expenseId": "848eec71-d074-4a98-8ba1-b932312a8284",
  "byUserId": "64135665-35b8-4956-861a-e99b87c09958",
  "timestamp": "2026-10-14T09:01:17.275Z"
}
```

### 217. Change the currency once there are expenses

`PATCH /groups/:groupId` 🔒

**Request**
```json
{
  "currency": "USD"
}
```

**Response 409 Conflict**

```json
{
  "message": "The currency can't change once the group has expenses",
  "error": "Conflict",
  "statusCode": 409
}
```

## Offline bundle

### 218. Everything to keep the trip usable offline (lists shortened here)

`GET /groups/:groupId/offline-bundle` 🔒

**Response 200 OK**

Header `ETag: "MbOoYOb6Fm1wgNI3kRZufo4MK-8"`

```json
{
  "generatedAt": "2026-10-14T09:01:17.620Z",
  "group": {
    "id": "e03e87cf-d598-4969-ba7a-3d8ac6ebefff",
    "name": "Ladakh Ride 2026",
    "description": "Manali → Leh, 9 days",
    "tripStart": "2026-10-10T00:00:00.000Z",
    "tripEnd": "2026-10-19T00:00:00.000Z",
    "currency": "INR",
    "createdById": "64135665-35b8-4956-861a-e99b87c09958",
    "createdAt": "2026-10-14T08:58:02.317Z",
    "closedAt": null,
    "deleteAfter": null,
    "coverImageUrl": "http://localhost:3000/groups/e03e87cf-d598-4969-ba7a-3d8ac6ebefff/cover-image?v=b022cba5-3221-471c-b332-b37f20befbb9",
    "myRole": "VIEWER",
    "memberCount": 3
  },
  "members": [
    {
      "userId": "64135665-35b8-4956-861a-e99b87c09958",
      "username": "demo_alice",
      "name": "Alice Rider",
      "avatarUrl": "http://localhost:3000/users/64135665-35b8-4956-861a-e99b87c09958/avatar?v=c87a688c-e509-4399-ae6b-fb93cd28a665",
      "role": "ADMIN",
      "joinedAt": "2026-10-14T08:58:02.317Z"
    },
    "…2 more"
  ],
  "itinerary": {
    "id": "2998b6c6-0dab-47db-9a43-17a9005b9b37",
    "groupId": "e03e87cf-d598-4969-ba7a-3d8ac6ebefff",
    "status": "LOCKED",
    "version": 2,
    "basedOnVersion": 1,
    "revision": 1,
    "createdById": "64135665-35b8-4956-861a-e99b87c09958",
    "createdAt": "2026-10-14T08:58:18.556Z",
    "lockedAt": "2026-10-14T08:58:20.642Z",
    "waypoints": [
      {
        "id": "e2a09900-dbe4-4686-b83f-953562233289",
        "activityId": "ba9c2563-ed5b-46b6-b68b-77c3fcb8a229",
        "position": 1,
        "role": "START",
        "name": "Manali",
        "lat": 32.2432,
        "lng": 77.1892,
        "date": "2026-10-10",
        "outsideTripDates": false,
        "notes": "Meet at the bus stand, 6 am",
        "elevation": {
          "status": "OK",
          "meters": 1878,
          "oxygenPercentOfSeaLevel": 80,
          "effectiveOxygenPercent": 16.6,
          "zone": "HIGH"
        },
        "weather": {
          "status": "PAST_DATE",
          "fetchedAt": "2026-10-14T08:58:21.340Z"
        },
        "activity": {
          "status": "COMPLETED",
          "statusUpdatedAt": "2026-10-14T08:58:23.452Z",
          "statusUpdatedBy": {
            "userId": "64135665-35b8-4956-861a-e99b87c09958",
            "name": "Alice Rider"
          },
          "updateCount": 0
        }
      },
      "…3 more"
    ]
  },
  "draft": null,
  "activityUpdates": [
    {
      "id": "936ef3be-b1f2-47a1-8c36-fd1f32932615",
      "groupId": "e03e87cf-d598-4969-ba7a-3d8ac6ebefff",
      "activityId": "3fc88f43-f7bd-42fc-8678-45601f47401a",
      "author": {
        "userId": "64135665-35b8-4956-861a-e99b87c09958",
        "username": "demo_alice",
        "name": "Alice Rider",
        "avatarUrl": "http://localhost:3000/users/64135665-35b8-4956-861a-e99b87c09958/avatar?v=c87a688c-e509-4399-ae6b-fb93cd28a665"
      },
      "text": "Lunch at the dhaba near the bridge",
      "createdAt": "2026-10-14T08:58:23.981Z",
      "editedAt": null,
      "canEdit": false,
      "canDelete": false
    }
  ],
  "statuses": [
    {
      "userId": "64135665-35b8-4956-861a-e99b87c09958",
      "username": "demo_alice",
      "name": "Alice Rider",
      "avatarUrl": "http://localhost:3000/users/64135665-35b8-4956-861a-e99b87c09958/avatar?v=c87a688c-e509-4399-ae6b-fb93cd28a665",
      "role": "ADMIN",
      "status": {
        "status": "STOPPED",
        "note": "Tea break at Marhi",
        "updatedAt": "2026-10-14T08:58:25.635Z"
      }
    },
    "…2 more"
  ],
  "expenses": {
    "items": [
      {
        "id": "028cd456-3d6d-45fa-80d0-ee33fc41934c",
        "groupId": "e03e87cf-d598-4969-ba7a-3d8ac6ebefff",
        "amount": 3000,
        "currency": "INR",
        "category": "ACCOMMODATION",
        "date": "2026-10-12",
        "description": "Homestay in Jispa",
        "splitType": "CUSTOM",
        "paidBy": {
          "userId": "378ba245-309f-497b-938a-8cfc74d924a6",
          "username": "demo_carol",
          "name": "Carol Singh",
          "avatarUrl": null
        },
        "payments": [
          {
            "userId": "378ba245-309f-497b-938a-8cfc74d924a6",
            "username": "demo_carol",
            "name": "Carol Singh",
            "avatarUrl": null,
            "amount": 3000
          }
        ],
        "createdBy": {
          "userId": "64135665-35b8-4956-861a-e99b87c09958",
          "username": "demo_alice",
          "name": "Alice Rider",
          "avatarUrl": "http://localhost:3000/users/64135665-35b8-4956-861a-e99b87c09958/avatar?v=c87a688c-e509-4399-ae6b-fb93cd28a665"
        },
        "splits": [
          {
            "userId": "64135665-35b8-4956-861a-e99b87c09958",
            "username": "demo_alice",
            "name": "Alice Rider",
            "avatarUrl": "http://localhost:3000/users/64135665-35b8-4956-861a-e99b87c09958/avatar?v=c87a688c-e509-4399-ae6b-fb93cd28a665",
            "amount": 1200
          },
          "…2 more"
        ],
        "myShare": 900,
        "hasReceipt": false,
        "receiptContentType": null,
        "canEdit": false,
        "createdAt": "2026-10-14T09:01:13.644Z",
        "updatedAt": "2026-10-14T09:01:13.644Z"
      },
      "…2 more"
    ],
    "summary": {
      "currency": "INR",
      "totalSpent": 4300.01,
      "expenseCount": 3,
      "byCategory": [
        {
          "category": "ACCOMMODATION",
          "total": 3000,
          "count": 1,
          "percent": 69.8
        },
        "…2 more"
      ],
      "members": [
        {
          "userId": "64135665-35b8-4956-861a-e99b87c09958",
          "username": "demo_alice",
          "name": "Alice Rider",
          "avatarUrl": "http://localhost:3000/users/64135665-35b8-4956-861a-e99b87c09958/avatar?v=c87a688c-e509-4399-ae6b-fb93cd28a665",
          "isMember": true,
          "paid": 1200,
          "share": 1600,
          "repaid": 0,
          "received": 0,
          "balance": -400
        },
        "…2 more"
      ],
      "settleUp": [
        {
          "from": {
            "userId": "e8b0c791-0ecf-40ab-b2be-3c714a96f23e",
            "username": "demo_bob",
            "name": "Bob Kumar",
            "avatarUrl": null
          },
          "to": {
            "userId": "378ba245-309f-497b-938a-8cfc74d924a6",
            "username": "demo_carol",
            "name": "Carol Singh",
            "avatarUrl": null
          },
          "amount": 1250
        },
        "…1 more"
      ],
      "myBalance": -1250
    },
    "settlements": []
  },
  "chat": {
    "messages": [
      {
        "id": "70b198f5-0112-49f6-bcdf-6e80cbce9c99",
        "groupId": "e03e87cf-d598-4969-ba7a-3d8ac6ebefff",
        "type": "NORMAL",
        "kind": "TEXT",
        "category": null,
        "body": "Morning all! Leaving Manali at 6 sharp 🏍️",
        "clientMsgId": "7129e827-262e-4e73-a3ef-8a445745cd53",
        "sender": {
          "userId": "64135665-35b8-4956-861a-e99b87c09958",
          "username": "demo_alice",
          "name": "Alice Rider",
          "avatarUrl": "http://localhost:3000/users/64135665-35b8-4956-861a-e99b87c09958/avatar?v=c87a688c-e509-4399-ae6b-fb93cd28a665"
        },
        "location": null,
        "voice": null,
        "createdAt": "2026-10-14T09:01:06.700Z",
        "readByCount": 2
      },
      "…6 more"
    ],
    "olderMessages": false,
    "unread": {
      "unreadCount": 0,
      "lastReadMessageId": "befa82d9-760e-40d5-8fce-b2113a6f7888",
      "lastReadAt": "2026-10-14T09:01:10.639Z"
    }
  },
  "activeAlerts": []
}
```

### 219. Nothing changed since (If-None-Match)

`GET /groups/:groupId/offline-bundle` 🔒

**Header** `If-None-Match: "MbOoYOb6Fm1wgNI3kRZufo4MK-8"`

**Response 304 Not Modified**

Header `ETag: "MbOoYOb6Fm1wgNI3kRZufo4MK-8"`

_(empty body)_

## Feedback (beta)

### 220. Send feedback

`POST /feedback` 🔒

**Request**
```json
{
  "category": "BUG",
  "message": "The map froze when I opened the chat while sharing.",
  "rating": 3,
  "screen": "GroupMap",
  "groupId": "e03e87cf-d598-4969-ba7a-3d8ac6ebefff",
  "appVersion": "0.9.0 (42)",
  "platform": "ANDROID",
  "osVersion": "14",
  "deviceModel": "Pixel 7"
}
```

**Response 201 Created**

```json
{
  "id": "ece67d8b-835f-4cef-8ace-03560234890c",
  "category": "BUG",
  "message": "The map froze when I opened the chat while sharing.",
  "rating": 3,
  "screen": "GroupMap",
  "groupId": "e03e87cf-d598-4969-ba7a-3d8ac6ebefff",
  "status": "NEW",
  "opsNote": null,
  "hasScreenshot": false,
  "createdAt": "2026-10-14T09:01:17.964Z"
}
```

### 221. Attach a screenshot

`PUT /feedback/:feedbackId/screenshot` 🔒

**Request** (multipart/form-data)

- `file`: screen.png (image/png, 128 bytes)

**Response 200 OK**

```json
{
  "id": "ece67d8b-835f-4cef-8ace-03560234890c",
  "category": "BUG",
  "message": "The map froze when I opened the chat while sharing.",
  "rating": 3,
  "screen": "GroupMap",
  "groupId": "e03e87cf-d598-4969-ba7a-3d8ac6ebefff",
  "status": "NEW",
  "opsNote": null,
  "hasScreenshot": true,
  "createdAt": "2026-10-14T09:01:17.964Z"
}
```

### 222. My feedback

`GET /feedback/mine` 🔒

**Response 200 OK**

```json
[
  {
    "id": "ece67d8b-835f-4cef-8ace-03560234890c",
    "category": "BUG",
    "message": "The map froze when I opened the chat while sharing.",
    "rating": 3,
    "screen": "GroupMap",
    "groupId": "e03e87cf-d598-4969-ba7a-3d8ac6ebefff",
    "status": "NEW",
    "opsNote": null,
    "hasScreenshot": true,
    "createdAt": "2026-10-14T09:01:17.964Z"
  }
]
```

## Closing a trip

### 223. Close the trip (admin)

`POST /groups/:groupId/close` 🔒

**Response 200 OK**

```json
{
  "id": "e03e87cf-d598-4969-ba7a-3d8ac6ebefff",
  "name": "Ladakh Ride 2026",
  "description": "Manali → Leh, 9 days",
  "tripStart": "2026-10-10T00:00:00.000Z",
  "tripEnd": "2026-10-19T00:00:00.000Z",
  "currency": "INR",
  "createdById": "64135665-35b8-4956-861a-e99b87c09958",
  "createdAt": "2026-10-14T08:58:02.317Z",
  "closedAt": "2026-10-14T09:01:18.470Z",
  "deleteAfter": "2026-11-13T09:01:18.470Z",
  "coverImageUrl": "http://localhost:3000/groups/e03e87cf-d598-4969-ba7a-3d8ac6ebefff/cover-image?v=b022cba5-3221-471c-b332-b37f20befbb9",
  "myRole": "ADMIN",
  "memberCount": 3
}
```

**Push sent to Bob**

```json
{
  "title": "Ladakh Ride 2026: trip closed",
  "body": "Alice Rider closed this trip. It will be deleted on 13 Nov 2026. Download the expense report before then.",
  "data": {
    "type": "GROUP_CLOSED",
    "groupId": "e03e87cf-d598-4969-ba7a-3d8ac6ebefff",
    "deleteAfter": "2026-11-13T09:01:18.470Z"
  }
}
```

**Push sent to Carol**

```json
{
  "title": "Ladakh Ride 2026: trip closed",
  "body": "Alice Rider closed this trip. It will be deleted on 13 Nov 2026. Download the expense report before then.",
  "data": {
    "type": "GROUP_CLOSED",
    "groupId": "e03e87cf-d598-4969-ba7a-3d8ac6ebefff",
    "deleteAfter": "2026-11-13T09:01:18.470Z"
  }
}
```

### 224. Write to a closed trip

`POST /groups/:groupId/status` 🔒

**Request**
```json
{
  "status": "ARRIVED"
}
```

**Response 409 Conflict**

```json
{
  "message": "This trip is closed, so it's read-only. An admin can reopen it.",
  "error": "Conflict",
  "statusCode": 409
}
```

### 225. Chat in a closed trip

`emit chat:send` 🔌 (sent by Bob)

**Payload**
```json
{
  "groupId": "e03e87cf-d598-4969-ba7a-3d8ac6ebefff",
  "body": "hello?"
}
```

**Ack (reply)**

```json
{
  "ok": false,
  "error": {
    "status": 409,
    "message": "This trip is closed, so it's read-only. An admin can reopen it."
  }
}
```

### 226. Reopen the trip (admin)

`POST /groups/:groupId/reopen` 🔒

**Response 200 OK**

```json
{
  "id": "e03e87cf-d598-4969-ba7a-3d8ac6ebefff",
  "name": "Ladakh Ride 2026",
  "description": "Manali → Leh, 9 days",
  "tripStart": "2026-10-10T00:00:00.000Z",
  "tripEnd": "2026-10-19T00:00:00.000Z",
  "currency": "INR",
  "createdById": "64135665-35b8-4956-861a-e99b87c09958",
  "createdAt": "2026-10-14T08:58:02.317Z",
  "closedAt": null,
  "deleteAfter": null,
  "coverImageUrl": "http://localhost:3000/groups/e03e87cf-d598-4969-ba7a-3d8ac6ebefff/cover-image?v=b022cba5-3221-471c-b332-b37f20befbb9",
  "myRole": "ADMIN",
  "memberCount": 3
}
```

## Privacy — my data, delete my account

### 227. Download my data (lists shortened here)

`GET /auth/me/export` 🔒

**Response 200 OK**

```json
{
  "exportedAt": "2026-10-14T09:01:19.130Z",
  "profile": {
    "id": "e8b0c791-0ecf-40ab-b2be-3c714a96f23e",
    "username": "demo_bob",
    "name": "Bob Kumar",
    "email": "demo.bob@example.com",
    "phone": "+919812345612",
    "avatarUrl": null,
    "emailVerified": true,
    "phoneVerified": true,
    "createdAt": "2026-10-14T08:57:59.240Z",
    "lastSeenAt": null
  },
  "groups": [
    {
      "groupId": "e03e87cf-d598-4969-ba7a-3d8ac6ebefff",
      "name": "Ladakh Ride 2026",
      "role": "VIEWER",
      "joinedAt": "2026-10-14T08:58:03.527Z"
    }
  ],
  "messages": [
    {
      "id": "cba0b525-b7e5-442d-b18d-698b6a40207b",
      "groupId": "e03e87cf-d598-4969-ba7a-3d8ac6ebefff",
      "type": "NORMAL",
      "kind": "TEXT",
      "category": null,
      "body": "On my way 👍",
      "location": null,
      "voiceDurationMs": null,
      "createdAt": "2026-10-14T09:01:07.770Z"
    },
    "…2 more"
  ],
  "activityUpdates": [],
  "statusUpdates": [
    {
      "groupId": "e03e87cf-d598-4969-ba7a-3d8ac6ebefff",
      "status": "IN_TRANSIT",
      "note": null,
      "createdAt": "2026-10-14T08:58:25.463Z"
    }
  ],
  "expensesPaid": [
    {
      "id": "346c44f0-8d98-4dbb-affb-c192fecd5095",
      "groupId": "e03e87cf-d598-4969-ba7a-3d8ac6ebefff",
      "amount": 100.01,
      "paidAmount": 100.01,
      "category": "FOOD",
      "date": "2026-10-12",
      "description": "Maggi + chai",
      "hasReceipt": false,
      "createdAt": "2026-10-14T09:01:13.468Z"
    }
  ],
  "expensesRecorded": [
    "346c44f0-8d98-4dbb-affb-c192fecd5095"
  ],
  "expenseShares": [
    {
      "expenseId": "346c44f0-8d98-4dbb-affb-c192fecd5095",
      "groupId": "e03e87cf-d598-4969-ba7a-3d8ac6ebefff",
      "amount": 50.01
    },
    "…2 more"
  ],
  "repayments": [],
  "invitesSent": [],
  "invitesReceived": [],
  "devices": [],
  "locationSharing": [],
  "liveLocationLinks": [],
  "feedback": [
    {
      "category": "BUG",
      "message": "The map froze when I opened the chat while sharing.",
      "rating": 3,
      "status": "NEW",
      "createdAt": "2026-10-14T09:01:17.964Z"
    }
  ],
  "notes": [
    "Live location positions are never stored: only your latest position is kept while you share, and removed when sharing ends.",
    "…1 more"
  ]
}
```

### 228. Delete my account with a wrong password

`DELETE /auth/me` 🔒

**Request**
```json
{
  "password": "Wr0ng!Pass"
}
```

**Response 401 Unauthorized**

```json
{
  "message": "Wrong password",
  "error": "Unauthorized",
  "statusCode": 401
}
```

### 229. Delete my account

`DELETE /auth/me` 🔒

**Request**
```json
{
  "password": "Str0ng!Pass"
}
```

**Response 200 OK**

_(empty body)_

**Event `member:removed` received by Alice**

```json
{
  "groupId": "e03e87cf-d598-4969-ba7a-3d8ac6ebefff",
  "userId": "378ba245-309f-497b-938a-8cfc74d924a6",
  "removedBy": "378ba245-309f-497b-938a-8cfc74d924a6",
  "left": true,
  "timestamp": "2026-10-14T09:01:19.639Z"
}
```

### 230. Log in after deleting the account

`POST /auth/login`

**Request**
```json
{
  "identifier": "demo.carol@example.com",
  "password": "Str0ng!Pass"
}
```

**Response 401 Unauthorized**

```json
{
  "message": "Invalid credentials",
  "error": "Unauthorized",
  "statusCode": 401
}
```

## Auth — OTP login, password reset, logout

### 231. Request a login OTP (SMS)

`POST /auth/otp/request`

**Request**
```json
{
  "phone": "+919812345612"
}
```

**Response 201 Created**

```json
{
  "message": "If that phone number is registered, a code has been sent"
}
```

### 232. Log in with a wrong OTP

`POST /auth/otp/login`

**Request**
```json
{
  "phone": "+919812345612",
  "code": "000000"
}
```

**Response 400 Bad Request**

```json
{
  "message": "Invalid or expired code",
  "error": "Bad Request",
  "statusCode": 400
}
```

### 233. Log in with OTP

`POST /auth/otp/login`

**Request**
```json
{
  "phone": "+919812345612",
  "code": "977191"
}
```

**Response 201 Created**

```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5…(JWT, shortened)",
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5…(JWT, shortened)"
}
```

### 234. Forgot password

`POST /auth/forgot-password`

**Request**
```json
{
  "email": "demo.alice@example.com"
}
```

**Response 201 Created**

```json
{
  "message": "If that account exists, a reset code has been sent"
}
```

### 235. Reset with a weak new password

`POST /auth/reset-password`

**Request**
```json
{
  "email": "demo.alice@example.com",
  "code": "246466",
  "newPassword": "weak"
}
```

**Response 400 Bad Request**

```json
{
  "message": [
    "Password must be 8–72 characters with at least one uppercase letter, one lowercase letter, one number and one symbol"
  ],
  "error": "Bad Request",
  "statusCode": 400
}
```

### 236. Reset password

`POST /auth/reset-password`

**Request**
```json
{
  "email": "demo.alice@example.com",
  "code": "246466",
  "newPassword": "N3w!Passw0rd"
}
```

**Response 201 Created**

```json
{
  "message": "Password updated"
}
```

### 237. Log in with the new password

`POST /auth/login`

**Request**
```json
{
  "identifier": "demo.alice@example.com",
  "password": "N3w!Passw0rd"
}
```

**Response 201 Created**

```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5…(JWT, shortened)",
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5…(JWT, shortened)"
}
```

### 238. Unregister the device (before logout)

`DELETE /devices` 🔒

**Request**
```json
{
  "token": "fcm-token-alice-pixel-7"
}
```

**Response 200 OK**

_(empty body)_

### 239. Log out

`POST /auth/logout` 🔒

**Response 201 Created**

_(empty body)_

## Presence — going offline

### 240. Bob closes the app (5 s later)

`on presence:updated` 🔌 (received by Alice)

```json
{
  "userId": "e8b0c791-0ecf-40ab-b2be-3c714a96f23e",
  "online": false,
  "lastSeenAt": "2026-10-14T09:01:26.835Z"
}
```

### 241. Who's online after Bob left

`GET /groups/:groupId/presence` 🔒

**Response 200 OK**

```json
[
  {
    "userId": "64135665-35b8-4956-861a-e99b87c09958",
    "username": "demo_alice",
    "name": "Alice Rider",
    "avatarUrl": "http://localhost:3000/users/64135665-35b8-4956-861a-e99b87c09958/avatar?v=c87a688c-e509-4399-ae6b-fb93cd28a665",
    "online": true,
    "lastSeenAt": null
  },
  {
    "userId": "e8b0c791-0ecf-40ab-b2be-3c714a96f23e",
    "username": "demo_bob",
    "name": "Bob Kumar",
    "avatarUrl": null,
    "online": false,
    "lastSeenAt": "2026-10-14T09:01:26.835Z"
  }
]
```

## Cleanup — delete the group

### 242. Viewer tries to delete the group

`DELETE /groups/:groupId` 🔒

**Response 403 Forbidden**

```json
{
  "message": "Requires group role: ADMIN",
  "error": "Forbidden",
  "statusCode": 403
}
```

### 243. Delete the group (admin)

`DELETE /groups/:groupId` 🔒

**Response 200 OK**

_(empty body)_

### 244. Get a deleted group

`GET /groups/:groupId` 🔒

**Response 404 Not Found**

```json
{
  "message": "Group not found",
  "error": "Not Found",
  "statusCode": 404
}
```
