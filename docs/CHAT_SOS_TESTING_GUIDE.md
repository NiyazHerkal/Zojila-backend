# Postman testing guide: chat, alerts & SOS, presence

How to test Phase 8 by hand with Postman (v10+, which supports Socket.IO). The full API contract is in `../API_DOCUMENTATION.md` §13–16; the automated version of these checks is `test/chat.e2e-spec.ts` (`npm run test:e2e`).

**Chat goes over the socket. Alerts and SOS go over HTTP.**

---

## 1. Setup

- **Server:** `npm run start:dev` in `backend/`, base URL `http://localhost:3000` (or the ngrok URL).
- **Two users in one group**, both verified. The quickest way is the first sections of `../api-requests.http` (signup → verify → create group → add member). Signup codes are printed in the server terminal as `[DEV OTP] …`.
- **Postman variables:**

| Variable | Value |
|---|---|
| `baseUrl` | `http://localhost:3000` |
| `aliceToken` | Alice's `accessToken` (admin) |
| `bobToken` | Bob's `accessToken` (viewer) |
| `groupId` | the group's `id` |

Access tokens last ~15 minutes. When a socket gets `session:expired` or HTTP returns `401`, log in again and update the variable.

---

## 2. Connect two sockets

Open **two Socket.IO requests** in Postman (New → Socket.IO): one for Alice, one for Bob.

