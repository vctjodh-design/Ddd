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
- Odds API (current): `/api/v1/event-row/{hash}/{betTypeId}/{scopeId}/`
- betTypeIds: 1=1x2, 2=O/U, 5=AH, 8=BTTS, 9=DC, 10=DNB, 11=EH, 12=CS, 13=HTFT, 16=OE; scopeId 2=FT

## Playwright browser scraping
- `artifacts/api-server/src/lib/browserScraper.ts` — singleton Chromium via `REPLIT_PLAYWRIGHT_CHROMIUM_EXECUTABLE`
- All plain HTTP fetch is blocked by Cloudflare TLS fingerprinting; browser is primary scrape method
- Strategy: try plain fetch first (fast), auto-fall back to browser (10-20 s/page) on block
- Browser intercepts ALL JSON responses from oddsportal.com; intercepted odds parsed by URL pattern
- Browser kept alive as singleton; per-request context closed after each page
- Hash pagination: `baseUrl#/page/N/` triggers client-side Next.js navigation for more results

## Constraints
- Skip matches where either team has <20 StatsHub historical matches
- CS (Correct Score): top 10 scores only (by lowest average odds = most likely)
- Job system is in-memory (restarting server loses running job state, but DB records persist)

**Why:** User wanted OddsPortal bookmaker odds + StatsHub player stats stored in SQLite per league per year.
