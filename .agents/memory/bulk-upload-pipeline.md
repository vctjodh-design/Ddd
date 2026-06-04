---
name: Bulk upload pipeline (OddsPortal + StatsHub + SQLite)
description: Architecture and constraints for the league bulk-upload feature
---

## Key files
- `artifacts/api-server/src/lib/db.ts` — SQLite schema, job + match CRUD
- `artifacts/api-server/src/lib/oddsPortal.ts` — OddsPortal fetch + cheerio scraper
- `artifacts/api-server/src/lib/statsHubSearch.ts` — team name → StatsHub ID lookup
- `artifacts/api-server/src/lib/bulkJob.ts` — async job runner
- `artifacts/api-server/src/routes/bulk.ts` — POST /api/bulk/start, GET /api/bulk/status/:id
- `artifacts/api-server/src/routes/dbViewer.ts` — GET /api/db/matches, /db/stats
- `artifacts/processing-engine/src/pages/database.tsx` — full database viewer page
- SQLite DB lives at `/home/runner/workspace/data/nexus.db`

## OddsPortal URL pattern
- Current year: `https://www.oddsportal.com/football/{country}/{league}/results/`
- Previous year: `https://www.oddsportal.com/football/{country}/{league}-{year}/results/`
- Individual match odds API (experimental): `https://www.oddsportal.com/api/v1/event/{hash}/{market}/`

## Constraints
- Skip matches where either team has <20 StatsHub historical matches
- CS (Correct Score): top 10 scores only (by lowest average odds = most likely)
- OddsPortal may be blocked by Cloudflare — scraper degrades gracefully (stores stats without odds)
- Job system is in-memory (restarting server loses running job state, but DB records persist)

**Why:** User wanted OddsPortal bookmaker odds + StatsHub player stats stored in SQLite per league per year.
