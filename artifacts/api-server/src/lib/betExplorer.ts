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
}

/** BEMatch enriched with per-bookmaker odds */
export interface BEMatchFull extends BEMatch {
  markets: BEMatchMarkets;
}

// ── Normalisation / matching ───────────────────────────────────────────────────

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
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

function parseResultsHtml(html: string, targetDate: string): BEMatch[] {
  const [tYear, tMonth, tDay] = targetDate.split("-").map(Number);
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
      const leagueM = content.match(/<a[^>]+>([^<]+)<\/a>/);
      if (leagueM) {
        const parts = leagueM[1].trim().split(/\s*\/\s*/);
        currentCountry = parts[0]?.trim() ?? "";
        currentLeague  = parts[1]?.trim() ?? leagueM[1].trim();
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
    if (day !== tDay || month !== tMonth || year !== tYear) continue;

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
    });
  }
  return results;
}

/**
 * Fetch all matches for a given date from BetExplorer results page.
 * @param date  ISO "YYYY-MM-DD"
 */
export async function fetchBetExplorerMatches(
  date: string,
  log?: (msg: string) => void,
): Promise<BEMatch[]> {
  const [year, month, day] = date.split("-");
  // Use /football/results/ directly (avoids 301 redirect from /soccer/results/)
  const url = `${BASE}/football/results/?year=${year}&month=${Number(month)}&day=${Number(day)}`;
  log?.(`[BetExplorer] Fetching results page: ${url}`);

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
  if (!resp.ok) throw new Error(`BetExplorer HTTP ${resp.status}`);

  const html     = await resp.text();
  const matches  = parseResultsHtml(html, date);
  const withOdds = matches.filter(m => m.bestHomeOdds !== null).length;
  log?.(`[BetExplorer] ${matches.length} match(es) for ${date}, ${withOdds} with best odds`);
  return matches;
}
