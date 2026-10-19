# Realtime load test

`test/load/realtime.load-spec.ts`, run with `npm run test:load` (Postgres and Redis must be running). It isn't part of `npm run test:e2e`.

**What it does:** creates N groups × M members, connects every member's socket, turns on location sharing for everyone, then for the chosen time each member:
- sends a chat message over the socket every 5 s (`LOAD_CHAT_MS`), and
- sends a location update every 2 s (`LOAD_LOCATION_MS`). That's 5× the app's real 10 s rate, to add load.

It measures how long each chat message and each location update takes to reach the **other** members of the group. Then it deletes its users and groups. Pushes and emails are stubbed, so nothing is sent outside.

```
npm run test:load                                             # 10 groups × 10 members, 30 s
LOAD_GROUPS=40 LOAD_MEMBERS=10 LOAD_SECONDS=60 npm run test:load
LOAD_RESULTS_FILE=results.json npm run test:load               # also save the numbers
```

It fails if any request errors, or if chat delivery p95 is ≥ 2 s (the PDF §4 target).

## Results (2026-10-05, dev laptop)
Windows 11, Node 24, Postgres 18 (native), Redis in WSL 2. The server and all simulated phones ran in **one process on the same machine**, so these numbers are pessimistic for the server.

| Scenario | Phones (sockets) | Chat sent / delivered | Chat delivery p50 / p95 / max | Location updates / deliveries | Location delivery p50 / p95 / max | Errors |
|---|---|---|---|---|---|---|
| 10 groups × 10, 30 s | 100 | 499 / 4,491 | 13 / **23** / 39 ms | 1,393 / 12,537 | 11 / **18** / 50 ms | 0 |
| 40 groups × 10, 60 s | 400 | 4,394 / 39,546 | 39 / **106** / 165 ms | 11,586 / 104,274 | 29 / **63** / 97 ms | 0 |

At 400 phones that's about **200 location updates/s** and **73 chat messages/s**, fanned out to ~2,400 socket events/s.

**PDF §4 targets:**
- Chat delivery < 2 s: **met** (p95 106 ms at 400 phones).
- Location updates every 5–30 s: **met** (the app sends every 10 s; the test ran at 2 s). A position reaches the group within ~0.1 s.

## Not covered yet
- A separate client machine, and a production-sized server (do it on staging in Phase 13).
- Several API servers (needs the socket.io Redis adapter, and Redis-backed rate limits).
- Real phones on mobile networks, and background/foreground switching.
- Bursts of reconnects (e.g. a bus coming out of a tunnel). The first 400-phone run, with every phone hitting the API in the same instant over new connections, got `ECONNREFUSED` from Windows' connection backlog. Real clients don't arrive that synchronised, and keep connections alive, but check the load balancer's limits.
