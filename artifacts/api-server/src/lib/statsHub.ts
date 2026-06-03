/**
 * StatsHub.com integration
 * Fetches per-season aggregate stats + per-match historical stat rows for each team.
 */

const SH_BASE = "https://www.statshub.com";
const SH_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "application/json",
  Referer: "https://www.statshub.com/",
  "Accept-Language": "en-US,en;q=0.9",
};

const CACHE_TTL = 30 * 60 * 1000;
const cache = new Map<string, { data: unknown; ts: number }>();

async function shFetch(path: string): Promise<unknown> {
  const key = path;
  const cached = cache.get(key);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.data;

  const url = `${SH_BASE}${path}`;
  const resp = await fetch(url, { headers: SH_HEADERS, signal: AbortSignal.timeout(15000) });
  if (!resp.ok) throw new Error(`StatsHub ${resp.status} for ${path}`);
  const json = await resp.json();
  cache.set(key, { data: json, ts: Date.now() });
  return json;
}

interface TournamentsAndSeasons {
  [uniqueTournamentId: string]: {
    tournamentName: string;
    isNational: boolean;
    seasons: Array<{ seasonId: number; seasonName: string }>;
  };
}

interface EventStatRow {
  event_id: number;
  home_team_id: number;
  away_team_id: number;
  time_start_timestamp: string;
  home_score: number;
  away_score: number;
  home_value: string;
  away_value: string;
  home_team_name: string;
  away_team_name: string;
  home_team_slug: string;
  away_team_slug: string;
}

interface EventStatResponse {
  data: EventStatRow[];
}

export interface SHMatchStatRow {
  eventId: number;
  date: string;
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
  homeValue: number;
  awayValue: number;
  myValue: number;
  opponentValue: number;
  result: "W" | "D" | "L";
}

export interface SHStatHistory {
  key: string;
  label: string;
  matches: SHMatchStatRow[];
}

export interface SHTeamStatHistory {
  teamId: number;
  possession: number;
  statHistory: SHStatHistory[];
}

// Maps label → event-statistics statisticKey
const TEAM_STAT_KEYS: Array<{ label: string; key: string }> = [
  { label: "Goals",                   key: "_goals_from_score" },
  { label: "Corners",                 key: "cornerKicks" },
  { label: "Shots",                   key: "shots" },
  { label: "Cards",                   key: "_cards" },
  { label: "Crosses",                 key: "accurateCross" },
  { label: "Big Chance Created",      key: "bigChanceCreated" },
  { label: "Big Chance Missed",       key: "bigChanceMissed" },
  { label: "Big Chance Scored",       key: "bigChanceScored" },
  { label: "Expected Goals",          key: "expectedGoals" },
  { label: "Shots On Goal",           key: "shotsOnGoal" },
  { label: "Shots Off Goal",          key: "shotsOffGoal" },
  { label: "Total Shots Inside Box",  key: "totalShotsInsideBox" },
  { label: "Total Shots Outside Box", key: "totalShotsOutsideBox" },
  { label: "Total Clearance",         key: "totalClearance" },
  { label: "Dispossessed",            key: "dispossessed" },
  { label: "Errors Lead To Goal",     key: "errorsLeadToGoal" },
  { label: "Errors Lead To Shot",     key: "errorsLeadToShot" },
  { label: "Fouls",                   key: "fouls" },
  { label: "Goalkeeper Saves",        key: "goalkeeperSaves" },
  { label: "Interception Won",        key: "interceptionWon" },
  { label: "Tackles",                 key: "tackles" },
  { label: "Free Kicks",              key: "freeKicks" },
  { label: "Goal Kicks",              key: "goalKicks" },
  { label: "Throw Ins",               key: "throwIns" },
  { label: "Possession",              key: "ballPossession" },
  { label: "Offsides",                key: "offsides" },
  { label: "Passes",                  key: "passes" },
  { label: "Touches In Opp Box",      key: "touchesInOppBox" },
  { label: "Red Cards",               key: "redCards" },
  { label: "Yellow Cards",            key: "yellowCards" },
];

const CUP_KEYWORDS = /champions|europa|conference|cup|copa|pokal|coupe|coppa|carabao|fa cup|league cup|supercopa|super cup|supercoupe|supercup|playoff|fa trophy/i;

function candidateLeagues(ts: TournamentsAndSeasons) {
  const entries = Object.entries(ts);
  if (!entries.length) return [];
  const nonNat = entries.filter(([, v]) => !v.isNational);
  const domestic = nonNat.filter(([, v]) => !CUP_KEYWORDS.test(v.tournamentName));
  const pool = domestic.length ? domestic : nonNat.length ? nonNat : entries;
  return pool.slice(0, 4).map(([utid, info]) => ({
    utid,
    seasonId: info.seasons[0]?.seasonId,
    tournamentName: info.tournamentName,
    seasonName: info.seasons[0]?.seasonName ?? "",
  })).filter(c => c.seasonId != null) as Array<{ utid: string; seasonId: number; tournamentName: string; seasonName: string }>;
}

