---
name: BetExplorer scraper
description: How betexplorer.com scraping works — API endpoints, market codes, HTML parsing, rate-limit strategy.
---

## Results page
URL: `https://www.betexplorer.com/football/results/?year=YYYY&month=M&day=D`
- `/soccer/results/` redirects to `/football/results/` (use the latter directly).
- Returns 3 days of matches; filter by `data-dt="D,M,YYYY,H,Min"` for exact date.
- Best 1X2 odds embedded as `data-odd="X"` on each match TR row.
- Match IDs in URL: `/football/{country}/{league}/{home-away}/{matchId}/` — last segment is matchId.

## Root nav URL (browser only — fewer results)
`https://www.betexplorer.com/?year=YYYY&month=MM&day=DD`
Use `/football/results/` for scraping; root URL is for browser navigation only.

## Per-bookmaker odds API (discovered from all.min.js `match_init`)
URL: `https://www.betexplorer.com/match-odds/{matchId}/0/{apiCode}/odds/?lang=en`
Returns JSON: `{"odds": "<HTML table>"}`.

**Market API codes** (differ from UI labels in some cases):
| Market | API code |
|--------|----------|
| 1X2    | `1x2`    |
| O/U    | `ou`     |
| AH     | `ah`     |
| DNB    | `ha`     | ← NOT "dnb"
| DC     | `dc`     |
| BTTS   | `bts`    | ← NOT "btts"

## HTML parsing
- Bookmaker name: `event-name': '...'` in onclick attribute of `<a>` in TR.
- Odds values: `data-odd="X"` attributes on each TD in the TR (in column order).
- O/U and AH lines: `<tbody id="all-odds-{line}">` groups rows by line (e.g. `all-odds-0.50`, `all-odds-1.50`).
- Non-line markets (1x2, DNB, DC, BTTS): flat table, no tbody grouping.

## Rate limiting
- 429 responses OR "TypeError: fetch failed" (TCP RST) if requests are too rapid.
- Use 1800 ms delay between markets.
- Retry 3× with 3 s × attempt back-off on network errors.
- Results page (single large HTML) is not rate limited; only per-match AJAX calls are.

**Why:** BetExplorer enforces per-IP rate limits on the `/match-odds/` endpoint, especially for `ou`/`ha`/`bts` market codes (possibly heavier backend load). Alternating 900 ms delays caused every other request to fail; 1800 ms + retries resolved it.

## Data storage
Per-bookmaker entries stored in `processing_matches` columns:
- `po_1x2_json`, `po_ou_json`, `po_ah_json`, `po_dnb_json`, `po_dc_json`, `po_btts_json`
- Each is a JSON array of `{bookmaker, odds: number[], line?: number}`.
