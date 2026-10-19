# TravelGo Backend

NestJS + TypeScript + PostgreSQL (TypeORM) + Redis. See `context/01_Architecture.md` for the full stack rationale.

## Getting started

```bash
cp .env.example .env        # already done for local dev; edit values as needed
npm install
npm run docker:up           # starts Postgres + Redis (requires Docker) — skip if using a local Postgres install
npm run start:dev           # starts the API with hot reload; pending database migrations run at start-up
```

### Database migrations
The schema is managed **only** by migrations in `src/database/migrations/` (never `synchronize`, which drops and re-creates changed columns and loses their data).

```bash
# after changing an entity:
npm run build
npm run migration:generate -- src/database/migrations/DescribeTheChange   # review the SQL it wrote!
#   then add the new class to src/database/migrations/index.ts (they run in that order)
npm run migration:show      # what's applied / pending
npm run migration:check     # fails if the entities and the database differ
npm run migration:revert    # undo the last one
```
The app applies pending migrations when it starts (`DB_MIGRATIONS_RUN=false` to turn that off).

Without Docker: use a local PostgreSQL install with a `travelgo` user and database (password `travelgo`) to match `DATABASE_URL` in `.env`. See `context/01_Architecture.md` §6.

Health check: `GET http://localhost:3000/health` → `{ status: 'ok', db: 'connected', redis: 'connected', version, uptimeSeconds }` (503 when the database is down).
Interactive API docs (Swagger): `GET http://localhost:3000/docs`.

Other useful scripts: `npm run docker:down`, `npm test`, `npm run test:e2e`, `npm run test:load` (see `docs/LOAD_TEST.md`), `npm run build`.

Deploying (staging / beta): see [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md). Running the closed beta: [docs/BETA_TEST_PLAN.md](docs/BETA_TEST_PLAN.md).

## Working docs

Living documentation, tracked phase by phase against `../TravelGo_Implementation_Plan.pdf`.

| File | Purpose |
|---|---|
| [context/01_Architecture.md](context/01_Architecture.md) | Stack decision, service breakdown, data model — the "how it's built" |
| [context/02_Build_Plan.md](context/02_Build_Plan.md) | Phase-by-phase backend deliverables, mapped to the 14-phase roadmap |
| [context/03_Progress_Tracker.md](context/03_Progress_Tracker.md) | Live checklist — update as each phase/endpoint ships |
| [context/04_API_Reference.md](context/04_API_Reference.md) | Endpoint list, kept current as APIs are built |

### Workflow

- Before starting a phase: check `02_Build_Plan.md` for scope, update `03_Progress_Tracker.md` status to "In Progress."
- As endpoints ship: add them to `04_API_Reference.md`, tick them off in the tracker.
- When a phase's Definition of Done is met: mark it done in the tracker with the date.
- Architecture changes (new service, stack swap, schema change): update `01_Architecture.md` directly, don't let it drift from what's actually built.
