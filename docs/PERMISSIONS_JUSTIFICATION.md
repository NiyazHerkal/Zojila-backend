# TravelGo app permissions: justification DRAFT

> **For:** the App Store / Play Console review forms and the in-app permission prompts.
> **Status:** draft (2026-10-05) based on what the backend supports. The app team must check it against the final app, then the lead must sign it off.
> PDF §8 lists early submission of permission justifications as a risk mitigation (background location is the one most often rejected).

| Permission | Android | iOS (Info.plist key) | Why TravelGo needs it | When it's asked |
|---|---|---|---|---|
| Location while using the app | `ACCESS_FINE_LOCATION`, `ACCESS_COARSE_LOCATION` | `NSLocationWhenInUseUsageDescription` | To show your position on the trip map, and to attach it to an SOS | The first time you open the map or start sharing |
| **Background location** | `ACCESS_BACKGROUND_LOCATION` + a foreground service of type `location` (`FOREGROUND_SERVICE_LOCATION`) | `NSLocationAlwaysAndWhenInUseUsageDescription`, background mode `location` | **Only while you've turned on live sharing** for a trip, for the time you chose (1/4/8 h or until you stop), so your group can see where you are when the phone is in your pocket. Sharing turns itself off when the time ends. A persistent notification shows while it's on | When you turn on sharing, after explaining it |
| Notifications | `POST_NOTIFICATIONS` (Android 13+) | Push notification authorization | SOS and critical alerts from your group, chat when the app is closed, "sharing ended", expense notifications | After sign-in |
| Camera | `CAMERA` | `NSCameraUsageDescription` | To photograph a receipt for a shared expense, or take a profile picture | When you tap "add receipt → camera" or "change photo → camera" |
| Photos / files | Photo picker (no permission on Android 13+); `READ_MEDIA_IMAGES` only if needed | `NSPhotoLibraryUsageDescription` | To attach an existing receipt photo or PDF to an expense, or pick a profile picture or trip cover image | When you tap "add receipt → gallery", "change photo" or "cover image" |
| Storage for offline maps | none (app-private storage) | none | Offline map tiles and the trip are kept in the app's own storage | n/a |
| Internet / network state | `INTERNET`, `ACCESS_NETWORK_STATE` | n/a | Talking to the TravelGo server; detecting offline mode | n/a (install-time) |

## Suggested prompt texts (to be shown before the system dialog)
- **Location (when in use):** "TravelGo shows your position on the trip map and adds it to an SOS, so your group knows where you are."
- **Background location:** "To keep your group updated while your phone is in your pocket, TravelGo needs location access 'All the time' — but only while you're sharing. You choose for how long, and you can stop at any time."
- **Notifications:** "Get SOS and critical alerts from your group, even when TravelGo is closed."
- **Camera:** "Take a photo of a receipt to share the cost with your group, or a profile picture."

## Notes for the Play Console "location permissions" declaration
- **Core feature:** live location sharing with your own trip group, or by link with family/friends outside the app (15 min / 1 h / 8 h), which the user explicitly starts and which ends automatically.
- **Video demo** required by Google: record turning on sharing → the time picker → the persistent notification → the map seen by another member → sharing ending.
- The location data isn't sold, used for ads or kept as history (see `PRIVACY_POLICY_DRAFT.md`).
- Background updates go every ~10 s (`updateIntervalSeconds` from the server), within the PDF's 5–30 s range.
