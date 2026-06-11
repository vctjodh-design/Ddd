/**
 * BetExplorer.com scraper — plain HTTP fetch, no Playwright.
 *
 * Phase 1 (results page): fetch all matches for a date with best 1X2 odds
 *   URL: /football/results/?year=YYYY&month=M&day=D
 *   Filters by data-dt="D,M,YYYY,..." for exact date matching
 *
 * Phase 2 (per-match): fetch per-bookmaker odds for 6 markets via AJAX API
 *   URL: /match-odds/{matchId}/1/{apiCode}/bestOdds/?lang=en  → JSON { odds: "<HTML>" }
 *   Requests are routed through the Tor SOCKS5 proxy (torProxy.ts) to bypass
 *   BetExplorer's geo-filter and receive full international bookmaker coverage.
 *   Without Tor (US IP): 3 US bookmakers. With Tor (EU exit): 10-17 per market.
 *
 * API codes:  1x2=1x2  ou=ou  ah=ah  DNB=ha  DC=dc  BTTS=bts
 */

import type { ProcessingLog } from "./db.js";
import { torFetch } from "./torProxy.js";

const BASE = "https://www.betexplorer.com";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

// ── Types ─────────────────────────────────────────────────────────────────────

/** One bookmaker entry for a market */
export interface BEBookmakerEntry {
  bookmaker: string;
  odds: (number | null)[];  // [home,draw,away] or [over,under] or [home,away] etc.
  line?: number;            // O/U line (e.g. 1.5) or AH handicap (e.g. -0.5)
}

/** All per-bookmaker market data for one match */
export interface BEMatchMarkets {
  "1x2": BEBookmakerEntry[];
  ou:    BEBookmakerEntry[];
  ah:    BEBookmakerEntry[];
  dnb:   BEBookmakerEntry[];
  dc:    BEBookmakerEntry[];
  btts:  BEBookmakerEntry[];
}

/** A match from the BetExplorer results page */
export interface BEMatch {
  homeTeam:    string;
  awayTeam:    string;
  kickoffTime: string;       // "HH:MM"
  matchId:     string;       // e.g. "zB4aXJSh"
  matchUrl:    string;       // full URL
  league?:     string;
  country?:    string;
  bestHomeOdds: number | null;
  bestDrawOdds: number | null;
  bestAwayOdds: number | null;
  isFinished:   boolean;     // true = from results page (completed match)
}

/** BEMatch enriched with per-bookmaker odds */
export interface BEMatchFull extends BEMatch {
  markets: BEMatchMarkets;
}

/** A single result from a team's results page */
export interface BETeamResult {
  result: "W" | "D" | "L";
  isHome: boolean;
  goalsScored: number;
  goalsConceded: number;
  opponent: string;
}

/** Aggregated stats computed from a team's last N results */
export interface BETeamStats {
  avgGoalsScored: number;
  avgGoalsConceded: number;
  avgGoalsScoredL5: number;
  avgGoalsConcededL5: number;
  avgGoalsScoredHome: number;
  avgGoalsConcededHome: number;
  avgGoalsScoredAway: number;
  avgGoalsConcededAway: number;
  cleanSheets: number;
  cleanSheetsPct: number;
  bttsPct: number;
  form: Array<"W" | "D" | "L">;
  wins: number;
  draws: number;
  losses: number;
  totalGames: number;
  results: BETeamResult[];
}

// ── Normalisation / matching ───────────────────────────────────────────────────

