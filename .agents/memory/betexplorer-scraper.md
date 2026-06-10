---
name: BetExplorer scraper
description: How betexplorer.com scraping works — API endpoints, market codes, HTML parsing, rate-limit strategy.
---

## Two BetExplorer page sources — BOTH required
`fetchBetExplorerMatches` fetches **both** concurrently and merges by matchId:

| Page | URL | Contains |
|------|-----|----------|
| Results | `/football/results/?year=YYYY&month=M&day=D` | Completed matches (with best 1x2 odds in `data-odd`) |
| Schedule | `/football/?date=DD.MM.YYYY` (European format) | Upcoming/unplayed matches |

- Without the schedule page, `predict-live` finds zero BetExplorer odds for any future fixture.
- Results page takes precedence in dedup (it carries best-odds data that schedule page lacks).
- Both pages share the same `data-dt="D,M,YYYY,H,Min"` HTML structure — `parseResultsHtml` works on both.
- Match IDs in URL: `/football/{country}/{league}/{home-away}/{matchId}/` — last segment is matchId.

## CRITICAL: BetExplorer uses CET (UTC+2), not UTC — date filter must span +1 day

BetExplorer's `data-dt` timestamps are in **CET (UTC+2 in summer)**. A match at 22:00 UTC on June 10 is stored as `data-dt="11,6,2026,0,00"` (midnight CET = 22:00 UTC). If you only filter for the UTC date (June 10), you miss all matches kicking off after ~22:00 UTC.

**Fix:** `parseResultsHtml` takes a `Set<string>` of acceptable dates. `fetchBetExplorerMatches` always includes both the target date AND the next calendar day: `acceptDates = new Set([date, nextDate])`.

The results page for a given day already contains 3 days of data, so the next-day entries are already in the HTML — no extra HTTP request needed.

## CRITICAL: Accent normalization in `norm()` — use NFD decomposition

StatsHub returns team names with Unicode accents ("Ceará", "Nacional Potosí", "Málaga"). BetExplorer stores ASCII-ified names ("Ceara", "Nacional Potosi", "Malaga"). The `norm()` function MUST apply NFD decomposition before stripping non-ASCII:

```typescript
function norm(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")  // strip combining marks: é→e, ó→o, etc.
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
```

Without this, "Potosí" → "potos" (accent stripped as space → trailing space → "potos") instead of "potosi". This was the root cause of ~80% match-lookup failures for South American and European teams.

## In-memory listing cache (20 min TTL)

`fetchBetExplorerMatches` stores results in `listingCache: Map<string, {matches, expiresAt}>` keyed by the target date (ISO string). TTL = 20 minutes. Only cached if result is non-empty (don't cache 429/empty responses). This avoids re-fetching the 500KB results page for every `predict-live` call when multiple fixtures share the same date.

## Results page HTML parsing — critical notes
**Parse href and team names independently** — a single combined regex that tries to capture both URL and team names in one shot breaks whenever the anchor has extra attributes, class names, or whitespace between `>` and the text. Correct approach:
1. Extract href with `/href="(\/football\/[^"?#]+\/([a-zA-Z0-9]{4,24})\/?)"/` — permissive matchId (4–24 chars, no length assumption).
2. Extract anchor inner HTML separately with `/href="\/football\/[^"]+"\s*[^>]*>([\s\S]*?)<\/a>/`, then strip tags, decode HTML entities, and split on `" - "` for home/away.

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

## Geo-filtering & Tor proxy

BetExplorer geo-filters the bestOdds endpoint by visitor IP:
- **US IP**: 3 bookmakers max (BetMGM.us, Stake.com, one other)
- **EU IP**: 15-19 bookmakers (1xBet, 888sport, Betfair, BetInAsia, Pinnacle, etc.)

`torProxy.ts` (in `api-server/src/lib/`) routes all BetExplorer fetches through Tor SOCKS5.
Key design decisions:
- **`ExcludeExitNodes {US}` + `StrictNodes 1`** — prevents US circuits at the Tor OS level. Bootstrap stays fast because excluding only US still leaves the vast majority of exit nodes available (unlike positive ExitNodes which severely limits the pool).
- **Circuit rotation via control port still present**: after bootstrap, verifies exit IP via `ipapi.co/country/` through SOCKS5. If non-EU for any reason, sends `SIGNAL NEWNYM` on port 9051 and retries (max 12 attempts, 4s delay).
- **`CookieAuthentication 0`** on control port (loopback only, no auth needed).
- **WARNING**: do NOT use `ExitNodes {FR},{DE},...` + `StrictNodes 1` — that severely restricts the exit pool and gets stuck at ~50% descriptor loading for 3+ minutes.

## Rate limiting
- 429 responses OR "TypeError: fetch failed" (TCP RST) if requests are too rapid.
- `fetchMatchMarkets` uses 5 s delay between markets (bulk processing, sequential).
- `fetchKeyMarketsLive` fetches all 4 markets concurrently (live prediction, acceptable).
- Results/schedule listing page is not aggressively rate limited; per-match AJAX calls are.

## BetExplorer league coverage — not universal
BetExplorer covers major/notable leagues only (top European, South American, North American, Asian leagues). Lower-tier leagues (e.g. Bolivia División Profesional, lower US/Swedish leagues) may not be listed. Expect ~50-70% match rate across a typical StatsHub fixture list — the rest simply aren't on BetExplorer at all.

## Data storage
Per-bookmaker entries stored in `processing_matches` columns:
- `po_1x2_json`, `po_ou_json`, `po_ah_json`, `po_dnb_json`, `po_dc_json`, `po_btts_json`
- Each is a JSON array of `{bookmaker, odds: number[], line?: number}`.
