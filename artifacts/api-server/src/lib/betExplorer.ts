/**
 * BetExplorer.com scraper — plain HTTP fetch, no Playwright.
 *
 * Phase 1 (results page): fetch all matches for a date with best 1X2 odds
 *   URL: /football/results/?year=YYYY&month=M&day=D
 *   Filters by data-dt="D,M,YYYY,..." for exact date matching
 *
 * Phase 2 (per-match): fetch per-bookmaker odds for 6 markets via AJAX API
 *   URL: /match-odds/{matchId}/0/{apiCode}/odds/?lang=en  → JSON { odds: "<HTML>" }
 *   tbody id="all-odds-{line}" encodes O/U / AH line values
 *
 * API codes (discovered from all.min.js match_change_bettype):
 *   1x2=1x2  ou=ou  ah=ah  DNB=ha  DC=dc  BTTS=bts
 */

import type { ProcessingLog } from "./db.js";

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
 * Parse bookmaker rows from market HTML (returned inside JSON .odds field).
 * The O/U and AH markets group rows under <tbody id="all-odds-{line}"> elements.
 */
function parseMarketHtml(
  html: string,
  hasLine: boolean,
): BEBookmakerEntry[] {
  const results: BEBookmakerEntry[] = [];

  if (hasLine) {
    // Split by tbody id="all-odds-{line}"
    const sections = html.split(/<tbody[^>]+id="all-odds-([^"]+)"/g);
    // sections: [pre, line1, content1, line2, content2, ...]
    for (let i = 1; i < sections.length; i += 2) {
      const lineStr = sections[i];
      const sectionHtml = sections[i + 1] ?? "";
      const lineVal = parseFloat(lineStr);
      if (isNaN(lineVal)) continue;

      // Parse TR rows in this section
      const trPat = /<tr[^>]*>([\s\S]*?)<\/tr>/g;
      let tr: RegExpExecArray | null;
      while ((tr = trPat.exec(sectionHtml)) !== null) {
        const content = tr[1];
        if (!content.includes("data-odd")) continue;
        const odds = extractOddsFromTr(content);
        if (odds.length < 2) continue;
        results.push({
          bookmaker: extractBookmakerName(content),
          odds,
          line: lineVal,
        });
      }
    }
  } else {
    // No line grouping — flat table
    const trPat = /<tr[^>]*>([\s\S]*?)<\/tr>/g;
    let tr: RegExpExecArray | null;
    while ((tr = trPat.exec(html)) !== null) {
      const content = tr[1];
      if (!content.includes("data-odd")) continue;
      const odds = extractOddsFromTr(content);
      if (odds.length < 2) continue;
      results.push({
        bookmaker: extractBookmakerName(content),
        odds,
      });
    }
  }

  return results;
}

// ── Per-match odds API ─────────────────────────────────────────────────────────

const MARKETS: Array<{ label: keyof BEMatchMarkets; apiCode: string; hasLine: boolean }> = [
  { label: "1x2",  apiCode: "1x2", hasLine: false },
  { label: "ou",   apiCode: "ou",  hasLine: true  },
  { label: "ah",   apiCode: "ah",  hasLine: true  },
  { label: "dnb",  apiCode: "ha",  hasLine: false },  // Draw No Bet → code "ha"
  { label: "dc",   apiCode: "dc",  hasLine: false },
  { label: "btts", apiCode: "bts", hasLine: false },  // BTTS → code "bts"
];

async function fetchMarketOnce(
  matchId: string,
  matchUrl: string,
  apiCode: string,
  hasLine: boolean,
): Promise<{ entries: BEBookmakerEntry[]; status: number }> {
  const url = `${BASE}/match-odds/${matchId}/0/${apiCode}/odds/?lang=en`;
  const resp = await fetch(url, {
    headers: {
      "User-Agent": UA,
      "Accept": "application/json, text/javascript, */*; q=0.01",
      "Accept-Language": "en-GB,en;q=0.9",
      "Referer": matchUrl,
      "X-Requested-With": "XMLHttpRequest",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(25_000),
  });
  if (!resp.ok) return { entries: [], status: resp.status };
  // BetExplorer returns JSON { odds: "<html>" } for all markets
  const text = await resp.text();
  let oddsHtml = "";
  try {
    const json = JSON.parse(text) as { odds?: string };
    oddsHtml = json.odds ?? "";
  } catch {
    // Some markets return plain HTML directly
    oddsHtml = text;
  }
  return { entries: parseMarketHtml(oddsHtml, hasLine), status: 200 };
}

/**
 * Fetch a single market with retry on 429 (rate-limit) and network errors.
 * Uses exponential back-off: 5 s → 12 s → 25 s.
 */
async function fetchMarket(
  matchId: string,
  matchUrl: string,
  apiCode: string,
  hasLine: boolean,
  log?: (msg: string) => void,
): Promise<BEBookmakerEntry[]> {
  const delays = [5000, 12000, 25000];
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const { entries, status } = await fetchMarketOnce(matchId, matchUrl, apiCode, hasLine);
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
      const entries = await fetchMarket(matchId, matchUrl, mkt.apiCode, mkt.hasLine, log);
      result[mkt.label] = entries;
      // Count unique bookmakers for the log
      const uniqueBooks = new Set(entries.map(e => e.bookmaker)).size;
      const lineInfo = mkt.hasLine
        ? `, lines: ${[...new Set(entries.map(e => e.line))].sort((a, b) => (a ?? 0) - (b ?? 0)).join("/")}`
        : "";
      log?.(`    [BE] ${mkt.label.toUpperCase()}: ${entries.length} entries (${uniqueBooks} bookmaker${uniqueBooks !== 1 ? "s" : ""}${lineInfo})`);
    } catch (e) {
      log?.(`    [BE] ${mkt.label.toUpperCase()} failed: ${e}`);
    }
    // 5 s between markets to avoid 429 — BetExplorer is strict about this
    await sleep(5000);
  }
  return result;
}

/**
 * Fetch key markets (1x2, ou, btts, dc) concurrently with no delays or retries.
 * Used for live/on-demand predictions where speed matters more than completeness.
 * Returns partial results — missing markets are simply absent from the output.
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

    // Match URL + team names
    // href="/football/{country}/{league}/{home-away}/{matchId}/"
    const linkM = content.match(
      /href="(\/football\/[^"]+\/([a-zA-Z0-9]{6,12})\/)"[^>]*>(<strong>)?([^<]+?)(<\/strong>)?\s*-\s*([^<]+?)\s*(?:<|$)/
    );
    if (!linkM) continue;

    const matchUrl    = `${BASE}${linkM[1]}`;
    const matchId     = linkM[2];
    let   homeTeam    = linkM[4].trim();
    let   awayTeam    = linkM[6].trim().replace(/<.*/, "").trim();

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

  const resp = await fetch(url, {
    headers: {
      "User-Agent": UA,
      "Accept": "text/html,application/xhtml+xml",
      "Accept-Language": "en-GB,en;q=0.9",
      "Referer": `${BASE}/football/`,
    },
    redirect: "follow",
    signal: AbortSignal.timeout(20_000),
  });
  if (!resp.ok) throw new Error(`BetExplorer HTTP ${resp.status}`);

  const html     = await resp.text();
  const matches  = parseResultsHtml(html, date);
  const withOdds = matches.filter(m => m.bestHomeOdds !== null).length;
  log?.(`[BetExplorer] ${matches.length} match(es) for ${date}, ${withOdds} with best odds`);
  return matches;
}
