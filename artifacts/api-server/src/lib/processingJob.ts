/**
 * Processing job runner — date-based pipeline.
 * Stage 1: Fetch all fixtures for a date from StatsHub
 * Stage 2: Fetch team stats + player stats from StatsHub
 * Stage 3: Fetch odds from BetExplorer.com (plain HTTP, no Playwright needed)
 * Stage 4: Store everything in processing_matches
 */

import {
  createProcessingJob, getProcessingJob, updateProcessingJob,
  appendProcessingLog, insertProcessingMatch,
  type ProcessingJob,
} from "./db.js";
import { fetchStatsHubTeamHistory } from "./statsHub.js";
import {
  fetchBetExplorerMatches,
  fetchMatchMarkets,
  findBestBEMatch,
  type BEMatch,
  type BEMatchMarkets,
} from "./betExplorer.js";

const SH_BASE = "https://www.statshub.com";
const SH_HEADERS: Record<string, string> = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  "Accept": "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
  "Accept-Encoding": "gzip, deflate",
  "Cache-Control": "no-cache",
  "Pragma": "no-cache",
  "Origin": "https://www.statshub.com",
  "Referer": "https://www.statshub.com/football/fixtures",
  "sec-ch-ua": '"Google Chrome";v="125", "Chromium";v="125", "Not.A/Brand";v="24"',
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": '"Windows"',
  "Sec-Fetch-Dest": "empty",
  "Sec-Fetch-Mode": "cors",
  "Sec-Fetch-Site": "same-origin",
  "Connection": "keep-alive",
  "DNT": "1",
};

const runningJobs = new Set<string>();

export interface StartProcessingParams {
  date: string; // YYYY-MM-DD
}

export function startProcessingJob(params: StartProcessingParams): ProcessingJob {
  const job = createProcessingJob({ date: params.date });
  setImmediate(() => runJob(job.id, params));
  return job;
}

// ── StatsHub helpers ─────────────────────────────────────────────────────────

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
  unique_tournaments?: Record<string, unknown>;
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
  homeScore: number | null;
  awayScore: number | null;
  kickoffTs: number;
  leagueName: string;
  leagueId: number;
  countryName: string;
  countryFlag: string;
}

