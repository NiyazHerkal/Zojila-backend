# Google & Apple Sign-In: API Contract (draft)

**For:** the TravelGo mobile app (Flutter), plus the setup checklist for whoever owns the Google and Apple developer accounts
**Status:** draft 0.2, 2026-10-16 (0.2: safer email matching, rule 2 in §1). **Not built yet.** The endpoints below don't exist on the dev server until this doc says "built". The request and response shapes are fixed, so the app can be built against them now.
**Scope:** a scope change. The Implementation Plan §2.1 only covers email/phone with a password or OTP.

Once built, this moves into `API_DOCUMENTATION.md` §5 as version 1.4.0. **Nothing breaking:** there are 2 new sign-in endpoints, 3 optional "connected accounts" endpoints, 2 new fields on the profile, and one new way to confirm account deletion.

---

## 1. How it works

```
App: native Google / Apple sheet → gets an ID token from Google / Apple
App: POST /auth/google or /auth/apple with that token
API: checks the token with Google / Apple → finds or creates the TravelGo account
API: returns the usual { accessToken, refreshToken } (+ isNewUser)
App: carries on exactly as after POST /auth/login (refresh, logout, sockets: all unchanged)
```

- **The app never sends a Google/Apple access token or password to us.** It sends only the signed **ID token**, which the backend checks against Google's/Apple's public keys and our client IDs.
- **Same session rules as password login** (§2 "Tokens"): one active session per user, single-use refresh tokens, and `rememberMe` gives 90 days instead of 30.
- **No verification step.** Google and Apple have already confirmed the email, so the account is active straight away. There's no `/auth/verify`.

### Which account does a sign-in land in?

The backend checks these in order:

1. **This Google/Apple account has signed in before:** you get the same TravelGo account. This still works if the user later changes the email on their Google/Apple account.
2. **A TravelGo account already has the same email, and that account has verified it** (and Google/Apple says the email is verified): the Google/Apple login is **linked to that account** and you're signed in. `isNewUser: false`.
   - If that account **never verified the email**, it is **not** linked. The backend takes the unproven email off that account and goes on to rule 3. This blocks a "pre-registration" takeover, where someone signs up with another person's email (and, for example, their own phone) and waits for the real owner to sign in with Google. The old account keeps any phone it has verified.
3. **Otherwise a new account is created:** `isNewUser: true`. The email comes from Google/Apple, the name from Google, or from the Apple sheet the first time. The username is generated automatically (see below). There's no password.

> **Phone-only accounts aren't matched.** Google/Apple give us an email, not a phone number. A user who signed up with only a phone gets a second, separate account. To avoid that, they log in with their phone first, then connect Google/Apple in settings (§4).

### New accounts: username and name

- **Username:** made from the name or the email, following the normal username rules (§2 "Input rules"), e.g. `jordan_rivera`. If it's taken, 4 digits are added: `jordan_rivera4821`. A name with no Latin letters or digits (e.g. Devanagari) falls back to `user4821`.
- **When `isNewUser: true`**, the app can show a "Choose your username" screen pre-filled from `GET /auth/me`, with live checks against `GET /auth/username-available`, then save it with `PATCH /auth/me`. This screen is **optional**: the account works with the generated username.
- **Name:** Google gives the full name. **Apple gives the name only the first time** a user signs in to the app, and only to the app, not in the token. So always send `givenName`/`familyName` from the Apple credential when they're there. If there's no name at all, the backend uses the part of the email before the `@`, and then `"TravelGo user"`.
- **Photo:** for a new Google account, `avatarUrl` is set to the Google profile picture URL (an external URL, as if sent with `PATCH /auth/me`). Apple doesn't provide a photo.

---

## 2. `POST /auth/google`

Signs in, or signs up, with Google.

**Request**
```json
{ "idToken": "eyJhbGciOiJSUzI1NiIs…", "rememberMe": true }
```

| Field | Required | Notes |
|---|---|---|
| `idToken` | yes | The **ID token** from `google_sign_in`, not the access token or the server auth code. Its audience must be one of our client IDs. **On Android it's only issued when the Web client ID is passed as `serverClientId`** (§6) |
| `rememberMe` | no | Same as on `/auth/login`. Default `false` |

