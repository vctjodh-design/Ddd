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

## Per-bookmaker odds API — TWO endpoints, only one returns all bookmakers

### ✅ bestOdds endpoint (ALL bookmakers — use this one)
URL: `https://www.betexplorer.com/match-odds/{matchId}/1/{apiCode}/bestOdds/?lang=en`
- Returns JSON: `{"odds": "<HTML table>"}`.
- **From US IPs**: returns 2 US bookmakers (BetMGM.us, Stake.com).
- **From EU IPs**: returns 15+ international bookmakers (1xBet, 888sport, Betfair, BetInAsia, etc.).
- Single `tbody id="best-odds-0"` — flat table, no line grouping.
- For O/U/AH: shows one line at a time; active line in nav: `<li id="2.50" class="...oddsComparison__activeSubLi...">`.

### ❌ odds endpoint (geo-filtered — do NOT use)
URL: `https://www.betexplorer.com/match-odds/{matchId}/0/{apiCode}/odds/?lang=en`
- From US IPs: only returns Stake.com (1 bookmaker).
- tbody uses `all-odds-{line}` grouping for O/U/AH (multiple lines per response).

**Market API codes** (differ from UI labels in some cases):
| Market | API code |
|--------|----------|
| 1X2    | `1x2`    |
| O/U    | `ou`     |
| AH     | `ah`     |
| DNB    | `ha`     | ← NOT "dnb"
| DC     | `dc`     |
| BTTS   | `bts`    | ← NOT "btts"

## HTML parsing (bestOdds endpoint)
- Bookmaker name: FIRST `event-name': '...'` in onclick attribute in each `<tr>` (each TR has 2 occurrences — mobile + desktop columns — take only the first).
- Odds values: `data-odd="X"` attributes on TD cells (in column order: Home/Yes/Over first).
- All markets: flat table (no tbody line-grouping).
- O/U active line: `extractActiveLine(html)` reads `id="2.50"` from activeSubLi nav class.

## Rate limiting
- 429 responses OR "TypeError: fetch failed" (TCP RST) if requests are too rapid.
- `fetchMatchMarkets` uses 5 s delay between markets (bulk processing, sequential).
- `fetchKeyMarketsLive` fetches all 4 markets concurrently (live prediction, acceptable).
- Results page is not rate limited; only per-match AJAX calls are.

## Data storage
Per-bookmaker entries stored in `processing_matches` columns:
- `po_1x2_json`, `po_ou_json`, `po_ah_json`, `po_dnb_json`, `po_dc_json`, `po_btts_json`
- Each is a JSON array of `{bookmaker, odds: number[], line?: number}`.