async function fetchStatHistory(
  teamId: number,
  utid: string,
  seasonId: number,
  statDef: { label: string; key: string },
  eventTimestamp?: number,
  limit = 20
): Promise<SHStatHistory | null> {
  try {
    let rows: EventStatRow[];

    if (statDef.key === "_goals_from_score" || statDef.key === "_cards") {
      const resp = await shFetch(
        `/api/team/${teamId}/event-statistics?uniqueTournamentId=${utid}&seasonId=${seasonId}&statisticKey=fouls`
      ) as EventStatResponse;
      if (statDef.key === "_goals_from_score") {
        rows = (resp.data || []).map(r => ({
          ...r,
          home_value: String(r.home_score),
          away_value: String(r.away_score),
        }));
      } else {
        // _cards: not individually trackable per-match from event-stats, skip
        return null;
      }
    } else {
      const resp = await shFetch(
        `/api/team/${teamId}/event-statistics?uniqueTournamentId=${utid}&seasonId=${seasonId}&statisticKey=${statDef.key}`
      ) as EventStatResponse;
      rows = resp.data || [];
    }

    if (!rows.length) return null;

    const cutoff = eventTimestamp ? eventTimestamp * 1000 : Date.now();

    const sorted = rows
      .filter(r => parseInt(r.time_start_timestamp) * 1000 < cutoff)
      .sort((a, b) => parseInt(b.time_start_timestamp) - parseInt(a.time_start_timestamp))
      .slice(0, limit);

    if (!sorted.length) return null;

    const matches: SHMatchStatRow[] = sorted.map(r => {
      const isHome = r.home_team_id === teamId;
      const homeVal = parseFloat(r.home_value) || 0;
      const awayVal = parseFloat(r.away_value) || 0;

      const ts = parseInt(r.time_start_timestamp) * 1000;
      const d = new Date(ts);
      const date = `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getFullYear()).slice(2)}`;

      const result: "W" | "D" | "L" =
        r.home_score > r.away_score
          ? isHome ? "W" : "L"
          : r.home_score < r.away_score
          ? isHome ? "L" : "W"
          : "D";

      return {
        eventId: r.event_id,
        date,
        homeTeam: r.home_team_name,
        awayTeam: r.away_team_name,
        homeScore: r.home_score,
        awayScore: r.away_score,
        homeValue: homeVal,
        awayValue: awayVal,
        myValue: isHome ? homeVal : awayVal,
        opponentValue: isHome ? awayVal : homeVal,
        result,
      };
    });

    return { key: statDef.key, label: statDef.label, matches };
  } catch {
    return null;
  }
}

export async function fetchStatsHubTeamHistory(
  teamId: number,
  eventTimestamp?: number
): Promise<SHTeamStatHistory | null> {
  try {
    const ts = (await shFetch(`/api/team/${teamId}/tournaments-and-seasons`)) as TournamentsAndSeasons;
    const candidates = candidateLeagues(ts);
    if (!candidates.length) return null;

    // Pick the candidate league with most events
    const eventsPerCandidate = await Promise.all(
      candidates.slice(0, 2).map(async c => {
        try {
          const resp = await shFetch(
            `/api/team/${teamId}/event-statistics?uniqueTournamentId=${c.utid}&seasonId=${c.seasonId}&statisticKey=fouls`
          ) as EventStatResponse;
          return { league: c, count: (resp.data || []).length };
        } catch {
          return { league: c, count: 0 };
        }
      })
    );

    const best = eventsPerCandidate.sort((a, b) => b.count - a.count)[0];
    if (!best || best.count === 0) return null;

    const { utid, seasonId } = best.league;

    // Fetch possession from team statistics
    let possession = 0;
    try {
      const statsResp = (await shFetch(
        `/api/team/${teamId}/statistics?uniqueTournamentId=${utid}&seasonId=${seasonId}`
      )) as { data: { averageBallPossession?: string } };
      possession = parseFloat(statsResp.data?.averageBallPossession ?? "0") || 0;
    } catch { /* ignore */ }

    // Fetch per-match stat history for all team stat keys in parallel
    const historyResults = await Promise.all(
      TEAM_STAT_KEYS.map(def =>
        fetchStatHistory(teamId, utid, seasonId, def, eventTimestamp, 20)
      )
    );

    const statHistory = historyResults.filter((h): h is SHStatHistory => h !== null);

    return { teamId, possession, statHistory };
  } catch (err) {
    console.error(`[StatsHub] fetchStatsHubTeamHistory(${teamId}) error:`, err);
    return null;
  }
}