**Response 201**
```json
{ "accessToken": "eyJ…", "refreshToken": "eyJ…", "isNewUser": true }
```

**Errors**
- `400` validation: `idToken` is missing or not a string.
- `401` "Invalid Google token": bad signature, wrong audience or issuer, or expired. Tokens last about 1 hour; get a fresh one from `google_sign_in` and try again.
- `409` "An account with this email already exists. Log in with your password, then connect Google in settings." This only happens when Google says the email is **not** verified, which is rare.
- `429` rate limit: 20 per minute, the same as `/auth/login`.
- `503` "Google sign-in isn't set up on this server yet": the backend has no Google client IDs configured yet. The app should show a normal "Couldn't sign in, try again later".

---

## 3. `POST /auth/apple`

Signs in, or signs up, with Apple. **iOS only** (see §6 "Platforms").

**Request**
```json
{
  "identityToken": "eyJraWQiOiJXNldjT0tC…",
  "authorizationCode": "c1a2b3…",
  "rawNonce": "kq9F2xY7…",
  "givenName": "Jordan",
  "familyName": "Rivera",
  "rememberMe": true
}
```

| Field | Required | Notes |
|---|---|---|
| `identityToken` | yes | `credential.identityToken` from `sign_in_with_apple` |
| `authorizationCode` | yes | `credential.authorizationCode`. It's single-use and lasts 5 minutes, so send it straight away. The backend exchanges it with Apple once per user, so that **deleting the account can revoke the Apple sign-in, which App Store review requires** |
| `rawNonce` | yes | A random string (32+ characters) the app makes for each attempt. Pass **`sha256(rawNonce)`** to Apple as `nonce`, and the **raw** value here. This stops a stolen token from being replayed |
| `givenName`, `familyName` | no | `credential.givenName` / `familyName`. Apple only fills these in on the user's **first** sign-in, so send them whenever they aren't null. Each up to 100 characters |
| `rememberMe` | no | Default `false` |

**Response 201**
```json
{ "accessToken": "eyJ…", "refreshToken": "eyJ…", "isNewUser": false }
```

**Errors**
- `400` validation: a required field is missing, or a name is too long.
- `401` "Invalid Apple token": bad signature, wrong audience or issuer, expired, or the nonce doesn't match.
- `401` "Invalid Apple authorization code": Apple rejected the code because it was used already or more than 5 minutes passed. Start the Apple sign-in again.
- `429` rate limit: 20 per minute.
- `503` "Apple sign-in isn't set up on this server yet".

**No email at all:** if the user doesn't share an email on the Apple sheet, the account is created with `email: null`. It works, but it can't set a password and won't get email invites. The app should always request the `email` scope.

**"Hide My Email":** if the user hides their email, Apple gives us an address like `x7k2…@privaterelay.appleid.com`. Treat it as a normal email. Our emails (invites, codes) reach the user through Apple's relay once the sender is registered with Apple (§6). A hidden-email account won't match an existing TravelGo account (rule 2 in §1), so users who already have an account should log in first, then connect Apple in settings.

---

## 4. Connected accounts (optional screen)

For a "Sign-in methods" section in settings. The app can skip this whole section in the first release. All three endpoints are 🔒.

### Profile fields: `GET /auth/me` and every response that returns the profile
Two new fields:
```json
{
  "id": "3f1c…",
  "username": "jordan_r",
  "email": "jordan@example.com",
  "…": "…",
  "hasPassword": false,
  "linkedProviders": ["GOOGLE", "APPLE"]
}
```
- `hasPassword`: `false` for accounts created with Google/Apple until the user sets a password with "Forgot password" (it works for them: the code goes to their email, Apple relay addresses included).
- `linkedProviders`: `[]`, `["GOOGLE"]`, `["APPLE"]` or `["GOOGLE", "APPLE"]`.

### `POST /auth/me/providers/google` 🔒
Connects Google to the logged-in account. Body: the same as `POST /auth/google`, without `rememberMe`.
**Response 200**: the profile, with `"GOOGLE"` in `linkedProviders`.

