# TravelGo closed beta: test plan (Phase 13)

**For:** the project lead, the app and backend developers, and whoever coordinates testers.
**PDF Phase 13 (W28–29):** "Limited external rollout (2–3 real travel groups), structured feedback capture, critical bug fixes and UX polish."
**Definition of done:** a beta cohort completes **at least one real trip end-to-end** on the app.

## 1. Before the beta starts
| | Owner | Status |
|---|---|---|
| Staging/beta server deployed with HTTPS, backups and monitoring (`DEPLOYMENT.md`) | Backend | ⏳ host not chosen |
| Firebase key set; push tested on Android and iOS | Backend + app | ⏳ key pending |
| Weather key and a map tile provider (offline maps need one that allows downloads) | Lead | ⏳ |
| SMS provider, or a decision that the beta signs up by email only | Lead | ⏳ (email works via Brevo) |
| App builds through **TestFlight** (iOS) and **Play internal testing** (Android) | App | ⏳ |
| In-app "Send feedback" screen calling `POST /feedback` (+ screenshot) | App | ⏳ backend ready |
| App crash reporting (Sentry or Crashlytics) for the crash-free-sessions KPI | App | ⏳ |
| SOS disclaimer copy agreed and shown (PDF §8) | Lead | ⏳ draft in `API_DOCUMENTATION.md` §15 |
| Privacy policy reviewed and linked in the app (`PRIVACY_POLICY_DRAFT.md`) | Lead / legal | ⏳ |
| Security checklist signed off (`SECURITY_CHECKLIST.md`) | Lead | ⏳ |
| `OPS_API_KEY` and `FEEDBACK_EMAIL` set; the team can open `/ops/stats` | Backend | ✅ built |

## 2. Cohort
- **2–3 real travel groups** of 4–10 people each, with a trip **during the beta weeks** (a weekend road trip is enough).
- Mixed phones: at least 2 Android brands and 2 iPhones per group if possible. Background location behaves differently per vendor (battery savers).
- One **group lead** per group, who acts as the trip admin and the team's contact.
- Brief everyone: it's a beta; SOS **only alerts the group**, not emergency services; how to send feedback.

## 3. What each group should do (end-to-end journey)
Matches PDF §10 user journeys. `/ops/trips` ticks these off automatically per trip (`checklist`, `endToEnd`).

| # | Step | Feature | Checklist item |
|---|---|---|---|
| 1 | Lead signs up, creates the trip, invites everyone by link/email | Auth, groups, invites | `groupOfTwoOrMore` |
| 2 | Lead plans the route on the map and finalizes it; members download the PDF | Itinerary, PDF | `finalizedItinerary` |
| 3 | Everyone opens the trip once on Wi-Fi before leaving (offline bundle and map) | Offline | (`offlineFetches`) |
| 4 | During the trip: share live location for a few hours | Live location | `locationShared` |
| 5 | Chat; lead sends one GENERAL announcement | Chat, alerts | `chatUsed` |
| 6 | Mark "Arrived" / "Stopped" at stops | Trip status | `statusUsed` |
| 7 | Log real shared costs (fuel, food, stay), at least one with a receipt photo; settle up at the end | Expenses | `expensesLogged` |
| 8 | **One planned SOS drill** (announced beforehand), acknowledged and resolved | SOS | (`alerts`) |
| 9 | After the trip: lead closes it, members download the expense report | Close, export | `tripEnded` |

## 4. Structured feedback
- **In the app:** "Send feedback" → `POST /feedback` with the category (`BUG` / `IDEA` / `OTHER`), message, optional 1–5 rating and screenshot, plus the app version, platform, OS, device model and current screen, all filled in automatically. Every report is emailed to `FEEDBACK_EMAIL`. Testers see the status and the team's reply in "My feedback" (`GET /feedback/mine`).
- **After the trip:** a 10-minute survey per tester (ease of use 1–5 per feature, what was confusing, would they use it again), and a 30-minute call with each group lead.
- **Triage** (daily during the beta) with the ops endpoints:
  ```
  GET   /ops/feedback?status=NEW            X-Ops-Key: <OPS_API_KEY>
  PATCH /ops/feedback/:id  { "status": "IN_PROGRESS", "opsNote": "Looking into it" }
  GET   /ops/feedback/:id/screenshot
  ```

**Severity and response:**
| Severity | Examples | Response |
|---|---|---|
| **S1 critical** | SOS or push not delivered, data loss, can't log in, crashes on start, wrong balances | Fix and ship a new build within 24 h |
| **S2 major** | A feature unusable on some phones, live location stops in the background | Next build (2–3 days) |
| **S3 minor / UX** | Confusing copy, layout issues | Batch for after the beta |

## 5. Metrics to watch (`GET /ops/stats?since=<beta start>`)
PDF §9 success metrics, all computed live:
| KPI (PDF §9) | Where in `/ops/stats` | Beta target (suggested) |
|---|---|---|
| Registration and retention | `users.verified`, `users.active`, `users.week1Retention` | ≥ 80% of invited testers active in week 1 |
| Group creation and invite acceptance | `groups`, `invites.acceptancePercent` | ≥ 70% of invites accepted |
| Average trip duration | `groups.averageTripDays` | (descriptive) |
| Chat engagement | `chat.messages`, `chat.peopleChatting` | most members chat at least once |
| Location-tracking adoption | `location.adoptionPercent` | ≥ 60% of active testers share |
| Expense-tracking usage | `expenses.groupsUsingPercent` | every beta group logs expenses |
| PDF export frequency | `itinerary.pdfExports` | ≥ 1 per group |
| Crash-free sessions > 95% | from the app's crash reporting (`stability` explains) | > 95% |

`GET /ops/trips` lists every trip with what it actually used, and `endToEnd: true` when the whole journey happened: **that's the Phase 13 DoD.**

## 6. Exit criteria
- ✅ At least one group: `endToEnd: true` in `/ops/trips`, confirmed with its lead.
- ✅ No open S1 bugs; S2 bugs fixed or scheduled.
- ✅ Crash-free sessions > 95% over the beta.
- ✅ Feedback summarised (top issues and UX polish list) for Phase 14.

## 7. Risks during the beta
- **Background location** killed by battery savers (Xiaomi, Samsung, OnePlus…): check `locationSharers` in `/ops/trips`, and ask testers to whitelist the app. PDF §8 risk.
- **No signal on the route:** the offline bundle and queued writes (API docs §3.8) get their first real test here.
- **Push not configured** means alerts, SOS and chat reach only open apps. It must be done before the beta.
- **Single server:** receipts on local disk and in-memory rate limits; fine for a 30-person beta.
