import { Router } from "express";

const router = Router();

const STATSHUB_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept: "application/json, */*",
  Referer: "https://www.statshub.com/",
};

interface RawLineupPlayer {
  playerId: number;
  name: string;
  position?: string;
  minutesPlayed?: number;
  isSubstitute?: boolean;
  goals?: number;
  assists?: number;
  onTargetScoringAttempt?: number;
  shotOffTarget?: number;
  blockedScoringAttempt?: number;
  totalPass?: number;
  accuratePass?: number;
  totalCross?: number;
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
  homeTeamLineup?: RawLineupPlayer[];
  awayTeamLineup?: RawLineupPlayer[];
}

function aggregateLineup(lineup: RawLineupPlayer[]) {
  return lineup.reduce(
    (acc, p) => {
      acc.goals += p.goals ?? 0;
      acc.assists += p.assists ?? 0;
      acc.shots +=
        (p.onTargetScoringAttempt ?? 0) +
        (p.shotOffTarget ?? 0) +
        (p.blockedScoringAttempt ?? 0);
      acc.shotsOnTarget += p.onTargetScoringAttempt ?? 0;
      acc.shotsOffTarget += p.shotOffTarget ?? 0;
      acc.blockedShots += p.blockedScoringAttempt ?? 0;
      acc.passes += p.totalPass ?? 0;
      acc.accuratePasses += p.accuratePass ?? 0;
      acc.crosses += p.totalCross ?? 0;
      acc.tackles += p.totalTackle ?? 0;
      acc.interceptions += p.interceptionWon ?? 0;
      acc.fouls += p.fouls ?? 0;
      acc.foulsWon += p.wasFouled ?? 0;
      acc.yellowCards += p.yellowCard != null ? 1 : 0;
      acc.redCards += p.redCard != null ? 1 : 0;
      acc.saves += p.saves ?? 0;
      acc.xG += parseFloat(p.expectedGoals ?? "0");
      acc.xA += parseFloat(p.expectedAssists ?? "0");
      acc.bigChancesCreated += p.bigChanceCreated ?? 0;
      acc.keyPasses += p.keyPass ?? 0;
      acc.offsides += p.totalOffside ?? 0;
      acc.dispossessed += p.dispossessed ?? 0;
      acc.possessionLost += p.possessionLostCtrl ?? 0;
      acc.clearances += p.totalClearance ?? 0;
      acc.duelWon += p.duelWon ?? 0;
      acc.duelLost += p.duelLost ?? 0;
      acc.aerialWon += p.aerialWon ?? 0;
      return acc;
    },
    {
      goals: 0,
      assists: 0,
      shots: 0,
      shotsOnTarget: 0,
      shotsOffTarget: 0,
      blockedShots: 0,
      passes: 0,
      accuratePasses: 0,
      crosses: 0,
      tackles: 0,
      interceptions: 0,
      fouls: 0,
      foulsWon: 0,
      yellowCards: 0,
      redCards: 0,
      saves: 0,
      xG: 0,
      xA: 0,
      bigChancesCreated: 0,
      keyPasses: 0,
      offsides: 0,
      dispossessed: 0,
      possessionLost: 0,
      clearances: 0,
      duelWon: 0,
      duelLost: 0,
      aerialWon: 0,
    }
  );
}

function processLastGames(games: RawGame[], teamId: number) {
  const sorted = [...games].sort(
    (a, b) => a.events.timeStartTimestamp - b.events.timeStartTimestamp
  );

  const matchList: unknown[] = [];
  const playerMap = new Map<
    number,
    { playerId: number; name: string; position: string; stats: (unknown | null)[] }
  >();

  sorted.forEach((game, matchIdx) => {
    const ev = game.events;
    const isHome = ev.homeTeamId === teamId;
    const ourLineup = (isHome ? game.homeTeamLineup : game.awayTeamLineup) ?? [];
    const oppLineup = (isHome ? game.awayTeamLineup : game.homeTeamLineup) ?? [];

    const ourStats = aggregateLineup(ourLineup);
    const oppStats = aggregateLineup(oppLineup);

    matchList.push({
      eventId: ev.id,
      date: ev.timeStartTimestamp,
      homeTeamName: game.homeTeam.name,
      awayTeamName: game.awayTeam.name,
      homeScore: ev.homeScoreCurrent ?? 0,
      awayScore: ev.awayScoreCurrent ?? 0,
      tournamentName: ev.tournamentName ?? "",
      isHome,
      stats: ourStats,
      oppStats,
    });

    ourLineup.forEach((p: RawLineupPlayer) => {
      if (!playerMap.has(p.playerId)) {
        playerMap.set(p.playerId, {
          playerId: p.playerId,
          name: p.name,
          position: p.position ?? "",
          stats: new Array(sorted.length).fill(null),
        });
      }

      playerMap.get(p.playerId)!.stats[matchIdx] = {
        minutesPlayed: p.minutesPlayed ?? 0,
        isSubstitute: p.isSubstitute ?? false,
        goals: p.goals ?? 0,
        assists: p.assists ?? 0,
        shots:
          (p.onTargetScoringAttempt ?? 0) +
          (p.shotOffTarget ?? 0) +
          (p.blockedScoringAttempt ?? 0),
        shotsOnTarget: p.onTargetScoringAttempt ?? 0,
        passes: p.totalPass ?? 0,
        accuratePasses: p.accuratePass ?? 0,
        crosses: p.totalCross ?? 0,
        tackles: p.totalTackle ?? 0,
        interceptions: p.interceptionWon ?? 0,
        fouls: p.fouls ?? 0,
        foulsWon: p.wasFouled ?? 0,
        yellowCard: p.yellowCard != null,
        redCard: p.redCard != null,
        saves: p.saves ?? 0,
        xG: parseFloat(p.expectedGoals ?? "0"),
        xA: parseFloat(p.expectedAssists ?? "0"),
        xGxA:
          parseFloat(p.expectedGoals ?? "0") +
          parseFloat(p.expectedAssists ?? "0"),
        bigChancesCreated: p.bigChanceCreated ?? 0,
        keyPasses: p.keyPass ?? 0,
        offsides: p.totalOffside ?? 0,
        dispossessed: p.dispossessed ?? 0,
        possessionLost: p.possessionLostCtrl ?? 0,
        aerialWon: p.aerialWon ?? 0,
        duelWon: p.duelWon ?? 0,
        clearances: p.totalClearance ?? 0,
      };
    });
  });

  const players = Array.from(playerMap.values()).sort((a, b) => {
    const aMin = a.stats.reduce(
      (s, st) => s + (((st as { minutesPlayed?: number }) | null)?.minutesPlayed ?? 0),
      0
    );
    const bMin = b.stats.reduce(
      (s, st) => s + (((st as { minutesPlayed?: number }) | null)?.minutesPlayed ?? 0),
      0
    );
    return bMin - aMin;
  });

  return { matches: matchList, players };
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

    const [homeGamesRes, awayGamesRes] = await Promise.all([
      fetch(
        `https://www.statshub.com/api/team/${homeTeamId}/last-games?page=1&limit=20`,
        { headers: STATSHUB_HEADERS }
      ),
      fetch(
        `https://www.statshub.com/api/team/${awayTeamId}/last-games?page=1&limit=20`,
        { headers: STATSHUB_HEADERS }
      ),
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

    res.json({ fixture, home, away });
  } catch (err) {
    req.log.error({ err }, "Failed to fetch fixture detail");
    res.status(500).json({ error: "Failed to fetch fixture detail" });
  }
});

export default router;
