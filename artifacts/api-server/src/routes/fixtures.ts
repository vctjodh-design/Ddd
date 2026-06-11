import { Router } from "express";
import { GetFixturesQueryParams } from "@workspace/api-zod";
import type { FixturesResponse, LeagueGroup, Fixture, Team } from "@workspace/api-zod";
import { fetchBetExplorerMatches, type BEMatch } from "../lib/betExplorer.js";

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
    dataSource: "statshub",
    beMatchId: null,
  };
}

// ── BetExplorer fixture helpers ───────────────────────────────────────────────

/** Simple deterministic hash → negative integer for BE-only fixture IDs */
function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = Math.imul(31, h) + s.charCodeAt(i) | 0;
  return -(Math.abs(h) % 900_000_000 + 100_000_000);
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function syntheticTeam(name: string): Team {
  return {
    id: 0, name,
    slug: slugify(name),
    shortname: null, colorPrimary: null, colorSecondary: null, isNational: false,
  };
}

/** Convert a BEMatch to a Fixture for display on the home page */
function beMatchToFixture(m: BEMatch, date: string): Fixture {
  const [y, mo, d] = date.split("-").map(Number);
  const [h, min] = m.kickoffTime.split(":").map(Number);
  const kickoffTimestamp = Math.floor(Date.UTC(y, mo - 1, d, h, min, 0) / 1000);
  const leagueId = hashStr(`${m.country ?? ""}_${m.league ?? ""}`);

  return {
    id: hashStr(m.matchId),
    slug: m.matchId,
    status: m.isFinished ? "finished" : "notstarted",
    homeTeam: syntheticTeam(m.homeTeam),
    awayTeam: syntheticTeam(m.awayTeam),
    homeScore: null,
    awayScore: null,
    kickoffTimestamp,
    roundInfo: null,
    leagueId,
    leagueName: m.league ?? "Unknown",
    leagueSlug: slugify(m.league ?? "unknown"),
    leaguePrimaryColor: null,
    leagueSecondaryColor: null,
    countryName: m.country ?? "Unknown",
    countrySlug: slugify(m.country ?? "unknown"),
    countryFlag: slugify(m.country ?? "unknown"),
    winnerCode: null,
    hasHighlights: false,
    dataSource: "betexplorer",
    beMatchId: m.matchId,
    beMatchUrl: m.matchUrl,
  } as Fixture & { beMatchUrl: string };
}

/** Simple team-name normalisation for BE↔SH deduplication */
function normName(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]/g, " ").replace(/\s+/g, " ").trim();
}

function nameSim(a: string, b: string): number {
  const na = normName(a), nb = normName(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  if (na.includes(nb) || nb.includes(na)) return 0.85;
  const wa = new Set(na.split(" ")), wb = new Set(nb.split(" "));
  const inter = [...wa].filter(w => wb.has(w)).length;
  const union = new Set([...wa, ...wb]).size;
  return union === 0 ? 0 : inter / union;
}

router.get("/fixtures", async (req, res) => {
  const queryResult = GetFixturesQueryParams.safeParse(req.query);
  const date =
    queryResult.success && queryResult.data.date
      ? queryResult.data.date
      : formatDate(new Date());

  try {
    const { startOfDay, endOfDay } = dateToUtcTimestamps(date);

    // Fetch both sources concurrently
    const [shResponse, beMatches] = await Promise.all([
      fetch(
        `https://www.statshub.com/api/event/by-date?startOfDay=${startOfDay}&endOfDay=${endOfDay}`,
        { headers: STATSHUB_HEADERS }
      ).then(r => r.ok ? r.json() as Promise<{ data?: RawEvent[] }> : { data: [] as RawEvent[] })
       .catch(() => ({ data: [] as RawEvent[] })),
      fetchBetExplorerMatches(date).catch(() => [] as BEMatch[]),
    ]);

    const rawEvents: RawEvent[] = (shResponse as { data?: RawEvent[] }).data ?? [];
    const shFixtures = rawEvents.map(parseFixture);

    // Build SH lookup by normalised team names for deduplication
    const shSet = new Set(
      shFixtures.map(f => `${normName(f.homeTeam.name)}|${normName(f.awayTeam.name)}`)
    );

    // Add BE-only fixtures that don't already appear on StatsHub
    const beOnlyFixtures: Fixture[] = [];
    for (const bm of beMatches) {
      const beKey = `${normName(bm.homeTeam)}|${normName(bm.awayTeam)}`;
      // Check direct key match first
      if (shSet.has(beKey)) continue;
      // Also check fuzzy match against all SH fixtures
      const matched = shFixtures.some(sf => {
        const score = (nameSim(bm.homeTeam, sf.homeTeam.name) + nameSim(bm.awayTeam, sf.awayTeam.name)) / 2;
        return score >= 0.6;
      });
      if (!matched) {
        beOnlyFixtures.push(beMatchToFixture(bm, date));
      }
    }

    // Merge into league groups
    const fixturesByLeague = new Map<number, LeagueGroup>();

    // StatsHub fixtures first
    for (const fixture of shFixtures) {
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

    // Then BE-only fixtures
    for (const fixture of beOnlyFixtures) {
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
      totalFixtures: shFixtures.length + beOnlyFixtures.length,
      leagues,
    };

    res.json(result);
  } catch (err) {
    req.log.error({ err }, "Failed to fetch fixtures");
    res.status(500).json({ error: "Failed to fetch fixtures" });
  }
});

export default router;