function norm(s: string): string {
  // Decompose accented chars (é → e + ̌ combining mark) then strip combining marks,
  // so "Potosí" → "potosi", "Ceará" → "ceara", "Köln" → "koln" — improves fuzzy matching
  // across systems that store diacritic-free names (BetExplorer) vs accented names (StatsHub).
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function sim(a: string, b: string): number {
  const na = norm(a), nb = norm(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  if (na.includes(nb) || nb.includes(na)) return 0.85;
  const wa = new Set(na.split(" ")), wb = new Set(nb.split(" "));
  const inter = [...wa].filter(w => wb.has(w)).length;
  return new Set([...wa, ...wb]).size === 0 ? 0 : inter / new Set([...wa, ...wb]).size;
}

export function findBestBEMatch(
  homeTeam: string,
  awayTeam: string,
  candidates: BEMatch[],
  threshold = 0.45,
): BEMatch | null {
  let best: { m: BEMatch; score: number } | null = null;
  for (const m of candidates) {
    const score = (sim(homeTeam, m.homeTeam) + sim(awayTeam, m.awayTeam)) / 2;
    if (!best || score > best.score) best = { m, score };
  }
  return best && best.score >= threshold ? best.m : null;
}

// ── HTML parsing helpers ───────────────────────────────────────────────────────

function parseOdd(v: string): number | null {
  const n = parseFloat(v);
  return isNaN(n) || n < 1.01 || n > 500 ? null : n;
}

function extractBookmakerName(trHtml: string): string {
  // Bookmaker name is in onclick: dataLayer.push({'event-name': 'bookmaker', ...})
  const m = trHtml.match(/event-name': '([^']+)'/);
  if (m) return m[1].trim();
  // Fallback: link text
  const a = trHtml.match(/<a[^>]+>([^<]{2,40})<\/a>/);
  return a ? a[1].trim() : "unknown";
}

function extractOddsFromTr(trHtml: string): (number | null)[] {
  return [...trHtml.matchAll(/data-odd="([^"]+)"/g)].map(m => parseOdd(m[1]));
}

/**
 * Extract the currently active O/U line from the bestOdds nav HTML.
 * The active tab has class "oddsComparison__activeSubLi" and id="2.50" etc.
 */
function extractActiveLine(html: string): number | null {
  const m = html.match(/id="(\d+\.\d+)"[^>]*oddsComparison__activeSubLi/)
         ?? html.match(/oddsComparison__activeSubLi[^>]*id="(\d+\.\d+)"/);
  return m ? parseFloat(m[1]) : null;
}

/**
 * Parse bookmaker rows from market HTML returned by the bestOdds endpoint.
 *
 * Non-line markets (1X2, BTTS, DC, DNB):
 *   Flat table — scan all <tr> elements with data-odd.
 *
 * Line markets (O/U, AH):
 *   The bestOdds endpoint returns ALL lines in one response, grouped under
 *   <tbody id="best-odds-{line}"> sections (e.g. "best-odds-1.50", "best-odds-2.25").
 *   Non-numeric IDs like "best-odds-ou" are the aggregated best-across-lines row
 *   and are skipped to avoid duplicates.
 *
 * Each <tr> has 2 <td> anchors with 'event-name' (mobile + desktop views).
 * extractBookmakerName uses .match() to get only the FIRST occurrence.
 */
function parseMarketHtml(html: string, isLineMarket: boolean): BEBookmakerEntry[] {
  const results: BEBookmakerEntry[] = [];

  if (isLineMarket) {
    // Split by <tbody id="best-odds-{line}"> or legacy <tbody id="all-odds-{line}">
    const sections = html.split(/<tbody[^>]+id="(?:best-odds|all-odds)-([^"]+)"/g);
    // sections: [pre, lineId1, content1, lineId2, content2, ...]
    for (let i = 1; i < sections.length; i += 2) {
      const lineId  = sections[i];
      const sectionHtml = sections[i + 1] ?? "";
      const lineVal = parseFloat(lineId);
      if (isNaN(lineVal)) continue; // skip "ou", "ah", etc. aggregate rows

      const trPat = /<tr[^>]*>([\s\S]*?)<\/tr>/g;
      let tr: RegExpExecArray | null;
      while ((tr = trPat.exec(sectionHtml)) !== null) {
        const content = tr[1];
        if (!content.includes("data-odd")) continue;
        const odds = extractOddsFromTr(content);
        if (odds.length < 2) continue;
        results.push({ bookmaker: extractBookmakerName(content), odds, line: lineVal });
      }
    }
  } else {
    const trPat = /<tr[^>]*>([\s\S]*?)<\/tr>/g;
    let tr: RegExpExecArray | null;
    while ((tr = trPat.exec(html)) !== null) {
      const content = tr[1];
      if (!content.includes("data-odd")) continue;
      const odds = extractOddsFromTr(content);
      if (odds.length < 2) continue;
      results.push({ bookmaker: extractBookmakerName(content), odds });
    }
  }

  return results;
}

// ── Per-match odds API ─────────────────────────────────────────────────────────

// isLineMarket: O/U and AH show one line at a time; active line is read from HTML nav.
const MARKETS: Array<{ label: keyof BEMatchMarkets; apiCode: string; isLineMarket: boolean }> = [
  { label: "1x2",  apiCode: "1x2", isLineMarket: false },
  { label: "ou",   apiCode: "ou",  isLineMarket: true  },
  { label: "ah",   apiCode: "ah",  isLineMarket: true  },
  { label: "dnb",  apiCode: "ha",  isLineMarket: false },
  { label: "dc",   apiCode: "dc",  isLineMarket: false },
  { label: "btts", apiCode: "bts", isLineMarket: false },
];

async function fetchMarketOnce(
  matchId: string,
  matchUrl: string,
  apiCode: string,
  isLineMarket: boolean,
): Promise<{ entries: BEBookmakerEntry[]; status: number }> {
  // /1/ + bestOdds = all bookmakers, geo-bypassed via Tor SOCKS5 proxy.
  const url = `${BASE}/match-odds/${matchId}/1/${apiCode}/bestOdds/?lang=en`;
  const resp = await torFetch(url, {
    headers: {
      "User-Agent": UA,
      "Accept": "application/json, text/javascript, */*; q=0.01",
      "Accept-Language": "en-GB,en;q=0.9",
      "Referer": matchUrl,
      "X-Requested-With": "XMLHttpRequest",
    },
    redirect: "follow",
    timeout: 40_000,
  });
  if (!resp.ok) return { entries: [], status: resp.status };
  const text = await resp.text();
  let oddsHtml = "";
  try {
    const json = JSON.parse(text) as { odds?: string };
    oddsHtml = json.odds ?? "";
  } catch {
    oddsHtml = text;
  }
  // For line markets, extract the active line from the nav tabs (default is 2.5 for O/U)
  return { entries: parseMarketHtml(oddsHtml, isLineMarket), status: 200 };
}

/**
 * Fetch a single market with retry on 429 (rate-limit) and network errors.
 * Uses exponential back-off: 5 s → 12 s → 25 s.
 */
async function fetchMarket(
  matchId: string,
  matchUrl: string,
  apiCode: string,
  isLineMarket: boolean,
  log?: (msg: string) => void,
): Promise<BEBookmakerEntry[]> {
  const delays = [5000, 12000, 25000];
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const { entries, status } = await fetchMarketOnce(matchId, matchUrl, apiCode, isLineMarket);
      if (status === 429) {
        const wait = delays[attempt] ?? 30000;
        log?.(`    [BE] ${apiCode.toUpperCase()} rate-limited (429) — waiting ${wait / 1000}s…`);
        await sleep(wait);
        continue;
      }
      return entries;
    } catch (err) {
      if (attempt === 2) throw err;
      await sleep(delays[attempt] ?? 5000);
    }
  }
  return [];
}

/**
 * Fetch all 6 per-bookmaker markets for a match.
 * Uses a 5 s base delay between markets to stay within BetExplorer's rate limit.
 */
export async function fetchMatchMarkets(
  matchId: string,
  matchUrl: string,
  log?: (msg: string) => void,
): Promise<BEMatchMarkets> {
  const result: BEMatchMarkets = { "1x2": [], ou: [], ah: [], dnb: [], dc: [], btts: [] };

  for (const mkt of MARKETS) {
    try {
      const entries = await fetchMarket(matchId, matchUrl, mkt.apiCode, mkt.isLineMarket, log);
      result[mkt.label] = entries;
      const uniqueBooks = new Set(entries.map(e => e.bookmaker)).size;
      const lines = [...new Set(entries.map(e => e.line).filter(Boolean))].sort((a, b) => (a as number) - (b as number));
      const lineInfo = lines.length ? `, line ${lines.join("/")}` : "";
      log?.(`    [BE] ${mkt.label.toUpperCase()}: ${entries.length} entries (${uniqueBooks} bookmaker${uniqueBooks !== 1 ? "s" : ""}${lineInfo})`);
    } catch (e) {
      log?.(`    [BE] ${mkt.label.toUpperCase()} failed: ${e}`);
    }
    await sleep(5000);
  }
  return result;
}

/**
 * Fetch key markets (1x2, ou, btts, dc) concurrently — no delays, no retries.
 * Used for live/on-demand predictions where speed matters more than completeness.
 */
export async function fetchKeyMarketsLive(
  matchId: string,
  matchUrl: string,
): Promise<Partial<BEMatchMarkets>> {
  const result: Partial<BEMatchMarkets> = {};
  await Promise.all([
    fetchMarketOnce(matchId, matchUrl, "1x2", false)
      .then(({ entries }) => { if (entries.length) result["1x2"] = entries; })
      .catch(() => {}),
    fetchMarketOnce(matchId, matchUrl, "ou", true)
      .then(({ entries }) => { if (entries.length) result.ou = entries; })
      .catch(() => {}),
    fetchMarketOnce(matchId, matchUrl, "bts", false)
      .then(({ entries }) => { if (entries.length) result.btts = entries; })
      .catch(() => {}),
    fetchMarketOnce(matchId, matchUrl, "dc", false)
      .then(({ entries }) => { if (entries.length) result.dc = entries; })
      .catch(() => {}),
  ]);
  return result;
}

// ── Results page fetch ─────────────────────────────────────────────────────────

/**
 * Parse BetExplorer results/schedule HTML for a set of acceptable dates.
 *
 * Why multiple dates? BetExplorer stores times in CET (UTC+2 in summer).
 * A match at 22:00–23:59 UTC appears on the **next** calendar day in BetExplorer
 * (e.g. 23:00 UTC June 10 → 01:00 CET June 11). To avoid missing these, callers
 * pass both the primary UTC date and the following day.
 *
 * isResultsPage — when true, marks all parsed matches as finished (from the
 * completed-matches results page). Schedule page matches are marked as not finished.
 */
function parseResultsHtml(html: string, acceptDates: Set<string>, isResultsPage = false): BEMatch[] {
  const results: BEMatch[] = [];

  let currentLeague = "";
  let currentCountry = "";

  const allTrPat = /<tr([^>]*)>([\s\S]*?)<\/tr>/g;
  let allTr: RegExpExecArray | null;

  while ((allTr = allTrPat.exec(html)) !== null) {
    const attrs = allTr[1];
    const content = allTr[2];

    // League/country rows
    if (attrs.includes("js-tournament")) {
      // Anchor may contain inner tags: <i><img alt="Country"></i>Country: League
      // Use [\s\S]*? to capture full inner HTML, then strip tags + decode entities.
      const leagueM = content.match(/<a[^>]+>([\s\S]*?)<\/a>/);
      if (leagueM) {
        const text = leagueM[1]
          .replace(/<[^>]+>/g, "")   // strip inner tags (img, i, span, etc.)
          .replace(/&nbsp;/g, " ")
          .replace(/&amp;/g, "&")
          .replace(/&lt;/g, "<")
          .replace(/&gt;/g, ">")
          .replace(/&#\d+;/g, "")
          .replace(/\s+/g, " ")
          .trim();
        if (text) {
          // BetExplorer uses "Country: League" (colon) on schedule page
          // and "Country / League" (slash) on results page — handle both.
          const colonIdx = text.indexOf(": ");
          const slashIdx = text.indexOf(" / ");
          if (colonIdx > 0) {
            currentCountry = text.slice(0, colonIdx).trim();
            currentLeague  = text.slice(colonIdx + 2).trim();
          } else if (slashIdx > 0) {
            currentCountry = text.slice(0, slashIdx).trim();
            currentLeague  = text.slice(slashIdx + 3).trim();
          } else {
            currentCountry = "";
            currentLeague  = text;
          }
        }
      }
      continue;
    }

    // Match row — must have data-dt
    const dtM = attrs.match(/data-dt="([^"]+)"/);
    if (!dtM) continue;
    const dtParts = dtM[1].split(",");
    if (dtParts.length < 5) continue;
    const day   = parseInt(dtParts[0]);
    const month = parseInt(dtParts[1]);
    const year  = parseInt(dtParts[2]);
    const hour  = dtParts[3].padStart(2, "0");
    const min   = dtParts[4].padStart(2, "0");

    // Accept if any of the provided dates match (handles CET vs UTC day bleed)
    const rowDate = `${year}-${String(month).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
    if (!acceptDates.has(rowDate)) continue;

    // Match URL — href="/football/{country}/{league}/{home-away}/{matchId}/"
    // matchId is the last pure-alphanumeric path segment (no dashes).
    // Parse href and team names independently so extra anchor attributes / tags
    // between href and the text node don't break the whole match.
    const hrefM = content.match(/href="(\/football\/[^"?#]+\/([a-zA-Z0-9]{4,24})\/?)"/);
    if (!hrefM) continue;

    const matchPath = hrefM[1].endsWith("/") ? hrefM[1] : hrefM[1] + "/";
    const matchUrl  = `${BASE}${matchPath}`;
    const matchId   = hrefM[2];

    // Team names: grab everything inside the <a> and strip tags
    const anchorBodyM = content.match(/href="\/football\/[^"]+"\s*[^>]*>([\s\S]*?)<\/a>/);
    if (!anchorBodyM) continue;
    const anchorText = anchorBodyM[1]
      .replace(/<[^>]+>/g, " ")   // strip inner tags
      .replace(/&amp;/g, "&")
      .replace(/&nbsp;/g, " ")
      .replace(/&#[^;]+;/g, "")
      .replace(/\s+/g, " ")
      .trim();

    // BetExplorer uses " - " as the separator between home and away
    const dashIdx = anchorText.indexOf(" - ");
    if (dashIdx <= 0) continue;
    let homeTeam = anchorText.slice(0, dashIdx).trim();
    let awayTeam = anchorText.slice(dashIdx + 3).trim();

    if (!homeTeam || !awayTeam || homeTeam.length > 80 || awayTeam.length > 80) continue;

    // Best odds from data-odd attributes (3 for 1x2)
    const oddMatches = [...content.matchAll(/data-odd="([^"]+)"/g)].map(m => m[1]);
    const bestHomeOdds = parseOdd(oddMatches[0] ?? "");
    const bestDrawOdds = parseOdd(oddMatches[1] ?? "");
    const bestAwayOdds = parseOdd(oddMatches[2] ?? "");

    results.push({
      homeTeam, awayTeam,
      kickoffTime: `${hour}:${min}`,
      matchId, matchUrl,
      league:   currentLeague  || undefined,
      country:  currentCountry || undefined,
      bestHomeOdds, bestDrawOdds, bestAwayOdds,
      isFinished: isResultsPage,
    });
  }
  return results;
}

/** Fetch one BetExplorer page and parse it, returning [] on any error. */
async function fetchAndParse(
  url: string,
  acceptDates: Set<string>,
  label: string,
  log?: (msg: string) => void,
  isResultsPage = false,
): Promise<BEMatch[]> {
  log?.(`[BetExplorer] Fetching ${label}: ${url}`);
  try {
    const resp = await torFetch(url, {
      headers: {
        "User-Agent": UA,
        "Accept": "text/html,application/xhtml+xml",
        "Accept-Language": "en-GB,en;q=0.9",
        "Referer": `${BASE}/football/`,
      },
      redirect: "follow",
      timeout: 20_000,
    });
    if (!resp.ok) {
      log?.(`[BetExplorer] ${label} HTTP ${resp.status} — skipping`);
      return [];
    }
    return parseResultsHtml(await resp.text(), acceptDates, isResultsPage);
  } catch (e) {
    log?.(`[BetExplorer] ${label} fetch error: ${e} — skipping`);
    return [];
  }
}

// ── In-memory listing cache ────────────────────────────────────────────────────
// BetExplorer rate-limits aggressively. We cache the full day listing for 20
// minutes so multiple concurrent predict-live calls share one fetch per date.
const listingCache = new Map<string, { matches: BEMatch[]; expiresAt: number }>();
const CACHE_TTL_MS = 20 * 60 * 1000; // 20 minutes

/**
 * Fetch all matches for a given date from BetExplorer.
 * Combines two sources so both past (results page) and upcoming (schedule page)
 * matches are covered — critical for live prediction on fixtures not yet played.
 *
 * Results page:  /football/results/?year=YYYY&month=M&day=D  (completed matches)
 * Schedule page: /football/?date=DD.MM.YYYY                  (upcoming matches)
 *
 * BetExplorer stores times in CET (UTC+2 in summer). A match at 22:00+ UTC will
 * appear under the NEXT calendar day in BetExplorer. We therefore always include
 * both the requested date and the following day in the filter.
 *
 * Results are cached in-memory for 20 minutes to avoid hammering BetExplorer
 * when multiple fixtures on the same date are being predicted in quick succession.
 *
 * @param date  ISO "YYYY-MM-DD" (UTC date from kickoffTs)
 */
export async function fetchBetExplorerMatches(
  date: string,
  log?: (msg: string) => void,
): Promise<BEMatch[]> {
  // Serve from cache if still fresh
  const cached = listingCache.get(date);
  if (cached && Date.now() < cached.expiresAt) {
    log?.(`[BetExplorer] Using cached listing for ${date} (${cached.matches.length} matches)`);
    return cached.matches;
  }

  const [year, month, day] = date.split("-");

  // Also accept the next calendar day — CET is UTC+2, so a 22:00 UTC match
  // appears as 00:00+ on the next day in BetExplorer's data-dt attribute.
  const nextDay = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day) + 1));
  const nextDate = nextDay.toISOString().slice(0, 10);
  const acceptDates = new Set([date, nextDate]);
  log?.(`[BetExplorer] Accepting dates: ${[...acceptDates].join(", ")}`);

  // DD.MM.YYYY format for the schedule page
  const ddmmyyyy = `${day.padStart(2, "0")}.${month.padStart(2, "0")}.${year}`;

  const resultsUrl  = `${BASE}/football/results/?year=${year}&month=${Number(month)}&day=${Number(day)}`;
  const scheduleUrl = `${BASE}/football/?date=${ddmmyyyy}`;

  // Fetch both concurrently — schedule covers upcoming, results covers completed
  const [resultMatches, scheduleMatches] = await Promise.all([
    fetchAndParse(resultsUrl,  acceptDates, "results page",  log, true),
    fetchAndParse(scheduleUrl, acceptDates, "schedule page", log, false),
  ]);

  // Merge, deduplicating by matchId (results page takes precedence — has odds + isFinished)
  const seen = new Set<string>();
  const merged: BEMatch[] = [];
  for (const m of [...resultMatches, ...scheduleMatches]) {
    if (!seen.has(m.matchId)) {
      seen.add(m.matchId);
      merged.push(m);
    }
  }

  const withOdds = merged.filter(m => m.bestHomeOdds !== null).length;
  const finished = merged.filter(m => m.isFinished).length;
  log?.(`[BetExplorer] ${merged.length} match(es) for ${date} (${resultMatches.length} finished + ${scheduleMatches.length} scheduled), ${withOdds} with best odds`);

  // Cache the result (only if non-empty — don't cache empty 429 responses)
  if (merged.length > 0) {
    listingCache.set(date, { matches: merged, expiresAt: Date.now() + CACHE_TTL_MS });
  }
  return merged;
}

// ── Match page: extract team links + score ─────────────────────────────────────

/**
 * Fetch the BetExplorer match detail page and extract:
 * - Home and away team page slugs/IDs (for fetching team results)
 * - Final score (best-effort from multiple HTML patterns)
 *
 * Returns null if the page can't be fetched or team links can't be found.
 */
export async function fetchMatchPageData(
  matchUrl: string,
  log?: (msg: string) => void,
): Promise<{
  homeSlug: string; homeId: string;
  awaySlug: string; awayId: string;
  homeScore: number | null; awayScore: number | null;
} | null> {
  log?.(`[BetExplorer] Fetching match page: ${matchUrl}`);
  try {
    const resp = await torFetch(matchUrl, {
      headers: {
        "User-Agent": UA,
        "Accept": "text/html,application/xhtml+xml",
        "Accept-Language": "en-GB,en;q=0.9",
        "Referer": `${BASE}/football/`,
      },
      redirect: "follow",
      timeout: 20_000,
    });
    if (!resp.ok) { log?.(`[BetExplorer] Match page HTTP ${resp.status}`); return null; }
    const html = await resp.text();

    // Extract first two unique /football/team/{slug}/{id}/ links
    const seen = new Set<string>();
    const teamLinks: Array<{ slug: string; id: string }> = [];
    for (const m of html.matchAll(/href="(\/football\/team\/([^\/]+)\/([a-zA-Z0-9]+)\/?)"/g)) {
      const id = m[3];
      if (!seen.has(id)) {
        seen.add(id);
        teamLinks.push({ slug: m[2], id });
      }
      if (teamLinks.length === 2) break;
    }
    if (teamLinks.length < 2) {
      log?.(`[BetExplorer] Match page: only ${teamLinks.length} team link(s) found`);
      return null;
    }

    // Try to extract final score (multiple patterns for robustness)
    let homeScore: number | null = null;
    let awayScore: number | null = null;
    const scorePatterns = [
      /class="[^"]*(?:matchresult|event-score|score-result|result)[^"]*"[^>]*>\s*(\d+)\s*:\s*(\d+)/i,
      /<title>[^<]*?(\d+)\s*:\s*(\d+)[^<]*<\/title>/i,
      /data-home-score="(\d+)"[^>]*data-away-score="(\d+)"/i,
      /<span[^>]*class="[^"]*score[^"]*"[^>]*>(\d+)\s*:\s*(\d+)/i,
    ];
    for (const pat of scorePatterns) {
      const sm = html.match(pat);
      if (sm) {
        homeScore = parseInt(sm[1]);
        awayScore = parseInt(sm[2]);
        break;
      }
    }

    return {
      homeSlug: teamLinks[0].slug, homeId: teamLinks[0].id,
      awaySlug: teamLinks[1].slug, awayId: teamLinks[1].id,
      homeScore, awayScore,
    };
  } catch (e) {
    log?.(`[BetExplorer] Match page fetch error: ${e}`);
    return null;
  }
}

// ── Team results page: scraping + stat computation ────────────────────────────

/**
 * Parse a BetExplorer team results page HTML, extracting the last N results.
 *
 * Row format (team results page):
 *   <tr> contains:
 *     - icon icon__w / icon__d / icon__l  → match result
 *     - <strong>TeamName</strong>          → focal team (this team)
 *     - <a href="/football/team/...">      → opponent
 *     - "X:Y&nbsp;"                       → score where X=home goals, Y=away goals
 *
 * isHome detection: <strong> (focal team) appears BEFORE the opponent /football/team/ link
 * when the focal team played at home; after when away.
 */
function parseTeamResultsHtml(html: string): BETeamResult[] {
  const results: BETeamResult[] = [];
  const trPat = /<tr[^>]*>([\s\S]*?)<\/tr>/g;
  let tr: RegExpExecArray | null;

  while ((tr = trPat.exec(html)) !== null) {
    const content = tr[1];

    // Must have a result icon
    const resultM = content.match(/icon icon__(w|d|l)/);
    if (!resultM) continue;
    const result = resultM[1].toUpperCase() as "W" | "D" | "L";

    // Score format: "X:Y&nbsp;" where X=home, Y=away
    const scoreM = content.match(/(\d+):(\d+)&nbsp;/);
    if (!scoreM) continue;
    const homeGoals = parseInt(scoreM[1]);
    const awayGoals = parseInt(scoreM[2]);

    // isHome: <strong> (focal team) appears before opponent link
    const strongIdx = content.indexOf("<strong>");
    const teamLinkIdx = content.indexOf("/football/team/");
    const isHome = strongIdx >= 0 && teamLinkIdx >= 0 && strongIdx < teamLinkIdx;

    // Extract opponent name
    const opponentM = content.match(/<a href="\/football\/team\/[^"]+">([^<]+)<\/a>/);
    const opponent = opponentM ? opponentM[1].trim() : "";

    results.push({
      result,
      isHome,
      goalsScored:   isHome ? homeGoals : awayGoals,
      goalsConceded: isHome ? awayGoals : homeGoals,
      opponent,
    });
  }

  return results;
}

function computeBETeamStats(results: BETeamResult[]): BETeamStats {
  const n = results.length;
  if (!n) {
    return {
      avgGoalsScored: 0, avgGoalsConceded: 0,
      avgGoalsScoredL5: 0, avgGoalsConcededL5: 0,
      avgGoalsScoredHome: 0, avgGoalsConcededHome: 0,
      avgGoalsScoredAway: 0, avgGoalsConcededAway: 0,
      cleanSheets: 0, cleanSheetsPct: 0, bttsPct: 0,
      form: [], wins: 0, draws: 0, losses: 0, totalGames: 0, results: [],
    };
  }

  const avg = (arr: number[]) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
  const last5  = results.slice(0, 5);
  const homeR  = results.filter(r => r.isHome);
  const awayR  = results.filter(r => !r.isHome);
  const cleanSheets = results.filter(r => r.goalsConceded === 0).length;
  const btts        = results.filter(r => r.goalsScored > 0 && r.goalsConceded > 0).length;

  return {
    avgGoalsScored:      avg(results.map(r => r.goalsScored)),
    avgGoalsConceded:    avg(results.map(r => r.goalsConceded)),
    avgGoalsScoredL5:    avg(last5.map(r => r.goalsScored)),
    avgGoalsConcededL5:  avg(last5.map(r => r.goalsConceded)),
    avgGoalsScoredHome:  avg(homeR.map(r => r.goalsScored)),
    avgGoalsConcededHome:avg(homeR.map(r => r.goalsConceded)),
    avgGoalsScoredAway:  avg(awayR.map(r => r.goalsScored)),
    avgGoalsConcededAway:avg(awayR.map(r => r.goalsConceded)),
    cleanSheets,
    cleanSheetsPct: Math.round(cleanSheets / n * 100),
    bttsPct:        Math.round(btts / n * 100),
    form:   results.slice(0, 5).map(r => r.result),
    wins:   results.filter(r => r.result === "W").length,
    draws:  results.filter(r => r.result === "D").length,
    losses: results.filter(r => r.result === "L").length,
    totalGames: n,
    results,
  };
}

/**
 * Fetch a team's last N results from their BetExplorer team results page
 * and compute aggregated stats (avg goals scored/conceded, form, clean sheets, etc.)
 */
export async function fetchBETeamStats(
  teamSlug: string,
  teamId: string,
  n = 20,
  log?: (msg: string) => void,
): Promise<BETeamStats | null> {
  const url = `${BASE}/football/team/${teamSlug}/${teamId}/results/`;
  log?.(`[BetExplorer] Fetching team results: ${url}`);
  try {
    const resp = await torFetch(url, {
      headers: {
        "User-Agent": UA,
        "Accept": "text/html,application/xhtml+xml",
        "Accept-Language": "en-GB,en;q=0.9",
        "Referer": `${BASE}/football/`,
      },
      redirect: "follow",
      timeout: 20_000,
    });
    if (!resp.ok) { log?.(`[BetExplorer] Team results HTTP ${resp.status}`); return null; }
    const html = await resp.text();
    const parsed = parseTeamResultsHtml(html).slice(0, n);
    if (!parsed.length) { log?.(`[BetExplorer] Team results: no rows found`); return null; }
    const stats = computeBETeamStats(parsed);
    log?.(`[BetExplorer] Team results: ${parsed.length} games, avg GS=${stats.avgGoalsScored.toFixed(2)}, GC=${stats.avgGoalsConceded.toFixed(2)}, form=${stats.form.join("")}`);
    return stats;
  } catch (e) {
    log?.(`[BetExplorer] Team results fetch error: ${e}`);
    return null;
  }
}
