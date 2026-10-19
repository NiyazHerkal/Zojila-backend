# TravelGo privacy policy: DRAFT for legal review

> **Status:** draft written from what the backend actually stores (2026-10-05). Not legal advice.
> Before publishing, a lawyer must review it, and the **[placeholders]** must be filled in.
> Covers GDPR and India's Digital Personal Data Protection Act 2023 (DPDP) at a high level.
> The app stores also need it (PDF §8: "submit permission-justification and privacy policy drafts early").

**Who we are:** TravelGo is provided by Codehaste **[legal entity name, address]**. Contact: **[privacy email]**. **[Grievance officer / DPO name and contact, if required]**.

## What we collect, and why

| Data | When | Why |
|---|---|---|
| Name, username, email and/or phone number | When you sign up | Your account, signing in, letting group members find and add you |
| Password | When you sign up | Signing in. We store only a one-way hash, never the password itself |
| Profile photo (uploaded, or a link) | If you add one | Shown to people who share a trip with you, and to people you share your live location with by link. Anyone given its web address can open it, so it isn't secret |
| Trips (groups): name, description, dates, members and roles | When you create or join a trip | Running the trip |
| Itinerary: places, dates, notes | When an admin plans the trip | Showing the plan; the PDF export |
| **Live location** | **Only while you choose to share it** with a trip, for the time you pick (1, 4 or 8 hours, or until you stop) | Showing your position to that trip's members. We keep **only your latest position**, and delete it when sharing ends. We don't keep a location history |
| **Live location shared by link** | **Only while you choose to share it** with someone outside TravelGo, for 15 minutes, 1 hour or 8 hours (or until you stop) | Showing your position to whoever has the link you sent. We keep **only your latest position** while a link is active, and the link itself (who it's for, when it started/ended, when it was first opened) for 30 days after it ends. Anyone you forward the link to can see your location until it ends, so share it only with people you trust |
| Location in an SOS | When you raise an SOS | Showing the group where you need help. It's stored with the SOS message until the trip is deleted |
| Trip status ("arrived", "need help"…) and notes | When you set them | Showing your group how you are |
| Chat messages and alerts | When you send them | Group chat |
| Expenses, receipt photos, repayments | When you add them | Splitting costs and showing who owes whom |
| Device push token and platform (Android/iOS) | When you allow notifications | Sending you notifications |
| When you were last online | While you use the app | Showing your group who is around |
| Feedback you send (message, rating, optional screenshot, app version and phone model) | When you use "Send feedback" | Fixing bugs and improving the app |
| Usage counts (which features you used on which day: app opened, location sharing started, PDF/report exported, offline download) | While you use the app | Measuring which features work (no content, no locations) |
| Technical logs | When you use the service | Security, abuse prevention (e.g. rate limiting by IP address) and fixing errors |

We don't sell your data, show ads, or use it for profiling.

## Who sees your data
- **Your trip's members** see what you share in that trip: your name, username and photo, messages, status, expenses, and your location while you share it. They **don't** see your email or phone number.
- **Service providers** that process data for us:
  - **[Hosting provider, region]**: servers and database.
  - **Brevo** (Sendinblue SAS, EU): sends sign-up codes, password-reset codes and invitation emails.
  - **[SMS provider]**: sends codes and invitations by text message.
  - **Google Firebase Cloud Messaging**: delivers push notifications.
  - **Open-Meteo** and **MET Norway** (Norwegian Meteorological Institute): receive the coordinates of itinerary stops (not your live location) to add elevation and weather.
  - **OpenStreetMap's Overpass service ([Overpass host])**: receives the point you search around when you look for nearby fuel stations, restaurants or garages (rounded to about 100 m, without your name or account), to find those places.
  - **OpenStreetMap tile servers / [map tile provider]**: map images for the itinerary PDF and the app's maps.
  - **[Routing provider] (OSRM, OpenStreetMap data)**: receives the coordinates of itinerary stops (not your live location) to draw the road route between them.
  - **Sentry**: error reports. These contain no personal data (no message content, emails, locations or tokens).
- We may disclose data when the law requires it.

## How long we keep it
- **A trip** stays until an admin deletes it, or **closes** it: a closed trip is deleted **30 days** after closing, with all its messages, expenses, receipts and itinerary.
- **Profile photo:** until you replace or remove it, or delete your account.
- **Live location:** only the latest position, and only while sharing.
- **Live location links:** the link's details for 30 days after it ends; your position is never kept after sharing ends.
- **Accounts never verified** are deleted after **7 days**.
- **Expired invitations** are deleted **30 days** after they expire.
- **Usage counts** are deleted after **180 days**, **feedback** after **365 days**. Both are deleted with your account.
- **Your account** stays until you delete it.

## Your rights
- **Download your data:** in the app (**Settings → Download my data**), or `GET /auth/me/export`.
- **Delete your account:** in the app (**Settings → Delete account**). We erase your name, username, email, phone, photo, password and devices. Messages and expenses you added to a trip stay visible to its members as "Deleted user", because the trip's history and cost-sharing depend on them; they're deleted with the trip.
- Correct your profile at any time. Stop sharing your location at any time. Turn off notifications in your phone's settings.
- Contact **[privacy email]** for any other request, or to complain. You can also complain to your data protection authority **[EU supervisory authority / India Data Protection Board]**.

## Security
Passwords and codes are stored as one-way hashes. Traffic is encrypted (HTTPS). Access to a trip's data is limited to its members. **[Add: encryption at rest once production storage is chosen]**

## SOS is not an emergency service
TravelGo's SOS **only alerts your trip group**. It does not contact the police, ambulance or any emergency service. In an emergency, call your local emergency number (**112** in India). (Wording to be agreed; PDF §8.)

## Children
TravelGo is not meant for children under **[13 / 18 — decide per target markets]**. **[DPDP: verifiable parental consent is required under 18 if minors are allowed.]**

## Changes
We'll tell you in the app before material changes take effect. **Last updated: [date].**