1. **URL:** `{{baseUrl}}`
2. **Settings → Handshake / Auth:** add `token` = `{{aliceToken}}` (Bob's tab: `{{bobToken}}`). Alternatively, add a header `Authorization: Bearer {{aliceToken}}`.
3. **Events tab**, listen to: `ready`, `chat:message`, `chat:typing`, `chat:read`, `alert:raised`, `alert:acknowledged`, `alert:resolved`, `presence:updated`, `session:expired`.
4. **Connect.** Expected: `ready` → `{ "userId": "…" }`.

There's **no separate "register" step** (unlike nestbeacon): the token in the handshake is the login. A bad or missing token fails with `connect_error: Unauthorized`.

When sending events below, **turn on "Acknowledgement"** in Postman's message settings. The server's reply arrives as the ack.

---

## 3. Presence

1. With both tabs connected: `GET {{baseUrl}}/groups/{{groupId}}/presence` (Bob's token) → both `online: true`.
2. **Disconnect Bob's tab.** About 5 s later, Alice's tab gets `presence:updated` → `{ "userId": "<bob>", "online": false, "lastSeenAt": "…" }`.
3. **Reconnect Bob.** Alice gets `presence:updated` with `online: true`.
4. **Reconnect quickly** (disconnect + connect within 5 s): Alice gets **nothing**. That's the grace period, so token refreshes don't flash "offline".

---

## 4. Chat

### 4.1 Send a message (Bob's tab)
Event `chat:send`, ack on:
```json
{ "groupId": "{{groupId}}", "body": "Reached Kaza, fuel up here", "clientMsgId": "bob-001" }
```
- **Ack in Bob's tab:** `{ "ok": true, "data": { "id": "…", "type": "NORMAL", "body": "Reached Kaza, fuel up here", "clientMsgId": "bob-001", "sender": { … }, "readByCount": 0, … } }`
- **Alice's tab:** `chat:message` with the same object. Bob's tab gets it too (for his other devices).

### 4.2 Resend with the same `clientMsgId`
Send exactly the same payload again. The ack has the **same `id`**, and Alice gets **no** second `chat:message`.

### 4.3 Typing
Bob sends `chat:typing` → `{ "groupId": "{{groupId}}", "isTyping": true }`.
Alice gets `chat:typing` → `{ "groupId": "…", "userId": "<bob>", "name": "…", "isTyping": true }`. Bob gets nothing.

### 4.4 Read receipts
1. Alice sends `chat:read` → `{ "groupId": "{{groupId}}", "messageId": "<id from 4.1>" }`.
   - **Ack:** `{ "ok": true, "data": { "unreadCount": 0, "lastReadMessageId": "…", "lastReadAt": "…" } }`
   - **Bob's tab:** `chat:read` → `{ "userId": "<alice>", "lastReadMessageId": "…" }`
2. `GET {{baseUrl}}/groups/{{groupId}}/messages/<id>/reads` → Alice in `readBy`.
3. `GET {{baseUrl}}/groups/{{groupId}}/messages` → the message now has `readByCount: 1`.

### 4.5 History, paging, search (HTTP)
- `GET {{baseUrl}}/groups/{{groupId}}/messages?limit=2`: the newest 2 messages, oldest first, plus `nextBefore`.
- `GET …/messages?limit=2&before=<nextBefore>`: the 2 before those.
- `GET …/messages?search=kaza`: case-insensitive text search.
- `GET …/messages/unread`: the unread count for badges.

### 4.6 Push to offline members
Disconnect Bob, wait 5 s, then send a message as Alice. The server terminal shows `[DEV PUSH] to 1 user(s) …: <group name> — <Alice>: <text>`, but **only if Bob has registered a device** (`POST /devices`). Online members get no chat push.

---

## 5. Alerts & SOS (HTTP)

| # | Request | Expect |
|---|---|---|
| 1 | `POST …/alerts` as **Bob** `{ "type": "CRITICAL", "category": "WEATHER", "body": "Snow" }` | `403` (admins only) |
| 2 | `POST …/alerts` as Alice `{ "type": "CRITICAL", "body": "Snow" }` | `400` (category required) |
| 3 | `POST …/alerts` as Alice `{ "type": "CRITICAL", "category": "ROAD_CLOSURE", "body": "Kunzum La closed" }` | `201`; Bob's tab gets `alert:raised` **and** `chat:message` |
| 4 | `POST …/alerts/sos` as Bob `{ "body": "Ankle hurt", "lat": 32.437, "lng": 77.749 }` | `201`, `location.source: "DEVICE"`, `alert.active: true`; Alice gets `alert:raised` |
| 5 | Same SOS request again | `201` with the **same id** (one active SOS per member) |
| 6 | `POST …/alerts/sos` as Bob `{ "lat": 32.4 }` | `400` (lat and lng go together) |
| 7 | `GET …/alerts?active=true` | the SOS and the CRITICAL alert, newest first |
| 8 | `POST …/alerts/<sosId>/ack` as **Bob** | `400` (own alert) |
| 9 | `POST …/alerts/<sosId>/ack` as Alice | `200`, `acknowledgedByMe: true`; Bob gets `alert:acknowledged`; the terminal shows the push "… saw your SOS" |
| 10 | `GET …/alerts/<sosId>` | Alice in `acknowledgements`, the rest in `pending` |
| 11 | `POST …/alerts/<criticalId>/resolve` as **Bob** | `403` (admins only) |
| 12 | `POST …/alerts/<sosId>/resolve` as Bob | `200`, `active: false`; Alice gets `alert:resolved` |
| 13 | `POST …/alerts/<criticalId>/resolve` as Alice | `200` |
| 14 | `GET …/alerts?active=true` | empty |

**SOS location without coordinates:** send `{}`. If Bob is sharing live location with the group (needs Redis), `location.source` is `LIVE_SHARE`; otherwise `location` is `null`.

---

## 6. Security and edge cases

| # | Case | How | Expected |
|---|---|---|---|
| 1 | No / bad token on the socket | Connect without `token` | `connect_error: Unauthorized` |
| 2 | Non-member sends | Connect a third user, `chat:send` to the group | ack `{ ok: false, error: { status: 404, message: "Group not found" } }` |
| 3 | Non-member reads history | `GET …/messages` with that user's token | `404` |
| 4 | Non-member marks read | `chat:read` from the third user | ack `status: 404` |
| 5 | Empty / blank message | `chat:send` with `"body": "   "` | ack `status: 400`, `"body is required"` |
| 6 | Too long | `chat:send` with 2001+ characters | ack `status: 400`, `"body must be at most 2000 characters"` |
| 7 | Payload isn't an object | `chat:send` with a plain string | ack `status: 400` |
| 8 | Removed member | Alice removes Bob (`DELETE …/members/<bob>`) | Bob stops getting `chat:message` at once; his `chat:send` → `404` |
| 9 | Unknown alert | `GET …/alerts/<random uuid>` | `404` |
| 10 | Chat message used as an alert | `POST …/alerts/<normal message id>/ack` | `404` |

These close the three gaps found in the nestbeacon reference: history over the socket without an access check, marking read without a thread check, and presence broadcast to every connected client.
