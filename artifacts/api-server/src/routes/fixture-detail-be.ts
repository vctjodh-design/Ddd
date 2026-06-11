import { Router } from "express";
import {
  fetchMatchPageData,
  fetchBETeamStats,
  fetchMatchMarkets,
  type BETeamResult,
} from "../lib/betExplorer.js";

const router = Router();

interface MatchRow {
  eventId: number;
  date: number;
  homeTeamName: string;
  awayTeamName: string;
  homeScore: number;
  awayScore: number;
  tournamentName: string;
  isHome: boolean;
}

interface SHMatchStatRow {
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

function beResultsToMatches(results: BETeamResult[], teamName: string): MatchRow[] {
  const now = Math.floor(Date.now() / 1000);
  return results.map((r, i) => ({
    eventId: i + 1,
    date: now - (results.length - i) * 7 * 86400,
    homeTeamName: r.isHome ? teamName : r.opponent,
    awayTeamName: r.isHome ? r.opponent : teamName,
    homeScore: r.isHome ? r.goalsScored : r.goalsConceded,
    awayScore: r.isHome ? r.goalsConceded : r.goalsScored,
    tournamentName: "",
    isHome: r.isHome,
  }));
}

function beResultsToStatHistory(results: BETeamResult[], teamName: string) {
  const now = Math.floor(Date.now() / 1000);
  const goalsMatches: SHMatchStatRow[] = results.map((r, i) => {
    const ts = now - (results.length - i) * 7 * 86400;
    const d = new Date(ts * 1000);
    const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const homeTeam = r.isHome ? teamName : r.opponent;
    const awayTeam = r.isHome ? r.opponent : teamName;
    const homeScore = r.isHome ? r.goalsScored : r.goalsConceded;
    const awayScore = r.isHome ? r.goalsConceded : r.goalsScored;
    return {
      eventId: i + 1,
      date: dateStr,
      homeTeam,
      awayTeam,
      homeScore,
      awayScore,
      homeValue: homeScore,
      awayValue: awayScore,
      myValue: r.goalsScored,
      opponentValue: r.goalsConceded,
      result: r.result,
    };
  });

  const concededMatches: SHMatchStatRow[] = results.map((r, i) => {
    const ts = now - (results.length - i) * 7 * 86400;
    const d = new Date(ts * 1000);
    const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const homeTeam = r.isHome ? teamName : r.opponent;
    const awayTeam = r.isHome ? r.opponent : teamName;
    const homeScore = r.isHome ? r.goalsScored : r.goalsConceded;
    const awayScore = r.isHome ? r.goalsConceded : r.goalsScored;
    return {
      eventId: i + 1,
      date: dateStr,
      homeTeam,
      awayTeam,
      homeScore,
      awayScore,
      homeValue: homeScore,
      awayValue: awayScore,
      myValue: r.goalsConceded,
      opponentValue: r.goalsScored,
      result: r.result,
    };
  });

  return [
    { key: "goals", label: "Goals", matches: goalsMatches },
    { key: "goalkeeper_saves", label: "Goalkeeper Saves", matches: concededMatches },
  ];
}

router.get("/fixture/be/:matchId", async (req, res) => {
  const { matchId } = req.params;
  const {
    matchUrl = "",
    homeTeam: homeTeamName = "Home",
    awayTeam: awayTeamName = "Away",
    league = "",
    kickoff = "0",
  } = req.query as Record<string, string>;

  try {
    const marketsPromise = fetchMatchMarkets(matchId, undefined, undefined);

    let matchPageData: Awaited<ReturnType<typeof fetchMatchPageData>> = null;
    let homeStats: Awaited<ReturnType<typeof fetchBETeamStats>> = null;
    let awayStats: Awaited<ReturnType<typeof fetchBETeamStats>> = null;

    if (matchUrl) {
      matchPageData = await fetchMatchPageData(matchUrl);
      if (matchPageData) {
        [homeStats, awayStats] = await Promise.all([
          fetchBETeamStats(matchPageData.homeSlug, matchPageData.homeId, 20),
          fetchBETeamStats(matchPageData.awaySlug, matchPageData.awayId, 20),
        ]);
      }
    }

    const markets = await marketsPromise;
    const kickoffTs = parseInt(kickoff) || 0;
    const homeScore = matchPageData?.homeScore ?? null;
    const awayScore = matchPageData?.awayScore ?? null;

    const homeMatches = homeStats?.results ? beResultsToMatches(homeStats.results, homeTeamName) : [];
    const awayMatches = awayStats?.results ? beResultsToMatches(awayStats.results, awayTeamName) : [];
    const homeStatHistory = homeStats?.results ? beResultsToStatHistory(homeStats.results, homeTeamName) : [];
    const awayStatHistory = awayStats?.results ? beResultsToStatHistory(awayStats.results, awayTeamName) : [];

    const statusVal = (homeScore !== null || awayScore !== null) ? "finished" : "notstarted";

    res.json({
      fixture: {
        id: 0,
        eventId: 0,
        slug: matchId,
        status: statusVal,
        homeTeam: { id: 0, name: homeTeamName, slug: "", colorPrimary: null, colorSecondary: null },
        awayTeam: { id: 0, name: awayTeamName, slug: "", colorPrimary: null, colorSecondary: null },
        homeScore,
        awayScore,
        kickoffTimestamp: kickoffTs,
        leagueName: league,
        winnerCode:
          homeScore !== null && awayScore !== null
            ? homeScore > awayScore ? 100 : awayScore > homeScore ? 200 : 300
            : null,
      },
      home: {
        matches: homeMatches,
        players: [],
        matchDates: homeMatches.map((m) => m.date),
        possession: 0,
        statHistory: homeStatHistory,
        beStats: homeStats ?? null,
      },
      away: {
        matches: awayMatches,
        players: [],
        matchDates: awayMatches.map((m) => m.date),
        possession: 0,
        statHistory: awayStatHistory,
        beStats: awayStats ?? null,
      },
      markets,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to fetch BE fixture detail");
    res.status(500).json({ error: "Failed to fetch BE fixture detail" });
  }
});

export default router;