function parseRawFixture(raw: RawFixtureEvent): ParsedFixture {
  const ev = raw.events;
  const ht = raw.homeTeam;
  const at = raw.awayTeam;
  const tr = raw.tournaments;
  const cat = raw.categories;
  const status = (ev.status as string) || "notstarted";
  return {
    eventId:      (ev.internalId as number) || (ev.id as number),
    slug:         (ev.slug as string) || "",
    status,
    homeTeamId:   (ht.id as number),
    awayTeamId:   (at.id as number),
    homeTeamName: (ht.name as string),
    awayTeamName: (at.name as string),
    homeScore:    status !== "notstarted" ? ((ev.homeScoreCurrent as number | null) ?? null) : null,
    awayScore:    status !== "notstarted" ? ((ev.awayScoreCurrent as number | null) ?? null) : null,
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

// Player stats via last-games endpoint
interface RawPlayerGame {
  events: {
    id: number;
    homeTeamId: number;
    awayTeamId: number;
    timeStartTimestamp: number;
    homeScoreCurrent?: number;
    awayScoreCurrent?: number;
    tournamentName?: string;
    status?: string;
  };
  homeTeam: { id: number; name: string };
  awayTeam: { id: number; name: string };
  homeTeamLineup?: RawPlayer[];
  awayTeamLineup?: RawPlayer[];
}

interface RawPlayer {
  playerId: number;
  name: string;
  jerseyNo?: number;
  position?: string;
  minutesPlayed?: number;
  rating?: number;
  isSubstitute?: boolean;
  goals?: number;
  assists?: number;
  shots?: number;
  onTargetScoringAttempt?: number;
  shotOffTarget?: number;
  blockedScoringAttempt?: number;
  totalPass?: number;
  accuratePass?: number;
  totalCross?: number;
  accurateCross?: number;
  totalTackle?: number;
  interceptionWon?: number;
  fouls?: number;
  wasFouled?: number;
  yellowCard?: number | null;
  redCard?: number | null;
  saves?: number;
  expectedGoals?: string;
  expectedAssists?: string;
  dispossessed?: number;
  totalOffside?: number;
  possessionLostCtrl?: number;
  duelWon?: number;
  duelLost?: number;
  aerialWon?: number;
  totalClearance?: number;
  keyPass?: number;
  bigChanceCreated?: number;
  wonContest?: number;
}

function parsePlayer(p: RawPlayer) {
  const xG = parseFloat(p.expectedGoals ?? "0") || 0;
  const xA = parseFloat(p.expectedAssists ?? "0") || 0;
  const goals = p.goals ?? 0;
  const assists = p.assists ?? 0;
  const fouls = p.fouls ?? 0;
  const foulsWon = p.wasFouled ?? 0;
  const shots = (p.onTargetScoringAttempt ?? 0) + (p.shotOffTarget ?? 0) + (p.blockedScoringAttempt ?? 0);
  return {
    playerId: p.playerId,
    name: p.name,
    jerseyNo: p.jerseyNo ?? 0,
    position: p.position ?? "",
    isSubstitute: p.isSubstitute ?? false,
    minutesPlayed: p.minutesPlayed ?? 0,
    rating: p.rating ?? 0,
    goals, assists, goalOrAssist: goals + assists,
    shots, shotsOnTarget: p.onTargetScoringAttempt ?? 0,
    passes: p.totalPass ?? 0, accuratePasses: p.accuratePass ?? 0,
    crosses: p.totalCross ?? 0, tackles: p.totalTackle ?? 0,
    interceptions: p.interceptionWon ?? 0,
    fouls, foulsWon, foulInvolvements: fouls + foulsWon,
    yellowCard: !!(p.yellowCard), redCard: !!(p.redCard),
    saves: p.saves ?? 0, xG, xA, xGxA: xG + xA,
    dispossessed: p.dispossessed ?? 0,
    possessionLost: p.possessionLostCtrl ?? 0,
    offsides: p.totalOffside ?? 0,
    clearances: p.totalClearance ?? 0,
    keyPasses: p.keyPass ?? 0,
    bigChancesCreated: p.bigChanceCreated ?? 0,
    duelWon: p.duelWon ?? 0, duelLost: p.duelLost ?? 0,
    aerialWon: p.aerialWon ?? 0,
  };
}

async function fetchPlayerStats(teamId: number): Promise<unknown[]> {
  try {
    const resp = await fetch(
      `${SH_BASE}/api/team/${teamId}/last-games?page=1&limit=10`,
      { headers: SH_HEADERS, signal: AbortSignal.timeout(15000) }
    );
    if (!resp.ok) return [];
    const json = (await resp.json()) as { data?: RawPlayerGame[] };
    const games = json.data ?? [];

    const sorted = [...games].sort((a, b) => b.events.timeStartTimestamp - a.events.timeStartTimestamp);

    return sorted.slice(0, 10).map(g => {
      const isHome = g.events.homeTeamId === teamId;
      const lineup = (isHome ? g.homeTeamLineup : g.awayTeamLineup) ?? [];
      return {
        eventId: g.events.id,
        date: g.events.timeStartTimestamp,
        homeTeam: g.homeTeam.name,
        awayTeam: g.awayTeam.name,
        homeScore: g.events.homeScoreCurrent ?? 0,
        awayScore: g.events.awayScoreCurrent ?? 0,
        isHome,
        players: lineup.map(parsePlayer),
      };
    });
  } catch {
    return [];
  }
}

// ── Main job runner ──────────────────────────────────────────────────────────

async function runJob(jobId: string, params: StartProcessingParams) {
  if (runningJobs.has(jobId)) return;
  runningJobs.add(jobId);

  const log = (msg: string) => {
    console.log(`[ProcessingJob ${jobId}]`, msg);
    appendProcessingLog(jobId, msg);
  };

  try {
    updateProcessingJob(jobId, { status: "running" });
    log(`Starting processing for date: ${params.date}`);

    // ── Stage 1: Fetch all fixtures from StatsHub ────────────────────────────
    log(`Fetching fixtures from StatsHub…`);
    let fixtures: ParsedFixture[] = [];
    try {
      fixtures = await fetchFixturesForDate(params.date);
      log(`Found ${fixtures.length} fixture(s) on StatsHub for ${params.date}`);
    } catch (e) {
      log(`⚠ StatsHub fixtures failed: ${e}`);
      updateProcessingJob(jobId, { status: "failed", error_message: String(e) });
      return;
    }

    if (fixtures.length === 0) {
      log(`No fixtures found for ${params.date}. Job complete.`);
      updateProcessingJob(jobId, { status: "complete", total_matches: 0 });
      return;
    }

    updateProcessingJob(jobId, { total_matches: fixtures.length });

    // ── Stage 2: Fetch odds from BetExplorer (plain HTTP) ───────────────────
    log(`Fetching odds from BetExplorer.com for ${params.date}…`);
    let beMatches: BEMatch[] = [];
    try {
      beMatches = await fetchBetExplorerMatches(params.date, log);
      const withOdds = beMatches.filter(m => m.bestHomeOdds !== null).length;
      log(`BetExplorer: ${beMatches.length} match(es) found, ${withOdds} with best 1x2 odds available`);
    } catch (e) {
      log(`⚠ BetExplorer fetch failed: ${e} — continuing without odds`);
    }

    // ── Stage 3: Process each fixture ───────────────────────────────────────
    let processed = 0;
    let stored = 0;

    for (const fx of fixtures) {
      processed++;
      const label = `${fx.homeTeamName} vs ${fx.awayTeamName}`;
      updateProcessingJob(jobId, { processed, stored, current_match: label });
      log(`[${processed}/${fixtures.length}] ${label} (${fx.leagueName}, ${fx.countryName})`);

      // Fetch team stats, player stats in parallel
      const matchTs = fx.kickoffTs || undefined;
      const [[homeTeamStats, awayTeamStats], [homePlayerStats, awayPlayerStats]] = await Promise.all([
        Promise.all([
          fetchStatsHubTeamHistory(fx.homeTeamId, matchTs).catch(() => null),
          fetchStatsHubTeamHistory(fx.awayTeamId, matchTs).catch(() => null),
        ]),
        Promise.all([
          fetchPlayerStats(fx.homeTeamId),
          fetchPlayerStats(fx.awayTeamId),
        ]),
      ]);

      const homeStatMatches = homeTeamStats?.statHistory?.[0]?.matches?.length ?? 0;
      const awayStatMatches = awayTeamStats?.statHistory?.[0]?.matches?.length ?? 0;
      const bothTeamStatsNull = homeTeamStats === null && awayTeamStats === null;
      const oneTeamStatNull   = (homeTeamStats === null) !== (awayTeamStats === null);

      log(`  ↳ Team stats: home=${homeTeamStats ? homeStatMatches + " match(es)" : "n/a"}, away=${awayTeamStats ? awayStatMatches + " match(es)" : "n/a"}${bothTeamStatsNull ? " (no league data — likely international)" : ""}`);
      log(`  ↳ Player stats: home=${homePlayerStats.length} games, away=${awayPlayerStats.length} games`);

      // ── Condition 1: Match must be finished (score known, not in-progress/not-started) ──
      const finishedStatuses = ["notstarted", "inprogress", "postponed", "cancelled", "abandoned"];
      const isFinished = !finishedStatuses.includes(fx.status.toLowerCase()) &&
                         fx.homeScore !== null && fx.awayScore !== null;
      if (!isFinished) {
        log(`  ↳ ⏭ Skipped — match not finished (status="${fx.status}", score=${fx.homeScore ?? "?"}:${fx.awayScore ?? "?"})`);
        continue;
      }

      // ── Condition 2: Team stats must exist for both sides ──
      // Exception: if NEITHER team has StatsHub league data (e.g. international/national teams),
      // we allow the match through — it will be stored based on conditions 1 & 4 alone.
      if (oneTeamStatNull) {
        // One team has stats, the other doesn't — asymmetric data, skip.
        log(`  ↳ ⏭ Skipped — team stats only available for one side`);
        continue;
      }
      if (!bothTeamStatsNull && (homeStatMatches === 0 || awayStatMatches === 0)) {
        // Both have StatsHub objects but match history is empty — genuine data gap.
        log(`  ↳ ⏭ Skipped — team stats exist but match history is empty (home=${homeStatMatches}, away=${awayStatMatches})`);
        continue;
      }

      // ── Condition 3: Player stats must exist for both sides ──
      // Also waived for international matches (bothTeamStatsNull) where StatsHub
      // last-games data may not cover national team fixtures.
      if (!bothTeamStatsNull && (homePlayerStats.length === 0 || awayPlayerStats.length === 0)) {
        log(`  ↳ ⏭ Skipped — player stats missing (home=${homePlayerStats.length}, away=${awayPlayerStats.length})`);
        continue;
      }

      // Find match on BetExplorer and fetch per-bookmaker market odds
      const beMatch = findBestBEMatch(fx.homeTeamName, fx.awayTeamName, beMatches);
      let markets: BEMatchMarkets | null = null;

      if (beMatch) {
        const oddStr = `H=${beMatch.bestHomeOdds} D=${beMatch.bestDrawOdds} A=${beMatch.bestAwayOdds}`;
        log(`  ↳ BetExplorer: matched "${beMatch.homeTeam} vs ${beMatch.awayTeam}" — ${oddStr}`);
        try {
          markets = await fetchMatchMarkets(beMatch.matchId, beMatch.matchUrl, log);
          const total = Object.values(markets).reduce((s, arr) => s + arr.length, 0);
          log(`  ↳ BetExplorer: ${total} total bookmaker-market entries stored`);
        } catch (e) {
          log(`  ↳ BetExplorer: market fetch failed: ${e}`);
        }
      } else {
        log(`  ↳ BetExplorer: no match found`);
      }

      // ── Condition 4: 1x2 odds from BetExplorer must be present ──
      const has1x2 = markets?.["1x2"] && markets["1x2"].length > 0;
      if (!has1x2) {
        log(`  ↳ ⏭ Skipped — BetExplorer 1x2 odds not available`);
        continue;
      }

      const toJson = (arr: unknown[] | undefined) =>
        arr && arr.length > 0 ? JSON.stringify(arr) : null;

      insertProcessingMatch({
        job_id:               jobId,
        date:                 params.date,
        home_team:            fx.homeTeamName,
        away_team:            fx.awayTeamName,
        home_team_id:         fx.homeTeamId,
        away_team_id:         fx.awayTeamId,
        league_name:          fx.leagueName,
        league_id:            fx.leagueId,
        country_name:         fx.countryName,
        country_flag:         fx.countryFlag,
        kickoff_ts:           fx.kickoffTs,
        home_score:           fx.homeScore,
        away_score:           fx.awayScore,
        status:               fx.status,
        home_team_stats_json:    homeTeamStats   ? JSON.stringify(homeTeamStats)   : null,
        away_team_stats_json:    awayTeamStats   ? JSON.stringify(awayTeamStats)   : null,
        home_player_stats_json:  homePlayerStats.length ? JSON.stringify(homePlayerStats) : null,
        away_player_stats_json:  awayPlayerStats.length ? JSON.stringify(awayPlayerStats) : null,
        po_1x2_json:   toJson(markets?.["1x2"]),
        po_ou_json:    toJson(markets?.ou),
        po_ah_json:    toJson(markets?.ah),
        po_btts_json:  toJson(markets?.btts),
        po_dc_json:    toJson(markets?.dc),
        po_dnb_json:   toJson(markets?.dnb),
        po_cs_json:    null,
        po_eh_json:    null,
        po_htft_json:  null,
        po_oe_json:    null,
        po_wtbh_json:  null,
      });

      stored++;
      log(`  ↳ ✓ Stored`);
      // Brief pause between fixtures (per-market calls already have 900ms delays)
      await new Promise(r => setTimeout(r, 300));
    }

    updateProcessingJob(jobId, {
      status: "complete",
      processed,
      stored,
      current_match: null,
    });
    log(`✅ Done. Stored ${stored}/${fixtures.length} matches for ${params.date}`);

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log(`❌ Fatal: ${msg}`);
    updateProcessingJob(jobId, { status: "failed", error_message: msg, current_match: null });
  } finally {
    runningJobs.delete(jobId);
  }
}