### `POST /auth/me/providers/apple` 🔒
Connects Apple. Body: the same as `POST /auth/apple`, without `rememberMe`. The names are ignored.
**Response 200**: the profile.

Errors for both: `401` invalid token (as above), and `409` "This Google account is already used by another TravelGo account" or "This Apple ID is already used by another TravelGo account". Connecting the same provider again with the same Google/Apple account returns `200`; connecting a different Google/Apple account replaces the old one.

Connecting **doesn't change the account's email**, even when the Google/Apple email is different.

### `DELETE /auth/me/providers/:provider` 🔒
`:provider` is `google` or `apple`. Disconnects it. For Apple, the backend also revokes the sign-in with Apple.
**Response 200**: the profile.

Errors: `404` "Not connected", `409` "Set a password or connect another sign-in method first". You can't remove the **only** way to sign in. A verified phone will count as a way in (through phone OTP) once SMS codes are really sent. Until then it doesn't count, because SMS codes are only printed on the server.

---

## 5. Changes to existing endpoints

| Endpoint | Change |
|---|---|
| `GET /auth/me`, `PATCH /auth/me`, avatar endpoints | New fields `hasPassword`, `linkedProviders` (§4) |
| `POST /auth/login` | An account with no password always gets `401` "Invalid credentials", the same as a wrong password, so the response doesn't reveal how the account signs in. The app can offer "Continue with Google/Apple" on that screen |
| `POST /auth/forgot-password` → `reset-password` | Unchanged. For a Google/Apple account with no password, this **sets** a password (`hasPassword` becomes `true`) |
| **`DELETE /auth/me`** | Accounts **with** a password: unchanged (`{ "password": "…" }`). Accounts **without** one confirm with a fresh Google/Apple sign-in instead: `{ "provider": "GOOGLE", "idToken": "…" }` or `{ "provider": "APPLE", "identityToken": "…", "rawNonce": "…" }`. The token must belong to a provider **connected to this account**, else `401` "Sign-in doesn't match this account". Sending `password` to an account without one gives `400` "This account has no password. Confirm with Google or Apple." Deleting also revokes Apple sign-in and disconnects Google/Apple, so signing in again later creates a fresh account |
| `GET /auth/me/export` | `profile` gains `linkedProviders`, and there's a new `signInMethods` list, e.g. `[{ "provider": "GOOGLE", "email": "jordan@gmail.com", "connectedAt": "…" }]` |

---

## 6. Setup checklist

Nothing below is code. These are accounts and settings in Google Cloud and Apple Developer. **Send the values in the right-hand column to the backend developer**, not in a group chat: the Apple `.p8` key is a secret.

### Google (Google Cloud Console → APIs & Services, in the **same project as Firebase**)

| # | Step | Gives us |
|---|---|---|
| G1 | **OAuth consent screen / Google Auth Platform → Branding**: app name "TravelGo", support email, logo, privacy policy URL, terms URL, authorised domain. Scopes: `openid`, `email`, `profile` only. Set the audience to **External**, publishing status **In production** (in "Testing", only listed test users can sign in) | – |
| G2 | **Web application** client ID. It's not for a website: it's the "server client ID" that Android needs to get an ID token, and the audience the backend checks | `GOOGLE_WEB_CLIENT_ID` (`….apps.googleusercontent.com`) |
| G3 | **Android** client ID, with the app's package name + **SHA-1** fingerprint. Make one for **each signing key**: the debug keystore (each developer machine), the upload key, and the **Play App Signing** key (Play Console → App integrity). A missing SHA-1 shows up as a `DEVELOPER_ERROR` / error 10 in the app | Nothing for the backend; the app uses the Web client ID |
| G4 | **iOS** client ID, with the bundle ID | `GOOGLE_IOS_CLIENT_ID`, plus the *reversed client ID* for the app's `Info.plist` URL scheme |

Backend `.env`: `GOOGLE_CLIENT_IDS=<web client id>,<ios client id>` (the audiences we accept).

### Apple (developer.apple.com → Certificates, Identifiers & Profiles; needs the paid **Apple Developer Program**, organisation account)

