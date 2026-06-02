import { Router } from "express";
import { GetFixturesQueryParams } from "@workspace/api-zod";
import type { FixturesResponse, LeagueGroup, Fixture, Team } from "@workspace/api-zod";

const router = Router();

let cachedBuildId: string | null = null;
let buildIdFetchedAt = 0;
const BUILD_ID_CACHE_TTL = 5 * 60 * 1000;

async function getBuildId(): Promise<string | null> {
  const now = Date.now();
  if (cachedBuildId && now - buildIdFetchedAt < BUILD_ID_CACHE_TTL) {
    return cachedBuildId;
  }

  try {
    const res = await fetch("https://www.statshub.com/", {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });
    const html = await res.text();
    const match = html.match(/"buildId"\s*:\s*"([^"]+)"/);
    if (match) {
      cachedBuildId = match[1];
      buildIdFetchedAt = now;
      return cachedBuildId;
    }
  } catch {
  }
  return null;
}

function formatDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function parseTeam(teamData: Record<string, unknown>): Team {
  return {
    id: teamData.id as number,
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
  const date = queryResult.success && queryResult.data.date
    ? queryResult.data.date
    : formatDate(new Date());

  try {
    const buildId = await getBuildId();
    if (!buildId) {
      res.status(500).json({ error: "Unable to retrieve StatsHub build ID" });
      return;
    }

    const url = `https://www.statshub.com/_next/data/${buildId}/index.json?date=${date}`;
    const response = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "application/json, */*",
        Referer: "https://www.statshub.com/",
      },
    });

    if (!response.ok) {
      cachedBuildId = null;
      res.status(500).json({ error: `StatsHub returned ${response.status}` });
      return;
    }

    const json = (await response.json()) as {
      pageProps?: {
        initialEvents?: {
          data?: RawEvent[];
        };
      };
    };

    const rawEvents: RawEvent[] = json.pageProps?.initialEvents?.data ?? [];

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
