# lunii-api

## Deployment (DigitalOcean App Platform)

Deploys are rolling: the new instance starts, passes `GET /health`, takes the traffic, and only then does the old one get `SIGTERM`. The old one keeps running for a while next to the new code.

- **Run command:** `node --import tsx dist/index.js` (`pnpm start`). Not through `pnpm`/`tsx` as a parent process, so `SIGTERM` reaches the app directly.
- **Migrations:** run once as a Pre-Deploy job (`pnpm migrate`), never from the service's start command.
- **Graceful shutdown:** on `SIGTERM` the server stops taking requests, waits for the ones in flight (chat streams included), then waits for background generations (`src/lib/backgroundTasks.ts`) before closing the DB pool. Termination grace period in App Platform is 150 s; the app gives up at 140 s.
- **Background work:** anything that outlives its request goes through `runInBackground`, and cron tasks through `shutdownAwareTask`. A bare `void promise` is killed mid-write by a deploy.

## Migrations must be backward compatible

The old version runs against the new schema for the whole deploy. So a migration may only add: new tables, new nullable (or defaulted) columns, new indexes. Renaming or dropping happens in a later deploy, once no running code reads the old shape:

1. Deploy A: add the new column, write both, read the new one with a fallback.
2. Deploy B: drop the old column.

This applies from the first public release; until then (no shipped builds) breaking changes are fine.
