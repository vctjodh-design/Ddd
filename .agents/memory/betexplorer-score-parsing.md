---
name: BetExplorer score parsing
description: How to correctly parse final scores from BetExplorer results page HTML without misidentifying kickoff times as scores.
---

## The problem
BetExplorer results page (`/football/results/`) includes BOTH finished matches (with a score) and upcoming matches (pre-match odds posted but no score yet). Both types of rows have a visible "HH:MM" kickoff time in the `<td>` text content — NOT just in the `data-dt` attribute. A naive `\d+:\d+` regex will match the kickoff time (e.g. "18:00", "23:30") as a score.

**Why:** BetExplorer renders the kickoff time in a dedicated `<td>` cell for display, while also encoding it in `data-dt` for filtering. The anchor text only contains team names, but the surrounding cells contain the time.

## The fix
1. Strip all anchor tag content (team names) from the row HTML.
2. Build a regex from the already-parsed `hour:min` values and remove that specific time string.
3. After removal, match the first remaining `\d{1,2}:\d{1,2}` — if present, it's the score.
4. Validate score values are < 20 per side as an extra guard.
5. Set `isFinished = isResultsPage && homeScore !== null` — only mark as finished if a real score was found.

**Why:** This avoids marking upcoming matches (no score yet) as finished, and stops kickoff times from being parsed as scores.

## Also: schedule page overlap
BetExplorer results page may also include future matches that have pre-match odds. The deduplication in `fetchBetExplorerMatches` puts results-page entries first, but since they won't have a score (upcoming), `isFinished` stays false — correctly showing as "UPCOMING" on the home page.

## BE prediction endpoint
`POST /api/model/predict-be` — for BetExplorer-only fixtures (no StatsHub IDs). Frontend passes pre-fetched `beHomeStats`/`beAwayStats` from the fixture detail page. Backend fetches live market odds via `fetchKeyMarketsLive` and calls `predictMatch` with `be_home_stats_json`/`be_away_stats_json`. The ML model already has fallback support for BE stats (via `extractFeatures`).
