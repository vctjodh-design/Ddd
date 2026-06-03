import { Router } from "express";
import { fetchStatsHubTeamHistory } from "../lib/statsHub.js";

const router = Router();

const STATSHUB_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept: "application/json, */*",
  Referer: "https://www.statshub.com/",
};

interface RawPlayer {
  playerId: number;
  name: string;
  jerseyNo?: number;
  position?: string;
  minutesPlayed?: number;
  substitutedIn?: number | null;
  substitutedOut?: number | null;
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
  totalLongBalls?: number;
  accurateLongBalls?: number;
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

interface RawGame {
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

export interface PlayerMatchStats {
  minutesPlayed: number;
  isSubstitute: boolean;
  goals: number;
  assists: number;
  goalOrAssist: number;
  shots: number;
  shotsOnTarget: number;
  shotsOffTarget: number;
  blockedShots: number;
  passes: number;
  accuratePasses: number;
  crosses: number;
  accurateCrosses: number;
  longBalls: number;
  accurateLongBalls: number;
  tackles: number;
  interceptions: number;
  fouls: number;
  foulsWon: number;
  foulInvolvements: number;
  yellowCard: boolean;
  redCard: boolean;
  saves: number;
  xG: number;
  xA: number;
  xGxA: number;
  bigChancesCreated: number;
  keyPasses: number;
  offsides: number;
  dispossessed: number;
  possessionLost: number;
  clearances: number;
  duelWon: number;
  duelLost: number;
  aerialWon: number;
  wonContest: number;
}

function parsePlayerStats(p: RawPlayer): PlayerMatchStats {
  const shots =
    (p.onTargetScoringAttempt ?? 0) +
    (p.shotOffTarget ?? 0) +
    (p.blockedScoringAttempt ?? 0);
  const goals = p.goals ?? 0;
  const assists = p.assists ?? 0;
  const fouls = p.fouls ?? 0;
  const foulsWon = p.wasFouled ?? 0;
  const xG = parseFloat(p.expectedGoals ?? "0") || 0;
  const xA = parseFloat(p.expectedAssists ?? "0") || 0;

  return {
    minutesPlayed: p.minutesPlayed ?? 0,
    isSubstitute: p.isSubstitute ?? false,
    goals,
    assists,
    goalOrAssist: goals + assists,
    shots,
    shotsOnTarget: p.onTargetScoringAttempt ?? 0,
    shotsOffTarget: p.shotOffTarget ?? 0,
    blockedShots: p.blockedScoringAttempt ?? 0,
    passes: p.totalPass ?? 0,
    accuratePasses: p.accuratePass ?? 0,
    crosses: p.totalCross ?? 0,
    accurateCrosses: p.accurateCross ?? 0,
    longBalls: p.totalLongBalls ?? 0,
    accurateLongBalls: p.accurateLongBalls ?? 0,
    tackles: p.totalTackle ?? 0,
    interceptions: p.interceptionWon ?? 0,
    fouls,
    foulsWon,
    foulInvolvements: fouls + foulsWon,
    yellowCard: p.yellowCard != null && p.yellowCard !== 0,
    redCard: p.redCard != null && p.redCard !== 0,
    saves: p.saves ?? 0,
    xG,
    xA,
    xGxA: xG + xA,
    bigChancesCreated: p.bigChanceCreated ?? 0,
    keyPasses: p.keyPass ?? 0,
    offsides: p.totalOffside ?? 0,
    dispossessed: p.dispossessed ?? 0,
    possessionLost: p.possessionLostCtrl ?? 0,
    clearances: p.totalClearance ?? 0,
    duelWon: p.duelWon ?? 0,
    duelLost: p.duelLost ?? 0,
    aerialWon: p.aerialWon ?? 0,
    wonContest: p.wonContest ?? 0,
  };
}

function processLastGames(games: RawGame[], teamId: number) {
  const sorted = [...games].sort(
    (a, b) => b.events.timeStartTimestamp - a.events.timeStartTimestamp
  );

  const matchList: unknown[] = [];
  const playerMap = new Map<
    number,
    {
      playerId: number;
      name: string;
      position: string;
      jerseyNo: number;
      matchStats: (PlayerMatchStats | null)[];
    }
  >();

  sorted.forEach((game, matchIdx) => {
    const ev = game.events;
    const isHome = ev.homeTeamId === teamId;
    const ourLineup = (isHome ? game.homeTeamLineup : game.awayTeamLineup) ?? [];

    matchList.push({
      eventId: ev.id,
      date: ev.timeStartTimestamp,
      homeTeamName: game.homeTeam.name,
      awayTeamName: game.awayTeam.name,
      homeScore: ev.homeScoreCurrent ?? 0,
      awayScore: ev.awayScoreCurrent ?? 0,
      tournamentName: ev.tournamentName ?? "",
      isHome,
    });

    ourLineup.forEach((p: RawPlayer) => {
      if (!playerMap.has(p.playerId)) {
        playerMap.set(p.playerId, {
          playerId: p.playerId,
          name: p.name,
          position: p.position ?? "",
          jerseyNo: p.jerseyNo ?? 0,
          matchStats: new Array(sorted.length).fill(null),
        });
      }
      playerMap.get(p.playerId)!.matchStats[matchIdx] = parsePlayerStats(p);
    });
  });

  const players = Array.from(playerMap.values())
    .map((player) => ({
      ...player,
      appearances: player.matchStats.filter(Boolean).length,
    }))
    .sort((a, b) => {
      const aMin = a.matchStats.reduce(
        (s, st) => s + (st?.minutesPlayed ?? 0),
        0
      );
      const bMin = b.matchStats.reduce(
        (s, st) => s + (st?.minutesPlayed ?? 0),
        0
      );
      return bMin - aMin;
    });

  return { matches: matchList, players, matchDates: sorted.map(g => g.events.timeStartTimestamp) };
}

router.get("/fixture/:id", async (req, res) => {
  const { id } = req.params;

  try {
    const fixtureRes = await fetch(
      `https://www.statshub.com/api/event/${id}`,
      { headers: STATSHUB_HEADERS }
    );

    if (!fixtureRes.ok) {
      res.status(404).json({ error: "Fixture not found" });
      return;
    }

    const fixtureJson = (await fixtureRes.json()) as Record<string, unknown>;
    const ev = fixtureJson.events as Record<string, unknown>;
    const homeTeamRaw = fixtureJson.homeTeam as Record<string, unknown>;
    const awayTeamRaw = fixtureJson.awayTeam as Record<string, unknown>;
    const tournamentsRaw = fixtureJson.tournaments as Record<string, unknown> | undefined;

    if (!ev || !homeTeamRaw || !awayTeamRaw) {
      res.status(404).json({ error: "Fixture data incomplete" });
      return;
    }

    const homeTeamId = homeTeamRaw.id as number;
    const awayTeamId = awayTeamRaw.id as number;
    const eventTimestamp = ev.timeStartTimestamp as number | undefined;

    // Fetch last-games (for player stats) + statsHub history (for team stat tabs) in parallel
    const [homeGamesRes, awayGamesRes, homeStatsHub, awayStatsHub] = await Promise.all([
      fetch(
        `https://www.statshub.com/api/team/${homeTeamId}/last-games?page=1&limit=20`,
        { headers: STATSHUB_HEADERS }
      ),
      fetch(
        `https://www.statshub.com/api/team/${awayTeamId}/last-games?page=1&limit=20`,
        { headers: STATSHUB_HEADERS }
      ),
      fetchStatsHubTeamHistory(homeTeamId, eventTimestamp),
      fetchStatsHubTeamHistory(awayTeamId, eventTimestamp),
    ]);

    const [homeGamesJson, awayGamesJson] = await Promise.all([
      homeGamesRes.json() as Promise<{ data: RawGame[] }>,
      awayGamesRes.json() as Promise<{ data: RawGame[] }>,
    ]);

    const home = processLastGames(homeGamesJson.data ?? [], homeTeamId);
    const away = processLastGames(awayGamesJson.data ?? [], awayTeamId);

    const fixture = {
      id: (ev.internalId as number) ?? (ev.id as number),
      eventId: ev.id as number,
      slug: (ev.slug as string) ?? "",
      status: (ev.status as string) ?? "notstarted",
      homeTeam: {
        id: homeTeamRaw.id as number,
        name: homeTeamRaw.name as string,
        slug: (homeTeamRaw.slug as string) ?? "",
        colorPrimary: (homeTeamRaw.teamcolorsprimary as string | null) ?? null,
        colorSecondary: (homeTeamRaw.teamcolorssecondary as string | null) ?? null,
      },
      awayTeam: {
        id: awayTeamRaw.id as number,
        name: awayTeamRaw.name as string,
        slug: (awayTeamRaw.slug as string) ?? "",
        colorPrimary: (awayTeamRaw.teamcolorsprimary as string | null) ?? null,
        colorSecondary: (awayTeamRaw.teamcolorssecondary as string | null) ?? null,
      },
      homeScore:
        ev.status !== "notstarted"
          ? ((ev.homeScoreCurrent as number | null) ?? null)
          : null,
      awayScore:
        ev.status !== "notstarted"
          ? ((ev.awayScoreCurrent as number | null) ?? null)
          : null,
      kickoffTimestamp: (ev.timeStartTimestamp as number) ?? 0,
      leagueName: (tournamentsRaw?.name as string) ?? "",
      winnerCode: (ev.winnerCode as number | null) ?? null,
    };

    res.json({
      fixture,
      home: {
        ...home,
        possession: homeStatsHub?.possession ?? 0,
        statHistory: homeStatsHub?.statHistory ?? [],
      },
      away: {
        ...away,
        possession: awayStatsHub?.possession ?? 0,
        statHistory: awayStatsHub?.statHistory ?? [],
      },
    });
  } catch (err) {
    req.log.error({ err }, "Failed to fetch fixture detail");
    res.status(500).json({ error: "Failed to fetch fixture detail" });
  }
});

export default router;