| # | Step | Gives us |
|---|---|---|
| A1 | **Team ID**: top right of the developer portal / Membership page | `APPLE_TEAM_ID` (10 characters) |
| A2 | **Identifiers → App ID** for the app's bundle ID: tick **Sign in with Apple** (as primary App ID). Then turn on the same capability in Xcode (Runner → Signing & Capabilities) | `APPLE_BUNDLE_ID` (the token audience) |
| A3 | **Keys → +**: tick **Sign in with Apple**, configure it with the App ID from A2, then download the **`.p8` file. It can only be downloaded once**, so store it safely | `APPLE_KEY_ID` + the `.p8` file (saved on the server as `secrets/apple-signin-key.p8`) |
| A4 | **Services → Sign in with Apple for Email Communication**: register our sending domain and the sender address used with Brevo (the one in `EMAIL_FROM`), and pass the SPF check. **Without this, our emails to "Hide My Email" users are silently dropped** | – |
| A5 | *(Later, optional)* Server-to-server notification URL, e.g. `https://<api host>/auth/apple/notifications`, so Apple can tell us when a user stops using Apple ID with the app. It needs a public HTTPS host, so wait until hosting exists | – |

A **Services ID** is only needed for Sign in with Apple on Android or the web. We don't do that (see below), so skip it.

### Platforms

| | Android | iOS |
|---|---|---|
| Continue with Google | ✅ | ✅ |
| Sign in with Apple | ❌ (hide the button) | ✅ **required** |

**App Store rule (guideline 4.8):** an iOS app that offers Google login must also offer an equivalent privacy-focused login. Sign in with Apple meets that rule. **Ship Google on iOS only together with Apple.** Showing Apple on Android would need a Services ID and a web redirect, and it's rarely worth it.

### App notes (Flutter)

- **Google:** `google_sign_in`. Pass the **Web client ID** as `serverClientId` (Android), and set the iOS client ID (`GIDClientID`) and the reversed-client-ID URL scheme in `Info.plist`. Send `idToken` to `POST /auth/google`. If `idToken` is null on Android, `serverClientId` is missing or wrong.
- **Apple:** `sign_in_with_apple`. Request the scopes `email` and `fullName`, and generate `rawNonce` with a secure random generator (e.g. `Random.secure()`); pass `sha256(rawNonce)` as `nonce`. Send `identityToken`, `authorizationCode`, `rawNonce`, `givenName` and `familyName`.
- **Cancelling** the Google/Apple sheet is not an error: don't call the API, and stay on the login screen.
- **After sign-in**, store the tokens as after `/auth/login` (§3.1), register the FCM device (`POST /devices`), and then, if `isNewUser`, optionally show the "Choose your username" screen.
- **Logout:** call `POST /auth/logout` as usual. Signing out of Google too (`GoogleSignIn.signOut()`) lets the next login pick a different Google account.
- **Until the client IDs are on the backend**, these endpoints return `503`. The UI and native setup can be built and tested up to the point where the app gets a token.

---

## 7. Backend implementation notes (for the backend)

- New table `user_identities`: `id`, `user_id` → users, `provider` (`GOOGLE` | `APPLE`), `subject` (the token's `sub`), `email` (as given at link time), `apple_refresh_token` (encrypted, for revocation), `created_at`. Unique on (`provider`, `subject`) and on (`user_id`, `provider`).
- `users.password_hash` becomes nullable. `hasPassword` = it's not null. bcrypt is skipped for null hashes, so `/auth/login` still answers in constant time.
- Token checks: Google with `google-auth-library` `verifyIdToken` (audience = `GOOGLE_CLIENT_IDS`, `email_verified` honoured). Apple with JWKS from `https://appleid.apple.com/auth/keys`: issuer `https://appleid.apple.com`, audience `APPLE_BUNDLE_ID`, `nonce` = sha256(`rawNonce`). The code exchange and revoke calls (`/auth/token`, `/auth/revoke`) use a client secret JWT signed with the `.p8` key (ES256, `kid` = `APPLE_KEY_ID`, `iss` = `APPLE_TEAM_ID`).
- Account deletion (`AccountService.delete`): revoke Apple, delete `user_identities` rows, then anonymise as today.
- Rate limits: `/auth/google` and `/auth/apple` at 20 per minute; the `/auth/me/providers/*` endpoints at 30.
