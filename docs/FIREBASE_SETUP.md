# Firebase push notifications: setup

The backend sends push notifications through **Firebase Cloud Messaging (FCM)**. Today this is only the "your live location sharing has ended" alert; chat and SOS alerts come in Phase 8. FCM delivers to Android directly and to iPhones through Apple's push service (APNs).

**Until this is set up, nothing breaks.** The server prints a `[DEV PUSH] …` line in its terminal instead of sending, and everything else works as normal.

---

## What the backend needs: one file

A **service account key**. It's a JSON file that Firebase generates for you.

> ⚠️ The old FCM "server key" (a long string starting `AAAA…`) **no longer works**: Google shut that API down in 2024. If Firebase shows a "Cloud Messaging API (Legacy)" option, ignore it. You need the **service account JSON** described below.

---

## Step 1: Create (or open) the Firebase project

1. Go to <https://console.firebase.google.com> and sign in with the company Google account.
2. Click **Add project** (or open the existing TravelGo project, if the frontend team already made one; **use the same project as the Flutter app**).
3. Name it, e.g. `travelgo`. Google Analytics is optional.

## Step 2: Generate the service account key

1. In the project, click the ⚙️ gear next to **Project Overview** → **Project settings**.
2. Open the **Service accounts** tab.
3. Make sure **Firebase Admin SDK** is selected, then click **Generate new private key** → **Generate key**.
4. A `.json` file downloads. It looks like this:
   ```json
   {
     "type": "service_account",
     "project_id": "travelgo-xxxxx",
     "private_key_id": "…",
     "private_key": "-----BEGIN PRIVATE KEY-----\n…\n-----END PRIVATE KEY-----\n",
     "client_email": "firebase-adminsdk-xxxxx@travelgo-xxxxx.iam.gserviceaccount.com",
     …
   }
   ```

> 🔒 This file is a **password to your Firebase project**. Don't commit it, don't email it, and don't paste it in chat. If it leaks, delete the key in the same **Service accounts** screen and generate a new one.

## Step 3: Give it to the backend

**Option A: local development (a file)**
1. Create a folder `backend/secrets/`. It's already git-ignored.
2. Save the downloaded file there as `backend/secrets/firebase-service-account.json`.
3. In `backend/.env`, set:
   ```
   FIREBASE_SERVICE_ACCOUNT_FILE=./secrets/firebase-service-account.json
   ```

**Option B: servers and hosting platforms (an environment variable)**
Put the whole JSON, on one line, into the platform's secret or environment settings:
```
FIREBASE_SERVICE_ACCOUNT_JSON={"type":"service_account","project_id":"travelgo-xxxxx",...}
```
If both are set, `FIREBASE_SERVICE_ACCOUNT_JSON` wins.

## Step 4: Restart and check

Restart the API (`npm run start:dev`). In the startup log you should see:
```
[PushService] Firebase push enabled for project travelgo-xxxxx
```
If you see `Firebase not configured…` instead, the path or JSON isn't being picked up. If you see `Could not read the Firebase service account…`, the file is there but isn't valid JSON.

---

## For iPhones: one extra step (APNs)

Firebase needs Apple's permission to deliver to iOS. Someone with the **Apple Developer account** does this once:

1. In <https://developer.apple.com/account> → **Certificates, IDs & Profiles** → **Keys** → **+**, create a key with **Apple Push Notifications service (APNs)** enabled. Download the `.p8` file and note the **Key ID** and your **Team ID**.
2. In Firebase → **Project settings** → **Cloud Messaging** tab → **Apple app configuration** → upload the `.p8`, then enter the Key ID and Team ID.

The backend needs **nothing** for this. The APNs key lives in Firebase, not in our `.env`.

---

## What the Flutter app must do (share with the frontend developer)

1. Add Firebase to the app (`flutterfire configure`) using **the same Firebase project**.
2. After login, get the device token and register it with the backend:
   ```
   token = await FirebaseMessaging.instance.getToken()
   POST /devices   { "token": "<token>", "platform": "ANDROID" | "IOS" }
   ```
3. Register again whenever FCM issues a new token (`FirebaseMessaging.instance.onTokenRefresh`).
4. **Before logging out:** `DELETE /devices { "token": "<token>" }`, so the phone stops getting that user's alerts.
5. Handle the notification. The "sharing ended" push carries:
   ```json
   { "type": "LOCATION_SHARE_EXPIRED", "groupId": "…" }
   ```
   in its `data`, so tapping it can open that group's map.

---

## Quick reference: environment variables

| Variable | Example | Notes |
|---|---|---|
| `FIREBASE_SERVICE_ACCOUNT_FILE` | `./secrets/firebase-service-account.json` | Path to the key file (local dev) |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | `{"type":"service_account",…}` | The key itself (servers). Overrides the file. |

Leave both blank to keep the `[DEV PUSH]` logging mode.
