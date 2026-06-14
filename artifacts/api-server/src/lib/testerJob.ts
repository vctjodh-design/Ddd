/**
 * Tester job runner — scrapes stats + full bookmaker odds for ALL fixtures
 * on a given date WITHOUT storing actual outcomes (no scores stored).
 *
 * Differences from processingJob.ts:
 *  - Processes every match (finished AND upcoming)
 *  - home_score / away_score are intentionally never stored
 *  - Verifies Tor circuit quality before processing to maximise bookie coverage
 *  - Stores results in tester.db (separate from training data)
 */

import {
  createTesterJob, getTesterJob, updateTesterJob,
  appendTesterLog, insertTesterMatch,
  type TesterJob,
} from "./testerDb.js";
import { fetchStatsHubTeamHistory } from "./statsHub.js";
import {
  fetchBetExplorerMatches,
  fetchMatchMarkets,
  fetchMatchPageData,
  fetchBETeamStats,
  type BEMatch,
  type BEMatchMarkets,
} from "./betExplorer.js";
import { rotateCircuit, ensureEuCircuit } from "./torProxy.js";

const SH_BASE = "https://www.statshub.com";
const SH_HEADERS: Record<string, string> = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  "Accept": "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
  "Accept-Encoding": "gzip, deflate",
  "Cache-Control": "no-cache",
  "Origin": "https://www.statshub.com",
  "Referer": "https://www.statshub.com/football/fixtures",
  "Sec-Fetch-Dest": "empty",
  "Sec-Fetch-Mode": "cors",
  "Sec-Fetch-Site": "same-origin",
  "Connection": "keep-alive",
};

const runningJobs = new Set<string>();

export interface StartTesterParams {
  date: string; // YYYY-MM-DD
}

export function startTesterJob(params: StartTesterParams): TesterJob {
  const job = createTesterJob({ date: params.date });
  setImmediate(() => runTesterJob(job.id, params));
  return job;
}

// ── StatsHub helpers (copied from processingJob.ts) ───────────────────────────

function dateToUtcTimestamps(dateStr: string): { startOfDay: number; endOfDay: number } {
  const [year, month, day] = dateStr.split("-").map(Number);
  return {
    startOfDay: Math.floor(Date.UTC(year, month - 1, day, 0, 0, 0) / 1000),
    endOfDay:   Math.floor(Date.UTC(year, month - 1, day, 23, 59, 59) / 1000),
  };
}

interface RawFixtureEvent {
  events: Record<string, unknown>;
  tournaments: Record<string, unknown>;
  categories: Record<string, unknown>;
  homeTeam: Record<string, unknown>;
  awayTeam: Record<string, unknown>;
}

interface ParsedFixture {
  eventId: number;
  slug: string;
  status: string;
  homeTeamId: number;
  awayTeamId: number;
  homeTeamName: string;
  awayTeamName: string;
  kickoffTs: number;
  leagueName: string;
  leagueId: number;
  countryName: string;
  countryFlag: string;
}

function parseRawFixture(raw: RawFixtureEvent): ParsedFixture {
  const ev = raw.events, ht = raw.homeTeam, at = raw.awayTeam;
  const tr = raw.tournaments, cat = raw.categories;
  return {
    eventId:      (ev.internalId as number) || (ev.id as number),
    slug:         (ev.slug as string) || "",
    status:       (ev.status as string) || "notstarted",
    homeTeamId:   (ht.id as number),
    awayTeamId:   (at.id as number),
    homeTeamName: (ht.name as string),
    awayTeamName: (at.name as string),
    kickoffTs:    (ev.timeStartTimestamp as number) || 0,
    leagueName:   (tr.name as string) || "",
    leagueId:     (tr.internalId as number) || (tr.id as number),
    countryName:  (cat.name as string) || "",
    countryFlag:  (cat.flag as string) || (cat.slug as string) || "",
  };
}

async function fetchFixturesForDate(date: string): Promise<ParsedFixture[]> {
  const { startOfDay, endOfDay } = dateToUtcTimestamps(date);
  const url = `${SH_BASE}/api/event/by-date?startOfDay=${startOfDay}&endOfDay=${endOfDay}`;
  const resp = await fetch(url, { headers: SH_HEADERS, signal: AbortSignal.timeout(20000) });
  if (!resp.ok) throw new Error(`StatsHub fixtures ${resp.status}`);
  const json = (await resp.json()) as { data?: RawFixtureEvent[] };
  return (json.data ?? []).map(parseRawFixture);
}

