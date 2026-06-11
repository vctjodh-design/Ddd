/**
 * Processing job runner — date-based pipeline.
 *
 * BetExplorer is the PRIMARY fixture source.
 * StatsHub is used as ENRICHMENT when a match can be fuzzy-matched.
 *
 * For each finished BE match:
 *   - If found on StatsHub: use full SH pipeline (team stats + player stats + BE odds)
 *   - If not on StatsHub: fetch BE team page stats + BE odds, store as 'betexplorer' source
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
  fetchMatchPageData,
  fetchBETeamStats,
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

export async function fetchPlayerStats(teamId: number): Promise<unknown[]> {
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

// ── SH fuzzy-match helper ─────────────────────────────────────────────────────

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

    // ── Stage 1: Fetch BetExplorer fixtures (primary source) ─────────────────
    log(`Fetching fixtures from BetExplorer (primary source)…`);
    let beMatches: BEMatch[] = [];
    try {
      beMatches = await fetchBetExplorerMatches(params.date, log);
      const finished = beMatches.filter(m => m.isFinished).length;
      log(`BetExplorer: ${beMatches.length} match(es) total, ${finished} finished, ${beMatches.length - finished} upcoming`);
    } catch (e) {
      log(`⚠ BetExplorer fetch failed: ${e}`);
      updateProcessingJob(jobId, { status: "failed", error_message: String(e) });
      return;
    }

    const finishedBeMatches = beMatches.filter(m => m.isFinished);
    if (finishedBeMatches.length === 0) {
      log(`No finished fixtures found on BetExplorer for ${params.date}. Job complete.`);
      updateProcessingJob(jobId, { status: "complete", total_matches: 0 });
      return;
    }

    // ── Stage 1b: Fetch StatsHub fixtures in parallel (enrichment) ───────────
    log(`Fetching StatsHub fixtures (enrichment)…`);
    let shFixtures: ParsedFixture[] = [];
    try {
      shFixtures = await fetchFixturesForDate(params.date);
      log(`StatsHub: ${shFixtures.length} fixture(s) found`);
    } catch (e) {
      log(`⚠ StatsHub fetch failed: ${e} — continuing in BE-only mode`);
    }

    updateProcessingJob(jobId, { total_matches: finishedBeMatches.length });

    let processed = 0;
    let stored = 0;

    for (const beMatch of finishedBeMatches) {
      processed++;
      const label = `${beMatch.homeTeam} vs ${beMatch.awayTeam}`;
      updateProcessingJob(jobId, { processed, stored, current_match: label });
      log(`[${processed}/${finishedBeMatches.length}] ${label} (${beMatch.league ?? "Unknown"}, ${beMatch.country ?? "Unknown"})`);

      // Try to find this match on StatsHub
      const shFx = findSHFixture(beMatch, shFixtures);

      if (shFx) {
        // ── StatsHub-enriched path ───────────────────────────────────────────
        log(`  ↳ StatsHub match: ${shFx.homeTeamName} vs ${shFx.awayTeamName} (${shFx.status})`);

        const matchTs = shFx.kickoffTs || undefined;
        const [[homeTeamStats, awayTeamStats], [homePlayerStats, awayPlayerStats]] = await Promise.all([
          Promise.all([
            fetchStatsHubTeamHistory(shFx.homeTeamId, matchTs).catch(() => null),
            fetchStatsHubTeamHistory(shFx.awayTeamId, matchTs).catch(() => null),
          ]),
          Promise.all([
            fetchPlayerStats(shFx.homeTeamId),
            fetchPlayerStats(shFx.awayTeamId),
          ]),
        ]);

        const homeStatMatches = homeTeamStats?.statHistory?.[0]?.matches?.length ?? 0;
        const awayStatMatches = awayTeamStats?.statHistory?.[0]?.matches?.length ?? 0;
        const bothTeamStatsNull = homeTeamStats === null && awayTeamStats === null;
        const oneTeamStatNull   = (homeTeamStats === null) !== (awayTeamStats === null);

        log(`  ↳ Team stats: home=${homeTeamStats ? homeStatMatches + " match(es)" : "n/a"}, away=${awayTeamStats ? awayStatMatches + " match(es)" : "n/a"}${bothTeamStatsNull ? " (no league data)" : ""}`);
        log(`  ↳ Player stats: home=${homePlayerStats.length} games, away=${awayPlayerStats.length} games`);

        const finishedStatuses = ["notstarted", "inprogress", "postponed", "cancelled", "abandoned"];
        const isFinished = !finishedStatuses.includes(shFx.status.toLowerCase()) &&
                           shFx.homeScore !== null && shFx.awayScore !== null;
        if (!isFinished) {
          log(`  ↳ ⏭ Skipped — SH match not finished (status="${shFx.status}")`);
          continue;
        }
        if (oneTeamStatNull) {
          log(`  ↳ ⏭ Skipped — team stats only available for one side`);
          continue;
        }
        if (!bothTeamStatsNull && (homeStatMatches === 0 || awayStatMatches === 0)) {
          log(`  ↳ ⏭ Skipped — team stat history empty`);
          continue;
        }
        if (!bothTeamStatsNull && (homePlayerStats.length === 0 || awayPlayerStats.length === 0)) {
          log(`  ↳ ⏭ Skipped — player stats missing`);
          continue;
        }

        // Fetch odds
        let markets: BEMatchMarkets | null = null;
        try {
          markets = await fetchMatchMarkets(beMatch.matchId, beMatch.matchUrl, log);
          const total = Object.values(markets).reduce((s, arr) => s + arr.length, 0);
          log(`  ↳ BetExplorer: ${total} bookmaker-market entries`);
        } catch (e) {
          log(`  ↳ BetExplorer: odds fetch failed: ${e}`);
        }

        const has1x2 = markets?.["1x2"] && markets["1x2"].length > 0;
        if (!has1x2) { log(`  ↳ ⏭ Skipped — 1x2 odds unavailable`); continue; }

        const toJson = (arr: unknown[] | undefined) => arr && arr.length > 0 ? JSON.stringify(arr) : null;

        insertProcessingMatch({
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
          kickoff_ts:           shFx.kickoffTs,
          home_score:           shFx.homeScore,
          away_score:           shFx.awayScore,
          status:               shFx.status,
          home_team_stats_json: homeTeamStats   ? JSON.stringify(homeTeamStats)   : null,
          away_team_stats_json: awayTeamStats   ? JSON.stringify(awayTeamStats)   : null,
          home_player_stats_json: homePlayerStats.length ? JSON.stringify(homePlayerStats) : null,
          away_player_stats_json: awayPlayerStats.length ? JSON.stringify(awayPlayerStats) : null,
          po_1x2_json:  toJson(markets?.["1x2"]),
          po_ou_json:   toJson(markets?.ou),
          po_ah_json:   toJson(markets?.ah),
          po_btts_json: toJson(markets?.btts),
          po_dc_json:   toJson(markets?.dc),
          po_dnb_json:  toJson(markets?.dnb),
          data_source:          "statshub",
          be_home_stats_json:   null,
          be_away_stats_json:   null,
        });
        stored++;
        log(`  ↳ ✓ Stored (StatsHub)`);

      } else {
        // ── BE-only path ─────────────────────────────────────────────────────
        log(`  ↳ Not on StatsHub — using BetExplorer team stats`);

        // Fetch match page to get team links + score
        const matchData = await fetchMatchPageData(beMatch.matchUrl, log);
        if (!matchData) {
          log(`  ↳ ⏭ Skipped — couldn't extract team links from match page`);
          await new Promise(r => setTimeout(r, 2000));
          continue;
        }

        // Fetch BE team stats with 3 s delay between requests (rate-limit safety)
        const homeTeamStats = await fetchBETeamStats(matchData.homeSlug, matchData.homeId, 20, log);
        await new Promise(r => setTimeout(r, 3000));
        const awayTeamStats = await fetchBETeamStats(matchData.awaySlug, matchData.awayId, 20, log);

        log(`  ↳ BE team stats: home=${homeTeamStats ? `${homeTeamStats.totalGames} games, avg GS=${homeTeamStats.avgGoalsScored.toFixed(2)}` : "n/a"}, away=${awayTeamStats ? `${awayTeamStats.totalGames} games, avg GS=${awayTeamStats.avgGoalsScored.toFixed(2)}` : "n/a"}`);

        // Fetch all 6 markets
        let markets: BEMatchMarkets | null = null;
        try {
          markets = await fetchMatchMarkets(beMatch.matchId, beMatch.matchUrl, log);
          const total = Object.values(markets).reduce((s, arr) => s + arr.length, 0);
          log(`  ↳ BetExplorer: ${total} bookmaker-market entries`);
        } catch (e) {
          log(`  ↳ BetExplorer: odds fetch failed: ${e}`);
        }

        const has1x2 = markets?.["1x2"] && markets["1x2"].length > 0;
        if (!has1x2) { log(`  ↳ ⏭ Skipped — 1x2 odds unavailable`); continue; }

        const toJson = (arr: unknown[] | undefined) => arr && arr.length > 0 ? JSON.stringify(arr) : null;

        // Kickoff timestamp from time string + date
        const [y, mo, d] = params.date.split("-").map(Number);
        const [h, min] = beMatch.kickoffTime.split(":").map(Number);
        const kickoffTs = Math.floor(Date.UTC(y, mo - 1, d, h, min, 0) / 1000);

        insertProcessingMatch({
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
          home_score:    matchData.homeScore,
          away_score:    matchData.awayScore,
          status:        "finished",
          home_team_stats_json:   null,
          away_team_stats_json:   null,
          home_player_stats_json: null,
          away_player_stats_json: null,
          po_1x2_json:  toJson(markets?.["1x2"]),
          po_ou_json:   toJson(markets?.ou),
          po_ah_json:   toJson(markets?.ah),
          po_btts_json: toJson(markets?.btts),
          po_dc_json:   toJson(markets?.dc),
          po_dnb_json:  toJson(markets?.dnb),
          data_source:        "betexplorer",
          be_home_stats_json: homeTeamStats ? JSON.stringify(homeTeamStats) : null,
          be_away_stats_json: awayTeamStats ? JSON.stringify(awayTeamStats) : null,
        });
        stored++;
        log(`  ↳ ✓ Stored (BetExplorer)`);
      }

      // Brief pause between fixtures
      await new Promise(r => setTimeout(r, 300));
    }

    updateProcessingJob(jobId, {
      status: "complete",
      processed,
      stored,
      current_match: null,
    });
    log(`✅ Done. Stored ${stored}/${finishedBeMatches.length} finished matches for ${params.date} (${shFixtures.length > 0 ? "SH enrichment available" : "BE-only mode"})`);

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log(`❌ Fatal: ${msg}`);
    updateProcessingJob(jobId, { status: "failed", error_message: msg, current_match: null });
  } finally {
    runningJobs.delete(jobId);
  }
}
