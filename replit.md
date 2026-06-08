# Nexus Fixtures

Football data processing app: scrapes, stores, and analyses pre-match team and player stats alongside bookmaker odds for a selected day's fixtures.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 8080)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)

## Stack

- pnpm workspaces, Node.js 20 (runtime) / 24 (pnpm internal), TypeScript 5.9
- API: Express 5, port 8080
- DB: SQLite + better-sqlite3 (local file, no env var needed)
- Build: esbuild (CJS bundle)
- Frontend: React + Vite (port 23529)

## Where things live

- `artifacts/api-server/src/lib/db.ts` — SQLite schema, all DB helpers
- `artifacts/api-server/src/lib/statsHub.ts` — StatsHub team/player stat fetching
- `artifacts/api-server/src/lib/processingJob.ts` — core processing pipeline
- `artifacts/api-server/src/routes/dbViewer.ts` — match detail API (`/api/db/match/:id`)
- `artifacts/processing-engine/src/pages/database.tsx` — Database viewer page + MatchDetailModal with analytics
- `artifacts/processing-engine/src/pages/fixture-detail.tsx` — Per-fixture live analysis page
- `artifacts/processing-engine/src/components/PlayerAnalysisPanel.tsx` — Full player analysis panel (used on fixture-detail)
- `scripts/post-merge.sh` — post-merge setup (pnpm install + better-sqlite3 rebuild + db push)

## Architecture decisions

- **better-sqlite3 ABI mismatch**: pnpm uses Node 24 internally but the api-server runs on Node 20. `scripts/post-merge.sh` rebuilds better-sqlite3 against the Node 20 nix store path after every merge.
- **Team stats analytics are client-side**: averages, last-5 form, and consistency rates are computed in `database.tsx` from the stored `SHTeamStatHistory` JSON — no extra API endpoint needed.
- **Player stats filter by kickoffTs**: processing match detail includes `kickoffTs` so the frontend can exclude the current match from historical player averages.
- **Consistency rate formula**: `max(0, 1 - stddev / (|mean| + 0.5)) * 100` — coefficient of variation approach, capped to [0, 100]. Higher = more consistent.
- **Stats data is pre-filtered at fetch time**: `fetchStatsHubTeamHistory` filters matches by `eventTimestamp < kickoffTs`, so stored team stat history already excludes the current match.

## Product

- **Home page**: Browse fixtures by date, trigger single-match or bulk processing jobs
- **Processing page**: Monitor active scraping jobs in real-time with live logs
- **Database page**: Browse all stored matches; click any match to open the detail modal
  - **Odds tab**: Full bookmaker odds across 1X2, O/U, AH, BTTS, DC, DNB markets
  - **Team Stats tab**: Side-by-side comparison table for ALL stats — shows avg (all-time), avg (last 5), and consistency % for each team; form badges (W/D/L) for last 5 matches; click any stat row to expand match history
  - **Players tab**: Toggle between "Analysis" (per-player aggregated averages, consistency, and positional rating) and "Per Game" (game-by-game player rows)
- **Fixture detail page**: Deep-dive analysis for a single fixture including full player cards with positional signals

## Gotchas

- **Port**: API server uses port 8080, NOT 5000. The replit.md was previously wrong.
- **API server dev script skips build**: The `dev` script uses `exec env ... node dist/index.mjs` (no build step) so Replit's workflow health check can detect the port. After any source change, rebuild manually first: `pnpm --filter @workspace/api-server run build`. See `.agents/memory/api-server-workflow.md` for why.
- **better-sqlite3 rebuild**: Must run `node-gyp rebuild --nodedir=<node20-nix-path>` with `CFLAGS="-O0" CXXFLAGS="-O0"` — see `.agents/memory/better-sqlite3-build.md` for exact commands.
- **StatsHub 429s**: StatsHub rate-limits aggressively. Processing jobs have built-in retry/back-off but international fixtures (no league) often get 429s and return empty stats — this is expected.
- **pnpm typecheck** has pre-existing errors in `home.tsx` and `fixture-detail.tsx` (api-client-react lib not pre-built). These do not affect the running app.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
- `.agents/memory/better-sqlite3-build.md` — full ABI mismatch fix documentation
- `.agents/memory/bulk-upload-pipeline.md` — OddsPortal scraper + bulk processing details
- `.agents/memory/betexplorer-scraper.md` — BetExplorer odds scraper details