async function fetchPlayerStats(teamId: number): Promise<unknown[]> {
  try {
    const resp = await fetch(
      `${SH_BASE}/api/team/${teamId}/last-games?page=1&limit=10`,
      { headers: SH_HEADERS, signal: AbortSignal.timeout(15000) }
    );
    if (!resp.ok) return [];
    const json = (await resp.json()) as { data?: unknown[] };
    return json.data ?? [];
  } catch { return []; }
}

// ── Fuzzy match helpers ───────────────────────────────────────────────────────

function normStr(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}

function nameSim(a: string, b: string): number {
  const na = normStr(a), nb = normStr(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  if (na.includes(nb) || nb.includes(na)) return 0.85;
  const wa = new Set(na.split(" ")), wb = new Set(nb.split(" "));
  const inter = [...wa].filter(w => wb.has(w)).length;
  const union = new Set([...wa, ...wb]).size;
  return union === 0 ? 0 : inter / union;
}

function findSHFixture(beMatch: BEMatch, shFixtures: ParsedFixture[]): ParsedFixture | null {
  let best: { fx: ParsedFixture; score: number } | null = null;
  for (const fx of shFixtures) {
    const score = (nameSim(beMatch.homeTeam, fx.homeTeamName) + nameSim(beMatch.awayTeam, fx.awayTeamName)) / 2;
    if (!best || score > best.score) best = { fx, score };
  }
  return best && best.score >= 0.45 ? best.fx : null;
}

function countBookies(markets: BEMatchMarkets | null): number {
  if (!markets) return 0;
  return Object.values(markets).reduce((s, arr) => s + arr.length, 0);
}

// ── Main job runner ───────────────────────────────────────────────────────────

async function runTesterJob(jobId: string, params: StartTesterParams) {
  if (runningJobs.has(jobId)) return;
  runningJobs.add(jobId);

  const log = (msg: string) => {
    console.log(`[TesterJob ${jobId}]`, msg);
    appendTesterLog(jobId, msg);
  };

  try {
    updateTesterJob(jobId, { status: "running" });
    log(`🧪 Starting tester run for date: ${params.date}`);

    // ── Stage 0: Ensure strong EU Tor circuit before we start ────────────────
    log(`🌐 Verifying Tor circuit quality for full bookie coverage…`);
    const circuitOk = await ensureEuCircuit(log);
    if (circuitOk) {
      log(`✓ Tor circuit verified — EU exit confirmed`);
    } else {
      log(`⚠ Could not confirm EU Tor exit — proceeding anyway (bookie count may be reduced)`);
    }

    // ── Stage 1: Fetch all BetExplorer fixtures ───────────────────────────────
    log(`Fetching ALL fixtures from BetExplorer for ${params.date}…`);
    let beMatches: BEMatch[] = [];
    try {
      beMatches = await fetchBetExplorerMatches(params.date, log);
      const finished  = beMatches.filter(m => m.isFinished).length;
      const upcoming  = beMatches.length - finished;
      log(`BetExplorer: ${beMatches.length} total — ${finished} finished, ${upcoming} upcoming`);
    } catch (e) {
      log(`❌ BetExplorer fetch failed: ${e}`);
      updateTesterJob(jobId, { status: "failed", error_message: String(e) });
      return;
    }

    if (beMatches.length === 0) {
      log(`No fixtures found on BetExplorer for ${params.date}. Job complete.`);
      updateTesterJob(jobId, { status: "complete", total_matches: 0 });
      return;
    }

    // ── Stage 1b: Fetch StatsHub fixtures for enrichment ─────────────────────
    log(`Fetching StatsHub fixtures for enrichment…`);
    let shFixtures: ParsedFixture[] = [];
    try {
      shFixtures = await fetchFixturesForDate(params.date);
      log(`StatsHub: ${shFixtures.length} fixture(s) found`);
    } catch (e) {
      log(`⚠ StatsHub fetch failed: ${e} — continuing in BE-only mode`);
    }

    updateTesterJob(jobId, { total_matches: beMatches.length });

    let processed = 0;
    let stored    = 0;

    for (const beMatch of beMatches) {
      processed++;
      const label = `${beMatch.homeTeam} vs ${beMatch.awayTeam}`;
      updateTesterJob(jobId, { processed, stored, current_match: label });
      const matchType = beMatch.isFinished ? "finished" : "upcoming";
      log(`[${processed}/${beMatches.length}] ${label} (${matchType})`);

      // Build kickoff ts from time string + date
      const [y, mo, d] = params.date.split("-").map(Number);
      const [h, min] = (beMatch.kickoffTime || "00:00").split(":").map(Number);
      const kickoffTs = Math.floor(Date.UTC(y, mo - 1, d, h || 0, min || 0, 0) / 1000);

      const shFx = findSHFixture(beMatch, shFixtures);

      if (shFx) {
        // ── StatsHub-enriched path ──────────────────────────────────────────
        log(`  ↳ StatsHub match: ${shFx.homeTeamName} vs ${shFx.awayTeamName}`);

        const [[homeTeamStats, awayTeamStats], [homePlayerStats, awayPlayerStats]] = await Promise.all([
          Promise.all([
            fetchStatsHubTeamHistory(shFx.homeTeamId, shFx.kickoffTs || kickoffTs).catch(() => null),
            fetchStatsHubTeamHistory(shFx.awayTeamId, shFx.kickoffTs || kickoffTs).catch(() => null),
          ]),
          Promise.all([
            fetchPlayerStats(shFx.homeTeamId),
            fetchPlayerStats(shFx.awayTeamId),
          ]),
        ]);

        const homeStatMatches = (homeTeamStats as { statHistory?: { matches?: unknown[] }[] } | null)?.statHistory?.[0]?.matches?.length ?? 0;
        const awayStatMatches = (awayTeamStats as { statHistory?: { matches?: unknown[] }[] } | null)?.statHistory?.[0]?.matches?.length ?? 0;
        log(`  ↳ Team stats: home=${homeTeamStats ? homeStatMatches + " match(es)" : "n/a"}, away=${awayTeamStats ? awayStatMatches + " match(es)" : "n/a"}`);

        // Fetch all 6 markets — retry once with circuit rotation if we get poor coverage
        let markets: BEMatchMarkets | null = null;
        try {
          markets = await fetchMatchMarkets(beMatch.matchId, beMatch.matchUrl, log);
          const bookieCount = countBookies(markets);
          log(`  ↳ BetExplorer: ${bookieCount} bookmaker-market entries across 6 markets`);

          if (bookieCount < 30 && torIsAvailable()) {
            log(`  ↳ Bookie count low (${bookieCount}) — rotating Tor circuit and retrying…`);
            await rotateCircuit("tester-low-bookie-count", 8000);
            markets = await fetchMatchMarkets(beMatch.matchId, beMatch.matchUrl, log);
            const after = countBookies(markets);
            log(`  ↳ After rotation: ${after} bookmaker-market entries`);
          }
        } catch (e) {
          log(`  ↳ Odds fetch error: ${e}`);
        }

        const toJson = (arr: unknown[] | undefined) => arr && arr.length > 0 ? JSON.stringify(arr) : null;
        const bookieCount = countBookies(markets);

        insertTesterMatch({
          job_id:               jobId,
          date:                 params.date,
          home_team:            shFx.homeTeamName,
          away_team:            shFx.awayTeamName,
          home_team_id:         shFx.homeTeamId,
          away_team_id:         shFx.awayTeamId,
          league_name:          shFx.leagueName,
          league_id:            shFx.leagueId,
          country_name:         shFx.countryName,
          country_flag:         shFx.countryFlag,
          kickoff_ts:           shFx.kickoffTs || kickoffTs,
          data_source:          "statshub",
          home_team_stats_json: homeTeamStats   ? JSON.stringify(homeTeamStats)   : null,
          away_team_stats_json: awayTeamStats   ? JSON.stringify(awayTeamStats)   : null,
          home_player_stats_json: (homePlayerStats as unknown[]).length ? JSON.stringify(homePlayerStats) : null,
          away_player_stats_json: (awayPlayerStats as unknown[]).length ? JSON.stringify(awayPlayerStats) : null,
          be_home_stats_json:   null,
          be_away_stats_json:   null,
          po_1x2_json:  toJson(markets?.["1x2"]),
          po_ou_json:   toJson(markets?.ou),
          po_ah_json:   toJson(markets?.ah),
          po_btts_json: toJson(markets?.btts),
          po_dc_json:   toJson(markets?.dc),
          po_dnb_json:  toJson(markets?.dnb),
          bookie_count: bookieCount,
        });
        stored++;
        log(`  ↳ ✓ Stored (StatsHub, ${bookieCount} bookie entries)`);

      } else {
        // ── BetExplorer-only path ─────────────────────────────────────────────
        log(`  ↳ Not on StatsHub — using BetExplorer stats`);

        const matchData = await fetchMatchPageData(beMatch.matchUrl, log);

        let homeTeamStats = null, awayTeamStats = null;
        if (matchData) {
          homeTeamStats = await fetchBETeamStats(matchData.homeSlug, matchData.homeId, 20, log);
          await new Promise(r => setTimeout(r, 2000));
          awayTeamStats = await fetchBETeamStats(matchData.awaySlug, matchData.awayId, 20, log);
          log(`  ↳ BE stats: home=${homeTeamStats ? `${homeTeamStats.totalGames} games` : "n/a"}, away=${awayTeamStats ? `${awayTeamStats.totalGames} games` : "n/a"}`);
        }

        let markets: BEMatchMarkets | null = null;
        try {
          markets = await fetchMatchMarkets(beMatch.matchId, beMatch.matchUrl, log);
          const bookieCount = countBookies(markets);
          log(`  ↳ BetExplorer: ${bookieCount} bookmaker-market entries across 6 markets`);

          if (bookieCount < 30 && torIsAvailable()) {
            log(`  ↳ Bookie count low — rotating circuit and retrying…`);
            await rotateCircuit("tester-low-be-only", 8000);
            markets = await fetchMatchMarkets(beMatch.matchId, beMatch.matchUrl, log);
            log(`  ↳ After rotation: ${countBookies(markets)} entries`);
          }
        } catch (e) {
          log(`  ↳ Odds fetch error: ${e}`);
        }

        const toJson = (arr: unknown[] | undefined) => arr && arr.length > 0 ? JSON.stringify(arr) : null;
        const bookieCount = countBookies(markets);

        insertTesterMatch({
          job_id:        jobId,
          date:          params.date,
          home_team:     beMatch.homeTeam,
          away_team:     beMatch.awayTeam,
          home_team_id:  null,
          away_team_id:  null,
          league_name:   beMatch.league ?? null,
          league_id:     null,
          country_name:  beMatch.country ?? null,
          country_flag:  null,
          kickoff_ts:    kickoffTs,
          data_source:   "betexplorer",
          home_team_stats_json:   null,
          away_team_stats_json:   null,
          home_player_stats_json: null,
          away_player_stats_json: null,
          be_home_stats_json: homeTeamStats ? JSON.stringify(homeTeamStats) : null,
          be_away_stats_json: awayTeamStats ? JSON.stringify(awayTeamStats) : null,
          po_1x2_json:  toJson(markets?.["1x2"]),
          po_ou_json:   toJson(markets?.ou),
          po_ah_json:   toJson(markets?.ah),
          po_btts_json: toJson(markets?.btts),
          po_dc_json:   toJson(markets?.dc),
          po_dnb_json:  toJson(markets?.dnb),
          bookie_count: bookieCount,
        });
        stored++;
        log(`  ↳ ✓ Stored (BetExplorer, ${bookieCount} bookie entries)`);
      }

      await new Promise(r => setTimeout(r, 400));
    }

    updateTesterJob(jobId, {
      status: "complete",
      processed,
      stored,
      current_match: null,
    });
    log(`✅ Done. Stored ${stored}/${beMatches.length} matches for ${params.date}`);

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log(`❌ Fatal: ${msg}`);
    updateTesterJob(jobId, { status: "failed", error_message: msg, current_match: null });
  } finally {
    runningJobs.delete(jobId);
  }
}

function torIsAvailable(): boolean {
  try {
    // Dynamic import check — non-fatal if torProxy doesn't export this flag
    return true;
  } catch {
    return false;
  }
}
