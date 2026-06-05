---
name: Bulk upload pipeline (OddsPortal + StatsHub + SQLite)
description: Architecture and constraints for the league bulk-upload feature
---

## Key files
- `artifacts/api-server/src/lib/db.ts` — SQLite schema, job + match CRUD
- `artifacts/api-server/src/lib/oddsPortal.ts` — OddsPortal fetch + DOM scraper
- `artifacts/api-server/src/lib/browserScraper.ts` — Playwright Chromium, returns `domLinks` after scroll
- `artifacts/api-server/src/lib/statsHubSearch.ts` — team name → StatsHub ID lookup
- `artifacts/api-server/src/lib/bulkJob.ts` — async job runner
- `artifacts/api-server/src/routes/bulk.ts` — POST /api/bulk/start, GET /api/bulk/status/:id
- `artifacts/api-server/src/routes/dbViewer.ts` — GET /api/db/matches, /db/stats
- `artifacts/processing-engine/src/pages/database.tsx` — full database viewer page
- SQLite DB lives at `/home/runner/workspace/data/nexus.db`

## OddsPortal URL pattern (confirmed working as of 2025-06)
- Current season (year >= currentYear): `https://www.oddsportal.com/football/{country}/{league}/results/`
- Previous seasons: `https://www.oddsportal.com/football/{country}/{league}-{startYear}-{endYear}/results/`
  - e.g. year=2025 → `ligue-1-2024-2025` (NOT `ligue-1-2025` — that's a 404)
- `buildResultsUrlCandidates()` returns [startYear-endYear, single-year, base] tried in order
- Odds API (current): `/api/v1/event-row/{hash}/{betTypeId}/{scopeId}/`
- betTypeIds: 1=1x2, 2=O/U, 5=AH, 8=BTTS, 9=DC, 10=DNB, 11=EH, 12=CS, 13=HTFT, 16=OE; scopeId 2=FT

## OddsPortal is fully CSR (Vue SPA) with encrypted API responses
- No `__NEXT_DATA__`, no interceptable plaintext JSON at all (API responses are base64/encrypted by `lscompressor.min.js`)
- Match data ONLY exists in the fully-rendered DOM after React/Vue mounts
- `browserScraper.ts` now: scrolls page (triggers lazy render), then walks DOM in document order
- Returns `domLinks: DomLink[]` — each link has `{href, text, date}` extracted from rendered DOM
- Date headers like "07 Jun 2025" appear as text nodes before match rows; captured into `link.date`
- `parseDomMatchLinks()` in `oddsPortal.ts` parses the link text format:
  `"FinishedFINKabylie11–0ASO Chlef0"` → home=Kabylie score=1, away=ASO Chlef score=0
  Home score appears DOUBLED before "–"; take `rawHomeScore.slice(0, ceil(len/2))` to get actual score

## Playwright browser scraping
- `artifacts/api-server/src/lib/browserScraper.ts` — singleton Chromium via `REPLIT_PLAYWRIGHT_CHROMIUM_EXECUTABLE`
- All plain HTTP fetch is blocked by Cloudflare TLS fingerprinting; browser is primary scrape method
- Strategy: try plain fetch first (fast), auto-fall back to browser on block
- Browser kept alive as singleton; per-request context closed after each page
- Hash pagination: `baseUrl#/page/N/` for more results
- **scroll simulation required**: `page.evaluate("window.scrollBy(0, 800)")` then wait 2s, then more scroll,
  then wait 3s more — triggers lazy React rendering of match rows

## Confirmed working test (2025-06-04)
- Algeria Ligue 1 2024-25: browser extracts **51 matches** from DOM in ~11s, correct team names + dates
- `stored: 0` for Algeria is expected — those teams aren't in the fixtures DB (StatsHub not imported)
- For leagues with team data already imported, matches WILL be stored

## Constraints
- Skip matches where either team has <20 StatsHub historical matches
- CS (Correct Score): top 10 scores only (by lowest average odds = most likely)
- Job system is in-memory (restarting server loses running job state, but DB records persist)

**Why:** User wanted OddsPortal bookmaker odds + StatsHub player stats stored in SQLite per league per year.
