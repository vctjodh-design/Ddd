import { Router } from "express";
import { GetFixturesQueryParams } from "@workspace/api-zod";
import type { FixturesResponse, LeagueGroup, Fixture, Team } from "@workspace/api-zod";

const router = Router();

const STATSHUB_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  "Accept": "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
  "Accept-Encoding": "gzip, deflate, br, zstd",
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

function formatDate(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function dateToUtcTimestamps(dateStr: string): { startOfDay: number; endOfDay: number } {
  const [year, month, day] = dateStr.split("-").map(Number);
  const startOfDay = Math.floor(Date.UTC(year, month - 1, day, 0, 0, 0) / 1000);
  const endOfDay = Math.floor(Date.UTC(year, month - 1, day, 23, 59, 59) / 1000);
  return { startOfDay, endOfDay };
}

function parseTeam(teamData: Record<string, unknown>): Team {
  return {
    id: (teamData.id as number) || 0,
    name: (teamData.name as string) || "",
    slug: (teamData.slug as string) || "",
    shortname: (teamData.shortname as string | null) ?? null,
    colorPrimary: (teamData.teamcolorsprimary as string | null) ?? null,
    colorSecondary: (teamData.teamcolorssecondary as string | null) ?? null,
    isNational: (teamData.national as boolean) || false,
  };
}

interface RawEvent {
  events: Record<string, unknown>;
  tournaments: Record<string, unknown>;
  unique_tournaments?: Record<string, unknown>;
  categories: Record<string, unknown>;
  homeTeam: Record<string, unknown>;
  awayTeam: Record<string, unknown>;
}

function parseFixture(raw: RawEvent): Fixture {
  const ev = raw.events;
  const tournament = raw.tournaments;
  const uniqueTournament = raw.unique_tournaments ?? {};
  const category = raw.categories;

  return {
    id: (ev.internalId as number) || (ev.id as number),
    slug: (ev.slug as string) || "",
    status: (ev.status as string) || "notstarted",
    homeTeam: parseTeam(raw.homeTeam),
    awayTeam: parseTeam(raw.awayTeam),
    homeScore:
      ev.status !== "notstarted"
        ? ((ev.homeScoreCurrent as number | null) ?? null)
        : null,
    awayScore:
      ev.status !== "notstarted"
        ? ((ev.awayScoreCurrent as number | null) ?? null)
        : null,
    kickoffTimestamp: (ev.timeStartTimestamp as number) || 0,
    roundInfo: (ev.roundInfo as number | null) ?? null,
    leagueId: (tournament.internalId as number) || (tournament.id as number),
    leagueName: (tournament.name as string) || "",
    leagueSlug: (tournament.slug as string) || "",
    leaguePrimaryColor:
      (uniqueTournament.primaryColorHex as string | null) ?? null,
    leagueSecondaryColor:
      (uniqueTournament.secondaryColorHex as string | null) ?? null,
    countryName: (category.name as string) || "",
    countrySlug: (category.slug as string) || "",
    countryFlag: (category.flag as string) || (category.slug as string) || "",
    winnerCode: (ev.winnerCode as number | null) ?? null,
    hasHighlights: (ev.hasGlobalHighlights as boolean) || false,
  };
}

router.get("/fixtures", async (req, res) => {
  const queryResult = GetFixturesQueryParams.safeParse(req.query);
  const date =
    queryResult.success && queryResult.data.date
      ? queryResult.data.date
      : formatDate(new Date());

  try {
    const { startOfDay, endOfDay } = dateToUtcTimestamps(date);
    const url = `https://www.statshub.com/api/event/by-date?startOfDay=${startOfDay}&endOfDay=${endOfDay}`;

    const response = await fetch(url, { headers: STATSHUB_HEADERS });

    if (!response.ok) {
      res.status(500).json({ error: `StatsHub returned ${response.status}` });
      return;
    }

    const json = (await response.json()) as { data?: RawEvent[] };
    const rawEvents: RawEvent[] = json.data ?? [];

    const fixturesByLeague = new Map<number, LeagueGroup>();

    for (const raw of rawEvents) {
      const fixture = parseFixture(raw);
      const leagueId = fixture.leagueId;

      if (!fixturesByLeague.has(leagueId)) {
        fixturesByLeague.set(leagueId, {
          leagueId,
          leagueName: fixture.leagueName,
          leagueSlug: fixture.leagueSlug,
          countryName: fixture.countryName,
          countryFlag: fixture.countryFlag,
          primaryColor: fixture.leaguePrimaryColor ?? null,
          fixtures: [],
        });
      }

      fixturesByLeague.get(leagueId)!.fixtures.push(fixture);
    }

    const leagues = Array.from(fixturesByLeague.values()).sort((a, b) => {
      if (a.countryName < b.countryName) return -1;
      if (a.countryName > b.countryName) return 1;
      return 0;
    });

    const result: FixturesResponse = {
      date,
      totalFixtures: rawEvents.length,
      leagues,
    };

    res.json(result);
  } catch (err) {
    req.log.error({ err }, "Failed to fetch fixtures");
    res.status(500).json({ error: "Failed to fetch fixtures from StatsHub" });
  }
});

export default router;
