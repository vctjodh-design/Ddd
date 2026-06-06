/**
 * OddsPortal scraper — fetches match lists and bookmaker odds.
 *
 * Strategy (tried in order):
 *  1. Plain HTTP fetch  — fast but blocked by Cloudflare TLS-fingerprint detection
 *  2. Playwright browser — launches real Chromium, bypasses Cloudflare; slower (~10-15 s/page)
 *
 * Endpoint map (OddsPortal current as of 2025):
 *   Results page:  /football/{country}/{slug}[-{year}]/results/  (HTML + __NEXT_DATA__)
 *   Odds API v2:   /api/v1/event-row/{hash}/{betTypeId}/{scopeId}/
 *   Odds API v1:   /api/v1/event/{hash}/{market-slug}/   (legacy, may be dead)
 *   betTypeId:     1=1x2  2=O/U  5=AH  8=BTTS  9=DC  10=DNB  11=EH  12=CS  13=HTFT  16=OE
 *   scopeId:       2=FT   4=1H   6=2H
 */
import * as cheerio from "cheerio";
import { browserFetch, browserFetchHashPage, fetchOddsPage, type InterceptedResponse, type DomLink, type OddsRow, type OddsPageResult } from "./browserScraper.js";

const OP_BASE = "https://www.oddsportal.com";

const OP_HEADERS: Record<string, string> = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
  "Accept-Language": "en-US,en;q=0.9",
  "Accept-Encoding": "gzip, deflate, br",
  "sec-ch-ua": '"Google Chrome";v="125", "Chromium";v="125", "Not.A/Brand";v="24"',
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": '"Windows"',
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "none",
  "Sec-Fetch-User": "?1",
  "Upgrade-Insecure-Requests": "1",
  "Connection": "keep-alive",
  "DNT": "1",
  "Cache-Control": "no-cache",
  "Pragma": "no-cache",
};

const OP_API_HEADERS: Record<string, string> = {
  ...OP_HEADERS,
  "Accept": "application/json, text/plain, */*",
  "Sec-Fetch-Dest": "empty",
  "Sec-Fetch-Mode": "cors",
  "Sec-Fetch-Site": "same-origin",
  "Referer": "https://www.oddsportal.com/",
};

/** Fetch a URL from OddsPortal. Returns null on failure.
 *  Also returns a blockDetected flag so callers can distinguish
 *  a Cloudflare silent-drop (404 + empty body) from a real missing page. */
async function opFetch(
  url: string,
  isApi = false
): Promise<{ html: string; blocked: false } | { html: null; blocked: boolean }> {
  try {
    const resp = await fetch(url, {
      headers: isApi ? OP_API_HEADERS : OP_HEADERS,
      signal: AbortSignal.timeout(20000),
      redirect: "follow",
    });
    const text = await resp.text();
    if (!resp.ok) {
      // Cloudflare silent-drop: non-2xx + empty body = bot block, not a real 404
      const blocked = text.length === 0;
      console.warn(
        `[OddsPortal] ${resp.status} (${text.length}b) for ${url}` +
          (blocked ? " — Cloudflare bot block detected" : "")
      );
      return { html: null, blocked };
    }
    // Also detect Cloudflare challenge pages returned with 200
    const isChallenge =
      text.length < 5000 &&
      (text.includes("cf-browser-verification") ||
        text.includes("Just a moment") ||
        text.includes("Checking your browser") ||
        text.includes("Enable JavaScript"));
    if (isChallenge) {
      console.warn(`[OddsPortal] Cloudflare challenge page at ${url}`);
      return { html: null, blocked: true };
    }
    return { html: text, blocked: false };
  } catch (e) {
    console.warn(`[OddsPortal] fetch error for ${url}:`, e);
    return { html: null, blocked: false };
  }
}

/** Extract __NEXT_DATA__ JSON from an OddsPortal HTML page */
function extractNextData(html: string): Record<string, unknown> | null {
  try {
    const $ = cheerio.load(html);
    const script = $("#__NEXT_DATA__").text() || $('script[type="application/json"]').first().text();
    if (script) return JSON.parse(script);
    // Try to find it inline
    const match = html.match(/__NEXT_DATA__\s*=\s*(\{[\s\S]*?\})\s*;?\s*<\/script>/);
    if (match) return JSON.parse(match[1]);
  } catch {}
  return null;
}

/** Deep-get a nested property from an object by dot-path */
function dig(obj: unknown, ...keys: string[]): unknown {
  let cur = obj;
  for (const k of keys) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[k];
  }
  return cur;
}

export interface OPMatch {
  date: string;           // ISO "YYYY-MM-DD"
  homeTeam: string;
  awayTeam: string;
  homeScore: number | null;
  awayScore: number | null;
  matchUrl: string;       // relative URL on oddsportal.com
  matchHash: string;      // last path segment (hash ID used in API calls)
}

export interface BookmakerEntry {
  bookmaker: string;
  /** Closing odds (final odds at match start) */
  odds: Record<string, number>;
  /** Opening odds (from mouseenter popup) — may be absent if page didn't expose popup */
  openingOdds?: Record<string, number>;
}

export interface OPMatchOdds {
  "1x2":    BookmakerEntry[];
  "ou":     BookmakerEntry[];   // over/under
  "ah":     BookmakerEntry[];   // asian handicap
  "btts":   BookmakerEntry[];   // both teams to score
  "dc":     BookmakerEntry[];   // double chance
  "eh":     BookmakerEntry[];   // european handicap
  "dnb":    BookmakerEntry[];   // draw no bet
  "cs":     BookmakerEntry[];   // correct score (top 5 per team)
  "htft":   BookmakerEntry[];   // half time / full time
  "oe":     BookmakerEntry[];   // odd or even
}

// ── URL helpers ───────────────────────────────────────────────────────────────

/** Converts a team name to an OddsPortal URL slug (lowercase, hyphens, ASCII). */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")  // strip accents
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * Build the canonical OddsPortal match page URL from available components.
 * Format: /football/{country}/{league}/{homeSlug}-{awaySlug}-{hash}/
 * This is the URL that triggers bookmaker odds API calls, unlike H2H pages.
 */
function buildMatchPageUrl(
  homeTeam:      string,
  awayTeam:      string,
  matchHash:     string,
  oddsPortalPath: string
): string {
  if (!matchHash || !oddsPortalPath) return "";
  const home = slugify(homeTeam);
  const away = slugify(awayTeam);
  return `${OP_BASE}/football/${oddsPortalPath}/${home}-${away}-${matchHash}/`;
}

// ── Build the results URL ────────────────────────────────────────────────────

function buildResultsUrl(oddsPortalPath: string, year: number): string {
  // oddsPortalPath = "usa/usl-championship" or "england/premier-league"
  const parts = oddsPortalPath.split("/");
  const country = parts[0];
  const league  = parts.slice(1).join("/");
  const currentYear = new Date().getFullYear();

  // OddsPortal URL patterns:
  //   Current season (currentYear): no year suffix → /results/
  //   Previous seasons (calendar-year leagues): {league}-{year}/results/
  //   Previous seasons (European split-season): {league}-{year-1}-{year}/results/
  //
  // Single-year format is the primary format (most leagues globally use calendar years).
  let slugWithYear: string;
  if (year >= currentYear) {
    // Current or future season — base URL (no suffix)
    slugWithYear = league;
  } else {
    // Previous season: primary format is single-year (e.g. -2025)
    slugWithYear = `${league}-${year}`;
  }
  return `${OP_BASE}/football/${country}/${slugWithYear}/results/`;
}

/** Returns candidate URLs to try in order for a given year. */
function buildResultsUrlCandidates(oddsPortalPath: string, year: number): string[] {
  const parts = oddsPortalPath.split("/");
  const country = parts[0];
  const league  = parts.slice(1).join("/");
  const base    = `${OP_BASE}/football/${country}`;
  const currentYear = new Date().getFullYear();

  if (year >= currentYear) {
    return [`${base}/${league}/results/`];
  }
  return [
    // Single-year format first — used by South American, Asian, and most calendar-year leagues
    // e.g. /brazil/brasileiro-serie-b-2025/results/
    `${base}/${league}-${year}/results/`,
    // Double-year format — used by European split-season leagues (Aug–May)
    // e.g. /england/premier-league-2024-2025/results/
    `${base}/${league}-${year - 1}-${year}/results/`,
    // Fallback: no year suffix (may redirect to current season)
    `${base}/${league}/results/`,
  ];
}

// ── Parse match list from results page ───────────────────────────────────────

function parseNextDataMatches(data: Record<string, unknown>, pageUrl: string): OPMatch[] {
  const matches: OPMatch[] = [];

  // Try different path structures that OddsPortal has used
  const eventLists: unknown[] = [];
  const pages = dig(data, "props", "pageProps");
  if (pages && typeof pages === "object") {
    const d = (pages as Record<string, unknown>)["data"] ??
              (pages as Record<string, unknown>)["initialState"] ??
              (pages as Record<string, unknown>)["dehydratedState"];
    if (d && typeof d === "object") {
      const evs = (d as Record<string, unknown>)["events"] ??
                  (d as Record<string, unknown>)["eventRows"] ??
                  (d as Record<string, unknown>)["rows"];
      if (Array.isArray(evs)) eventLists.push(...evs);
    }
  }

  // Try React Query / SWR dehydrated cache pattern
  const dehy = dig(data, "props", "pageProps", "dehydratedState", "queries");
  if (Array.isArray(dehy)) {
    for (const q of dehy) {
      const state = (q as Record<string, unknown>)["state"] as Record<string, unknown> | undefined;
      const data2 = state?.["data"];
      if (Array.isArray(data2)) eventLists.push(...data2);
    }
  }

  for (const ev of eventLists) {
    if (!ev || typeof ev !== "object") continue;
    const e = ev as Record<string, unknown>;
    const home = String(e["homeTeamName"] ?? e["home"] ?? e["homeTeam"] ?? "");
    const away = String(e["awayTeamName"] ?? e["away"] ?? e["awayTeam"] ?? "");
    const slug = String(e["slug"] ?? e["eventUrl"] ?? e["url"] ?? "");
    const ts   = Number(e["startDate"] ?? e["startTime"] ?? e["timestamp"] ?? 0);
    const hs   = e["homeScore"] !== undefined ? Number(e["homeScore"]) : null;
    const as_  = e["awayScore"] !== undefined ? Number(e["awayScore"]) : null;

    if (!home || !away) continue;

    const date = ts ? new Date(ts * 1000).toISOString().slice(0, 10)
                    : extractDateFromUrl(pageUrl);
    const matchUrl = slug.startsWith("/") ? slug : `/football/${slug}`;
    const matchHash = extractHashFromSlug(slug);

    matches.push({ date, homeTeam: home, awayTeam: away, homeScore: hs, awayScore: as_, matchUrl, matchHash });
  }
  return matches;
}

function extractHashFromSlug(slug: string): string {
  // e.g. "miami-fc-las-vegas-lights-fc-AbCdEfGh" → "AbCdEfGh"
  const parts = slug.split("/").filter(Boolean);
  const last  = parts[parts.length - 1] ?? "";
  const segs  = last.split("-");
  // Hash is typically 8 chars at the end
  const hash  = segs[segs.length - 1] ?? "";
  return hash.length >= 6 ? hash : "";
}

function extractDateFromUrl(url: string): string {
  return new Date().toISOString().slice(0, 10);
}

function parseHtmlMatches(html: string, baseUrl: string): OPMatch[] {
  const $ = cheerio.load(html);
  const matches: OPMatch[] = [];
  let currentDate = "";

  // OddsPortal's classic HTML structure uses tables with date headers
  $("tbody tr, .eventRow").each((_, row) => {
    const $row = $(row);

    // Date row
    const dateText = $row.find(".datet, .date").first().text().trim();
    if (dateText && /\d{2}.\d{2}.\d{4}/.test(dateText)) {
      currentDate = parseDateText(dateText);
      return;
    }

    // Match row
    const link = $row.find("a[href*='/football/']").first();
    const href  = link.attr("href") ?? "";
    if (!href) return;

    const teamText = link.text().trim();
    const separator = teamText.indexOf(" - ");
    if (separator < 0) return;

    const homeTeam = teamText.slice(0, separator).trim();
    const awayTeam = teamText.slice(separator + 3).trim();
    const matchHash = extractHashFromSlug(href);

    // Score cells
    const tds = $row.find("td");
    let homeScore: number | null = null, awayScore: number | null = null;
    tds.each((_, td) => {
      const t = $(td).text().trim();
      if (/^\d:\d/.test(t) || /^\d-\d/.test(t)) {
        const [hs, as_] = t.split(/[:\-]/);
        homeScore = parseInt(hs ?? "0"); awayScore = parseInt(as_ ?? "0");
        return false as unknown as void;
      }
    });

    if (homeTeam && awayTeam) {
      matches.push({
        date: currentDate || new Date().toISOString().slice(0, 10),
        homeTeam, awayTeam, homeScore, awayScore,
        matchUrl: href, matchHash,
      });
    }
  });

  return matches;
}

function parseDateText(text: string): string {
  // "01 Jun 2026" or "01.06.2026"
  const d = new Date(text.replace(/(\d{2})\.(\d{2})\.(\d{4})/, "$3-$2-$1").replace(/(\d{2}) (\w+) (\d{4})/, "$1 $2 $3"));
  if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return text;
}

// ── Parse next-page URL from results page ─────────────────────────────────────

function findNextPageUrl(html: string, currentUrl: string): string | null {
  const $ = cheerio.load(html);

  // Look for "Next" pagination link
  const nextLink = $("a").filter((_, el) => {
    const text = $(el).text().trim().toLowerCase();
    const rel  = $(el).attr("rel") ?? "";
    return text === "next" || rel === "next" || text === "»" || text === "›";
  }).first().attr("href");

  if (nextLink) {
    return nextLink.startsWith("http") ? nextLink : `${OP_BASE}${nextLink}`;
  }

  // Hash-based pagination: /results/ → /results/#/page/2/
  const pageMatch = currentUrl.match(/\/page\/(\d+)\//);
  const current   = pageMatch ? parseInt(pageMatch[1]) : 1;
  const nextPage  = current + 1;

  // Check if there are enough results to warrant a next page
  const rows = $(".eventRow, tbody tr").length;
  if (rows < 5) return null;

  const base = currentUrl.split("#")[0];
  return `${base}#/page/${nextPage}/`;
}

// ── Parse matches from Playwright-intercepted API responses ──────────────────

function parseInterceptedMatches(intercepted: InterceptedResponse[], pageUrl: string): OPMatch[] {
  const matches: OPMatch[] = [];
  for (const { json } of intercepted) {
    if (!json || typeof json !== "object") continue;
    // OddsPortal wraps event arrays in various keys
    const candidates = [
      (json as Record<string, unknown>)["rows"],
      (json as Record<string, unknown>)["events"],
      (json as Record<string, unknown>)["data"],
      (json as Record<string, unknown>)["d"],
    ];
    for (const c of candidates) {
      if (!Array.isArray(c)) continue;
      for (const ev of c) {
        if (!ev || typeof ev !== "object") continue;
        const e = ev as Record<string, unknown>;
        const home = String(e["homeTeamName"] ?? e["home"] ?? e["homeTeam"] ?? "");
        const away = String(e["awayTeamName"] ?? e["away"] ?? e["awayTeam"] ?? "");
        if (!home || !away) continue;
        const ts  = Number(e["startDate"] ?? e["startTime"] ?? e["timestamp"] ?? 0);
        const hs  = e["homeScore"] !== undefined ? Number(e["homeScore"]) : null;
        const as_ = e["awayScore"] !== undefined ? Number(e["awayScore"]) : null;
        const slug = String(e["slug"] ?? e["eventUrl"] ?? e["url"] ?? "");
        const date = ts ? new Date(ts * 1000).toISOString().slice(0, 10)
                       : new Date().toISOString().slice(0, 10);
        const matchUrl   = slug.startsWith("/") ? slug : slug ? `/football/${slug}` : "";
        const matchHash  = extractHashFromSlug(slug);
        matches.push({ date, homeTeam: home, awayTeam: away, homeScore: hs, awayScore: as_, matchUrl, matchHash });
      }
    }
  }
  return matches;
}

// ── Parse odds from Playwright-intercepted API responses ─────────────────────

function parseInterceptedOdds(
  intercepted: InterceptedResponse[],
  odds: Partial<OPMatchOdds>
): void {
  // betTypeId → our market key (OddsPortal's numeric IDs)
  const betTypeMap: Record<number, keyof OPMatchOdds> = {
    1: "1x2", 2: "ou", 5: "ah", 8: "btts", 9: "dc",
    10: "dnb", 11: "eh", 12: "cs", 13: "htft", 16: "oe",
  };

  for (const { url, json } of intercepted) {
    if (!json || typeof json !== "object") continue;

    // Determine which market this URL belongs to
    let market: keyof OPMatchOdds | null = null;

    // Pattern: /match-event/{sportId}-{X}-{hash}-{betTypeId}-{scopeId}-{cacheHash}.dat
    // e.g. /match-event/1-1-Ekq9W28q-1-2-a262a67e56d628c99875b8cf09a57359.dat
    const matchEvtMatch = url.match(/\/match-event\/\d+-\d+-[^-]+-(\d+)-(\d+)-[^.]+\.dat/);
    if (matchEvtMatch) {
      market = betTypeMap[Number(matchEvtMatch[1])] ?? null;
    }

    // Pattern: /api/v1/event-row/{hash}/{betTypeId}/{scopeId}/
    if (!market) {
      const betTypeMatch = url.match(/\/event-row\/[^/]+\/(\d+)\//);
      if (betTypeMatch) market = betTypeMap[Number(betTypeMatch[1])] ?? null;
    }
    // Pattern: /api/v1/event/{hash}/1x2/ etc.
    if (!market) {
      const slugMatch = url.match(/\/event\/[^/]+\/([^/]+)\//);
      if (slugMatch) {
        const slugToMarket: Record<string, keyof OPMatchOdds> = {
          "1x2": "1x2", "over-under": "ou", "asian-handicap": "ah",
          "both-teams-score": "btts", "double-chance": "dc",
          "draw-no-bet": "dnb", "european-handicap": "eh",
          "correct-score": "cs", "half-time-full-time": "htft", "odd-even": "oe",
        };
        market = slugToMarket[slugMatch[1]] ?? null;
      }
    }

    if (!market) continue;

    // Extract bookmaker data
    const raw = (json as Record<string, unknown>);
    const data = raw["d"] ?? raw["data"] ?? raw["odds"] ?? raw["rows"] ?? json;
    const arr  = Array.isArray(data) ? data : typeof data === "object" ? Object.values(data as object).flat() : [];
    const parsed = parseBookmakerArray(arr as unknown[], market);
    if (parsed.length > 0) {
      (odds as Record<string, BookmakerEntry[]>)[market] =
        market === "cs" ? filterTopCsOdds(parsed) : parsed;
    }
  }
}

// ── DOM-based match extraction (OddsPortal CSR / Vue SPA) ────────────────────

/**
 * Parse match data from DomLinks captured by the Playwright browser walker.
 *
 * OddsPortal (as of 2025) renders via a Vue SPA with encrypted API responses.
 * Match data only exists in the fully-rendered DOM; no __NEXT_DATA__ and no
 * interceptable plaintext JSON.  The rendered link text has the format:
 *
 *   "{Status}{ShortStatus}{HomeTeam}{HomeScore}{HomeScore}–{AwayScore}{AwayTeam}{AwayScore}"
 *
 * e.g. "FinishedFINKabylie11–0ASO Chlef0"
 *  → home Kabylie 1 : 0 away ASO Chlef
 *
 * The home score digit appears TWICE (individual team display + score display)
 * so we extract it from the half-width slice of the digits before "–".
 *
 * Date headers appear as text nodes like "07 Jun 2025" in the DOM; the walker
 * in browserScraper sets `link.date` to the closest preceding date header.
 */
function parseDomMatchLinks(domLinks: DomLink[], fallbackYear: number): OPMatch[] {
  const STATUS_PREFIX = /^(Finished|Postponed|Cancelled|Abandoned|WalkOver|FIN|PP|ABA|CAN|WO|Aw\.W\.|Pen\.)+/i;
  const EN_DASH = /[\u2013\u2014\-]/; // en-dash, em-dash, hyphen

  const matches: OPMatch[] = [];

  for (const link of domLinks) {
    const { href, text, date } = link;

    // Only process match/H2H links, skip navigation links
    if (!href.includes("/football/")) continue;
    if (
      href.includes("/results") ||
      href.includes("/standings") ||
      href.includes("/odds") ||
      href.includes("/next-matches") ||
      href.includes("/?")
    ) continue;

    // Must contain a score separator to be a result
    if (!EN_DASH.test(text)) continue;

    // Remove status prefix
    const cleaned = text.replace(STATUS_PREFIX, "");

    // Find score: digits – digits (the scoreline embedded in the text)
    const scoreMatch = cleaned.match(/(\d+)([\u2013\u2014\-])(\d+)/);
    if (!scoreMatch) continue;

    const rawHome = scoreMatch[1]; // e.g. "44" for score 4, "1010" for score 10
    const rawAway = scoreMatch[3]; // just the scoreline away digits (e.g. "0")

    // Home score appears doubled before "–"; take the first half
    const homeScore = parseInt(rawHome.slice(0, Math.ceil(rawHome.length / 2)), 10);
    const awayScore = parseInt(rawAway, 10);
    if (isNaN(homeScore) || isNaN(awayScore)) continue;

    const scoreStr = scoreMatch[0];
    const scoreIdx = cleaned.indexOf(scoreStr);
    const beforeScore = cleaned.slice(0, scoreIdx);
    const afterScore  = cleaned.slice(scoreIdx + scoreStr.length);

    // Home team = text before score, strip trailing score digits
    const homeTeam = beforeScore.replace(/\d+$/, "").trim();
    // Away team = text after score.
    // Two possible formats:
    //  a) Canonical <a> wrapping whole row: "TeamName{awayScore}" — strip trailing digit
    //  b) H2H parent container text: "TeamName{awayScore}{odds...}" — strip from first digit
    // Strategy: strip everything from the first digit onwards, then fall back to
    // just stripping the trailing digit if the result would be empty.
    const awayNoDigit = afterScore.replace(/\d[\s\S]*$/, "").replace(/[-\s]+$/, "").trim();
    const awayTrailingDigit = afterScore.replace(/\d+$/, "").trim();
    const awayTeam = awayNoDigit.length > 1 ? awayNoDigit : awayTrailingDigit;

    if (!homeTeam || !awayTeam) continue;

    // Parse date from the DOM header or fallback to year
    let matchDate = new Date().toISOString().slice(0, 10);
    if (date) {
      const parsed = parseDateText(date);
      if (parsed && !isNaN(Date.parse(parsed))) matchDate = parsed;
    }

    // Extract match hash — from H2H anchor fragment (#AbCdEfGh) or trailing slug part
    let matchHash = "";
    const fragment = href.split("#")[1] ?? "";
    if (fragment && fragment.length >= 6) {
      matchHash = fragment;
    } else {
      // Fallback: last path segment's trailing alphanumeric
      const lastSeg = href.split("/").filter(Boolean).pop() ?? "";
      const m = lastSeg.match(/([A-Za-z0-9]{6,})$/);
      if (m) matchHash = m[1];
    }

    // Build a normalised match URL
    // H2H URL format: /football/h2h/{team1-HASH}/{team2-HASH}/#matchHash
    // We store the canonical H2H URL so odds can be fetched later via the hash
    const matchUrl = href.startsWith("http") ? new URL(href).pathname + (fragment ? `#${fragment}` : "") : href;

    matches.push({
      date: matchDate,
      homeTeam,
      awayTeam,
      homeScore,
      awayScore,
      matchUrl,
      matchHash,
    });
  }

  return matches;
}

// ── Shared page-content parser ────────────────────────────────────────────────

function extractMatchesFromContent(
  html: string,
  intercepted: InterceptedResponse[],
  domLinks: DomLink[],
  url: string,
  onProgress?: (msg: string) => void
): OPMatch[] {
  let pageMatches: OPMatch[] = [];

  // 1. Intercepted API responses (most reliable when available)
  pageMatches = parseInterceptedMatches(intercepted, url);
  if (pageMatches.length > 0) {
    onProgress?.(`  API intercept: found ${pageMatches.length} matches`);
    return pageMatches;
  }

  // 2. Rendered DOM links — primary method for OddsPortal's CSR Vue SPA
  //    (as of 2025 OddsPortal uses encrypted responses; only the rendered DOM has the data)
  if (domLinks.length > 0) {
    const yearGuess = new Date().getFullYear();
    pageMatches = parseDomMatchLinks(domLinks, yearGuess);
    if (pageMatches.length > 0) {
      onProgress?.(`  DOM links: found ${pageMatches.length} matches`);
      return pageMatches;
    }
  }

  // 3. __NEXT_DATA__ embedded JSON (legacy, OddsPortal SSR era)
  const nextData = extractNextData(html);
  if (nextData) {
    pageMatches = parseNextDataMatches(nextData, url);
    if (pageMatches.length > 0) {
      onProgress?.(`  __NEXT_DATA__: found ${pageMatches.length} matches`);
      return pageMatches;
    }
  }

  // 4. Classic HTML table parsing (very old OddsPortal)
  pageMatches = parseHtmlMatches(html, url);
  if (pageMatches.length > 0) {
    onProgress?.(`  HTML parse: found ${pageMatches.length} matches`);
  }
  return pageMatches;
}

// ── Fetch match list with pagination ─────────────────────────────────────────

export async function fetchMatchList(
  oddsPortalPath: string,
  year: number,
  onProgress?: (msg: string) => void
): Promise<OPMatch[]> {
  // Build candidate URLs (try in order: correct format first, then fallbacks)
  const candidateUrls = buildResultsUrlCandidates(oddsPortalPath, year);
  const startUrl = candidateUrls[0];
  onProgress?.(`Fetching match list from OddsPortal: ${startUrl}`);

  const allMatches: OPMatch[] = [];
  const seen = new Set<string>();
  const MAX_PAGES = 20;

  function addMatches(pageMatches: OPMatch[]): number {
    let newCount = 0;
    for (const m of pageMatches) {
      const key = `${m.date}|${m.homeTeam}|${m.awayTeam}`;
      if (!seen.has(key)) { seen.add(key); allMatches.push(m); newCount++; }
    }
    return newCount;
  }

  // ── Attempt 1: plain HTTP (fast, no JS rendering) ─────────────────────────
  // Try each candidate URL until one returns match data
  let workingPlainUrl: string | null = null;
  for (const candidateUrl of candidateUrls) {
    onProgress?.(`[plain] Trying ${candidateUrl}`);
    const result = await opFetch(candidateUrl);
    if (result.blocked) {
      onProgress?.(`⚠ Plain fetch blocked by Cloudflare — switching to browser mode`);
      workingPlainUrl = null;
      break;
    }
    if (!result.html) continue;
    const pageMatches = extractMatchesFromContent(result.html, [], [], candidateUrl, onProgress);
    if (pageMatches.length > 0) {
      workingPlainUrl = candidateUrl;
      const newCount = addMatches(pageMatches);
      onProgress?.(`  +${newCount} new (total: ${allMatches.length})`);
      break;
    }
  }

  // If plain first page worked, continue paginating
  if (workingPlainUrl && allMatches.length > 0) {
    let url: string | null = null;
    {
      const r = await opFetch(workingPlainUrl);
      url = r.html ? findNextPageUrl(r.html, workingPlainUrl) : null;
    }
    let page = 2;
    while (url && page <= MAX_PAGES) {
      onProgress?.(`[plain] Fetching page ${page}…`);
      const result = await opFetch(url);
      if (!result.html) { onProgress?.(`⚠ Could not fetch page ${page}`); break; }
      const pageMatches = extractMatchesFromContent(result.html, [], [], url, onProgress);
      if (pageMatches.length === 0) { onProgress?.(`  No matches on page ${page} — stopping`); break; }
      const newCount = addMatches(pageMatches);
      onProgress?.(`  +${newCount} new (total: ${allMatches.length})`);
      const nextUrl = findNextPageUrl(result.html, url);
      url = nextUrl; page++;
      if (url) await new Promise(r => setTimeout(r, 1500));
    }
  }

  if (allMatches.length > 0) {
    onProgress?.(`Match list complete (plain fetch): ${allMatches.length} matches`);
    return allMatches;
  }

  // ── Attempt 2: Playwright browser (bypasses Cloudflare + handles CSR) ─────
  // OddsPortal uses a Vue SPA with encrypted API responses; data only exists in
  // the rendered DOM which Playwright extracts via page.evaluate() DOM walker.
  onProgress?.(`🌐 Launching browser (Playwright/Chromium)…`);
  onProgress?.(`   OddsPortal CSR: match data extracted from rendered DOM (~25-40 s/page)`);

  // Find the first candidate URL that the browser can load successfully
  let browserStartUrl = startUrl;
  for (const candidateUrl of candidateUrls) {
    onProgress?.(`[browser] Trying ${candidateUrl}`);
    const probe = await browserFetch(candidateUrl);
    if (probe.blocked) {
      onProgress?.(`❌ Browser blocked by Cloudflare at ${candidateUrl}`);
      continue;
    }
    if (!probe.html) {
      onProgress?.(`⚠ Browser got no content for ${candidateUrl}`);
      continue;
    }
    // Check if this URL yielded any matches (DOM or HTML)
    const probeMatches = extractMatchesFromContent(probe.html, probe.intercepted, probe.domLinks, candidateUrl, onProgress);
    if (probeMatches.length > 0) {
      browserStartUrl = candidateUrl;
      const newCount = addMatches(probeMatches);
      onProgress?.(`  +${newCount} new from page 1 (total: ${allMatches.length})`);
      break;
    }
    onProgress?.(`  No matches at ${candidateUrl} — trying next candidate`);
  }

  if (allMatches.length === 0) {
    onProgress?.(`⚠ No matches found at any candidate URL — OddsPortal may have changed or the league slug is incorrect`);
    return allMatches;
  }

  // Paginate remaining pages with the working URL
  for (let page = 2; page <= MAX_PAGES; page++) {
    onProgress?.(`[browser] Fetching page ${page}…`);
    const result = await browserFetchHashPage(browserStartUrl, page);

    if (result.blocked) {
      onProgress?.(`❌ Browser blocked by Cloudflare on page ${page}`);
      break;
    }
    if (!result.html) {
      onProgress?.(`⚠ Browser got no content on page ${page}`);
      break;
    }

    const pageMatches = extractMatchesFromContent(result.html, result.intercepted, result.domLinks, browserStartUrl, onProgress);
    if (pageMatches.length === 0) {
      onProgress?.(`  No matches on page ${page} — pagination complete`);
      break;
    }

    const newCount = addMatches(pageMatches);
    onProgress?.(`  +${newCount} new (total: ${allMatches.length})`);

    if (!findNextPageUrl(result.html, browserStartUrl)) break;
    await new Promise(r => setTimeout(r, 1000));
  }

  onProgress?.(`Match list complete (browser): ${allMatches.length} matches`);
  return allMatches;
}

// ── Fetch odds for a single match ─────────────────────────────────────────────

/**
 * Fetch bookmaker odds for one match.
 *
 * Strategy:
 *  1. Construct canonical match page URL from hash + league path + team slugs
 *  2. Try plain HTTP (fast) — usually blocked by Cloudflare
 *  3. Use Playwright with persistent context:
 *     a. Remove classification headers (flex items-center justify-start)
 *     b. Expand all market sections (flex w-full items-center)
 *     c. Simulate mouseenter on bookmaker cells → capture opening odds popups
 *     d. Get full body.innerText
 *  4. Apply RegEx extraction on the innerText (based on OddsPortal 2025 DOM)
 */
export async function fetchMatchOdds(
  match:          OPMatch,
  oddsPortalPath: string,
  onProgress?:    (msg: string) => void
): Promise<Partial<OPMatchOdds>> {
  const odds: Partial<OPMatchOdds> = {};

  // ── Resolve the correct match page URL ────────────────────────────────────
  // DOM extraction from results pages gives H2H URLs (/football/h2h/.../#hash).
  // H2H pages don't load bookmaker odds — navigate to the canonical page instead.
  let matchPageUrl = "";

  if (match.matchHash && oddsPortalPath) {
    matchPageUrl = buildMatchPageUrl(match.homeTeam, match.awayTeam, match.matchHash, oddsPortalPath);
    onProgress?.(`  URL resolved: canonical (hash=${match.matchHash}) → ${matchPageUrl}`);
  }
  if (!matchPageUrl && match.matchUrl) {
    matchPageUrl = match.matchUrl.startsWith("http")
      ? match.matchUrl
      : `${OP_BASE}${match.matchUrl}`;
    onProgress?.(`  URL resolved: fallback matchUrl → ${matchPageUrl}`);
  }
  if (!matchPageUrl) {
    onProgress?.(`  ⚠ No usable URL for match (hash=${match.matchHash ?? "none"}, matchUrl=${match.matchUrl ?? "none"})`);
    return odds;
  }

  onProgress?.(`  Fetching odds: ${matchPageUrl}`);

  // ── Attempt 1: plain HTTP (fast, no JS) ───────────────────────────────────
  const plainResult = await opFetch(matchPageUrl);
  if (plainResult.html && !plainResult.blocked) {
    const nextData = extractNextData(plainResult.html);
    if (nextData) extractOddsFromNextData(nextData, odds);
    if (!odds["1x2"] || odds["1x2"].length === 0) extract1x2FromHtml(plainResult.html, odds);
    if (match.matchHash) await fetchMarketOddsFromApi(match.matchHash, matchPageUrl, odds, onProgress);
  }
  if (Object.keys(odds).length > 0) {
    onProgress?.(`  ✓ ${Object.keys(odds).length} markets (plain fetch)`);
    return odds;
  }

  // ── Attempt 2: Playwright browser — header removal + section expansion + hover ──
  onProgress?.(`  🌐 Using browser for odds…`);

  const browserResult: OddsPageResult = await fetchOddsPage(matchPageUrl);

  if (browserResult.blocked) {
    onProgress?.(`  ❌ Browser blocked — no odds available`);
    return odds;
  }
  if (!browserResult.html) {
    onProgress?.(`  ⚠ Browser returned no content`);
    return odds;
  }

  // Primary: RegEx on full body.innerText (OddsPortal 2025 Vue SPA)
  // This is the most reliable method — the reference gist proves the DOM text structure.
  if (browserResult.pageText && browserResult.pageText.length > 100) {
    parseOddsFromPageText(browserResult.pageText, browserResult.popupTexts ?? {}, odds);
    if (Object.keys(odds).length > 0) {
      const markets = Object.keys(odds).length;
      const bms = (odds["1x2"] ?? odds["ou"] ?? odds["ah"] ?? []  as BookmakerEntry[]).length;
      onProgress?.(`  ✓ ${markets} markets, ${bms} bookmakers (text/regex)`);
      return odds;
    }
  }

  // Fallback A: intercepted JSON API responses
  if (browserResult.intercepted.length > 0) {
    parseInterceptedOdds(browserResult.intercepted, odds);
  }

  // Fallback B: DOM row walk
  if (browserResult.oddsRows && browserResult.oddsRows.length > 0) {
    parseDomOddsRowsFallback(browserResult.oddsRows, odds);
  }

  // Fallback C: __NEXT_DATA__
  if (Object.keys(odds).length === 0) {
    const nextData = extractNextData(browserResult.html);
    if (nextData) extractOddsFromNextData(nextData, odds);
  }

  // Fallback D: HTML table parsing
  if (!odds["1x2"] || odds["1x2"].length === 0) {
    extract1x2FromHtml(browserResult.html, odds);
  }

  const marketCount = Object.keys(odds).length;
  onProgress?.(`  ${marketCount > 0 ? `✓ ${marketCount} markets` : "⚠ no odds"} (browser/fallback)`);
  return odds;
}

// ── RegEx odds extraction from body.innerText ─────────────────────────────────
//
// OddsPortal 2025 Vue SPA renders a text structure like:
//
//   Bet365
//   2.10
//   3.20
//   3.40
//   85%
//   Pinnacle
//   1.78
//   3.61
//   4.54
//   94%
//   ...
//   Over/Under +2.5
//   Bet365
//   +2.5
//   1.91
//   1.95
//   91%
//
// Reference technique (from OddsPortal scraping gist):
//   Closing 1X2: bookmaker[^\d-]*(.*)      ← home
//                bookmaker[^\d-]*.*\s*(.*) ← draw
//                bookmaker[^\d-]*.*\s*.*\s*(.*) ← away
//   O/U:         same pattern — capture 1 = line value (+2.5), 2 = over, 3 = under
//   Section expand: click "flex w-full items-center" elements before reading text
//   Opening odds popup: "Opening odds:\r\n.*\r\n(.*)"

/** Keyword patterns that identify market section headers in innerText */
const SECTION_PATTERNS: Array<{ key: keyof OPMatchOdds; patterns: RegExp[] }> = [
  { key: "1x2",  patterns: [/^1X2$/m, /^Home\/Draw\/Away$/im] },
  { key: "ou",   patterns: [/^Over\/Under \+[\d.]+$/m] },
  { key: "ah",   patterns: [/^Asian Handicap [+-]?[\d.]+$/im] },
  { key: "btts", patterns: [/^Both Teams to Score$/im] },
  { key: "dc",   patterns: [/^Double Chance$/im] },
  { key: "dnb",  patterns: [/^Draw No Bet$/im] },
  { key: "eh",   patterns: [/^European Handicap/im] },
  { key: "cs",   patterns: [/^Correct Score$/im] },
  { key: "htft", patterns: [/^Half Time\/Full Time$/im] },
  { key: "oe",   patterns: [/^Odd\/Even$/im, /^Odd or Even$/im] },
];

/**
 * Parse full body.innerText from an OddsPortal match page into structured odds.
 * Uses the RegEx patterns from the reference gist — works for all bookmakers.
 *
 * @param text       Full document.body.innerText after section expansion
 * @param popupTexts Per-cell popup texts keyed as "{bookmaker}|{hda}" (1=home,2=draw,3=away)
 * @param odds       Output object — populated in-place
 */
function parseOddsFromPageText(
  text:        string,
  popupTexts:  Record<string, string>,
  odds:        Partial<OPMatchOdds>
): void {
  if (!text) return;

  // Normalise line endings and COLLAPSE multiple consecutive blank lines into one.
  // OddsPortal's Vue SPA (flex layout) renders empty lines between every element;
  // the parser breaks on the first empty line, so collapsing fixes extraction.
  const normalized = text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\n{2,}/g, "\n");

  // ── Split into market sections ─────────────────────────────────────────────
  // Find the character offset of each market section header in the text.
  // We use these to slice the text and parse each section independently.
  const sectionOffsets: Array<{ key: keyof OPMatchOdds; start: number; label: string }> = [];

  for (const { key, patterns } of SECTION_PATTERNS) {
    for (const pat of patterns) {
      const m = normalized.match(pat);
      if (m && m.index !== undefined) {
        sectionOffsets.push({ key, start: m.index, label: m[0] });
        break;
      }
    }
  }

  // Sort by appearance order in the text
  sectionOffsets.sort((a, b) => a.start - b.start);

  if (sectionOffsets.length === 0) {
    // No clear section headers — try to parse the whole page as 1x2
    const entries = parseBookmakerSection(normalized, "1x2");
    if (entries.length > 0) odds["1x2"] = entries;
    return;
  }

  // Parse each section between its start and the next section's start
  for (let i = 0; i < sectionOffsets.length; i++) {
    const { key, start } = sectionOffsets[i];
    const end = sectionOffsets[i + 1]?.start ?? normalized.length;
    const sectionText = normalized.slice(start, end);
    const entries = parseBookmakerSection(sectionText, key);
    if (entries.length > 0) {
      (odds as Record<string, BookmakerEntry[]>)[key] = entries;
    }
  }

  // ── Merge opening odds from popup texts ───────────────────────────────────
  // popupTexts is keyed "{bookmakerName}|{hda}" where hda=1 (home), 2 (draw), 3 (away).
  // The popup innerText has the format: "…Opening odds:\n{date/line}\n{value}…"
  if (Object.keys(popupTexts).length > 0 && odds["1x2"] && odds["1x2"].length > 0) {
    const hdaKeys = ["1", "X", "2"] as const;
    for (const entry of odds["1x2"]) {
      const openingOdds: Record<string, number> = {};
      for (const hda of [1, 2, 3] as const) {
        const popupKey = `${entry.bookmaker}|${hda}`;
        const popup = popupTexts[popupKey] ?? "";
        const openMatch = popup.match(/Opening odds:\n.*\n([\d.]+)/i);
        if (openMatch) {
          const val = parseFloat(openMatch[1]);
          if (val >= 1.01 && val <= 100) {
            openingOdds[hdaKeys[hda - 1]] = val;
          }
        }
      }
      if (Object.keys(openingOdds).length > 0) {
        entry.openingOdds = openingOdds;
      }
    }
  }
}

/**
 * Parse bookmaker rows from a market section's text.
 *
 * For each market type, a bookmaker row in the innerText looks like:
 *   Bet365          ← bookmaker name line (starts with capital, no digits)
 *   2.10            ← value 1 (for 1x2: home; for O/U: line value like +2.5)
 *   3.20            ← value 2 (draw / over)
 *   3.40            ← value 3 (away / under)  — absent for 2-outcome markets
 *   85%             ← bookmaker margin (ignored)
 *
 * Uses the reference gist regex pattern: bookmaker[^\d-]*(val1)\n(val2)\n(val3)
 * Applied generically across all bookmakers found in the section.
 */
function parseBookmakerSection(sectionText: string, market: keyof OPMatchOdds): BookmakerEntry[] {
  const entries: BookmakerEntry[] = [];
  const lines = sectionText.split("\n");

  // Lines to always skip (promotional / UI chrome that appear between bookmaker names
  // and their odds values — e.g. OddsPortal US shows "CLAIM BONUS" after bookmaker name)
  const SKIP_LINE = /^(CLAIM\s*BONUS|CLAIM|VISIT\s*BOOKMAKER|GET\s*BONUS|SIGN\s*UP|JOIN\s*NOW|MY\s*COUPON|REGISTER|LOGIN|BET\s*NOW|FREE\s*BET)$/i;

  let i = 0;
  while (i < lines.length) {
    const line = lines[i].trim();

    // A bookmaker name line: starts with a capital letter, no leading digits,
    // length 2–60, does not look like a score or percentage.
    if (
      line.length >= 2 &&
      line.length <= 60 &&
      /^[A-Z]/.test(line) &&
      !/^\d/.test(line) &&
      !/^[\d.]+$/.test(line) &&
      !line.endsWith("%") &&
      !line.includes(":") &&
      !line.match(/^\d+[–\-]\d+$/) &&
      !SKIP_LINE.test(line)
    ) {
      // Collect the next up to 6 lines that look like numeric values,
      // skipping promotional lines ("CLAIM BONUS", "VISIT BOOKMAKER", etc.)
      const vals: string[] = [];
      let j = i + 1;
      while (j < lines.length && vals.length < 6) {
        const vl = lines[j].trim();
        // Skip promotional lines without breaking
        if (SKIP_LINE.test(vl)) { j++; continue; }
        // A value line: decimal number, optionally prefixed with + or -
        if (/^[+-]?\d+\.?\d*$/.test(vl)) {
          vals.push(vl);
          j++;
        } else if (vl === "" || vl.endsWith("%") || vl.length > 20) {
          break;
        } else {
          j++;
        }
      }

      if (vals.length >= 2) {
        const entry = buildBookmakerEntry(line, vals, market);
        if (entry) {
          entries.push(entry);
          i = j; // skip past consumed value lines
          continue;
        }
      }
    }
    i++;
  }

  return entries;
}

/**
 * Build a BookmakerEntry from a bookmaker name + list of value strings.
 *
 * Market layouts:
 *  1x2:  val[0]=home, val[1]=draw, val[2]=away
 *  ou:   val[0]=line (+2.5 etc.), val[1]=over, val[2]=under
 *  ah:   val[0]=handicap, val[1]=homeOdd, val[2]=awayOdd
 *  btts: val[0]=yes, val[1]=no
 *  dc:   val[0]=1X, val[1]=12, val[2]=X2
 *  dnb:  val[0]=home, val[1]=away
 *  eh:   val[0]=handicap, val[1]=home, val[2]=draw, val[3]=away
 *  htft: multiple values (first win/draw/loss combos)
 *  oe:   val[0]=odd, val[1]=even
 */
function buildBookmakerEntry(
  name:   string,
  vals:   string[],
  market: keyof OPMatchOdds
): BookmakerEntry | null {
  const num = (s: string) => parseFloat(s);
  const valid = (v: number) => !isNaN(v) && v >= 1.01 && v <= 1000;

  switch (market) {
    case "1x2": {
      if (vals.length < 3) return null;
      const [h, d, a] = [num(vals[0]), num(vals[1]), num(vals[2])];
      if (!valid(h) || !valid(d) || !valid(a)) return null;
      return { bookmaker: name, odds: { "1": h, "X": d, "2": a } };
    }
    case "ou": {
      // vals[0] = line (+2.5), vals[1] = over, vals[2] = under
      // OR vals[0] = over, vals[1] = under (no line prefix)
      if (vals.length < 2) return null;
      const hasLine = vals[0].startsWith("+") || vals[0].startsWith("-");
      const line  = hasLine ? num(vals[0]) : NaN;
      const over  = hasLine ? num(vals[1]) : num(vals[0]);
      const under = hasLine ? num(vals[2] ?? "") : num(vals[1]);
      if (!valid(over) || !valid(under)) return null;
      const o: Record<string, number> = { over, under };
      if (!isNaN(line)) o["line"] = line;
      return { bookmaker: name, odds: o };
    }
    case "ah": {
      if (vals.length < 2) return null;
      const hasHcap = vals[0].startsWith("+") || vals[0].startsWith("-");
      const hcap  = hasHcap ? num(vals[0]) : NaN;
      const home  = num(hasHcap ? vals[1] : vals[0]);
      const away  = num(hasHcap ? (vals[2] ?? "") : vals[1]);
      if (!valid(home)) return null;
      const o: Record<string, number> = { home };
      if (valid(away)) o["away"] = away;
      if (!isNaN(hcap)) o["handicap"] = hcap;
      return { bookmaker: name, odds: o };
    }
    case "btts": {
      if (vals.length < 2) return null;
      const [yes, no] = [num(vals[0]), num(vals[1])];
      if (!valid(yes) || !valid(no)) return null;
      return { bookmaker: name, odds: { yes, no } };
    }
    case "dc": {
      if (vals.length < 2) return null;
      const [v1, v2, v3] = [num(vals[0]), num(vals[1]), vals[2] ? num(vals[2]) : NaN];
      if (!valid(v1) || !valid(v2)) return null;
      const o: Record<string, number> = { "1X": v1, "12": v2 };
      if (valid(v3)) o["X2"] = v3;
      return { bookmaker: name, odds: o };
    }
    case "dnb": {
      if (vals.length < 2) return null;
      const [h, a] = [num(vals[0]), num(vals[1])];
      if (!valid(h) || !valid(a)) return null;
      return { bookmaker: name, odds: { home: h, away: a } };
    }
    case "eh": {
      if (vals.length < 3) return null;
      const hasHcap = vals[0].startsWith("+") || vals[0].startsWith("-");
      if (hasHcap) {
        const hcap = num(vals[0]);
        const [h, d, a] = [num(vals[1]), num(vals[2]), num(vals[3] ?? "")];
        if (!valid(h)) return null;
        const o: Record<string, number> = { handicap: hcap, "1": h };
        if (valid(d)) o["X"] = d;
        if (valid(a)) o["2"] = a;
        return { bookmaker: name, odds: o };
      }
      const [h, d, a] = [num(vals[0]), num(vals[1]), num(vals[2])];
      if (!valid(h) || !valid(d)) return null;
      return { bookmaker: name, odds: { "1": h, "X": d, "2": a } };
    }
    case "htft": {
      if (vals.length < 4) return null;
      const o: Record<string, number> = {};
      const labels = ["1/1","1/X","1/2","X/1","X/X","X/2","2/1","2/X","2/2"];
      for (let k = 0; k < Math.min(vals.length, labels.length); k++) {
        const v = num(vals[k]);
        if (valid(v)) o[labels[k]] = v;
      }
      return Object.keys(o).length >= 4 ? { bookmaker: name, odds: o } : null;
    }
    case "oe": {
      if (vals.length < 2) return null;
      const [odd, even] = [num(vals[0]), num(vals[1])];
      if (!valid(odd) || !valid(even)) return null;
      return { bookmaker: name, odds: { odd, even } };
    }
    case "cs": {
      // Correct score: many values, skip for now
      return null;
    }
    default:
      return null;
  }
}

// ── DOM-row fallback (when pageText is unavailable) ───────────────────────────

function parseDomOddsRowsFallback(rows: OddsRow[], odds: Partial<OPMatchOdds>): void {
  const entries1x2: BookmakerEntry[] = [];
  const entries2val: BookmakerEntry[] = [];

  for (const { bookmaker, values } of rows) {
    if (!bookmaker || values.length < 2) continue;
    if (!values.every(v => v >= 1.01 && v <= 500)) continue;

    if (values.length === 3) {
      entries1x2.push({ bookmaker, odds: { "1": values[0], "X": values[1], "2": values[2] } });
    } else if (values.length === 2) {
      entries2val.push({ bookmaker, odds: { yes: values[0], no: values[1] } });
    }
  }

  if (entries1x2.length > 0 && (!odds["1x2"] || odds["1x2"].length === 0))
    odds["1x2"] = entries1x2;
  if (entries2val.length > 0 && (!odds["btts"] || odds["btts"].length === 0))
    odds["btts"] = entries2val;
}

function extractOddsFromNextData(data: Record<string, unknown>, odds: Partial<OPMatchOdds>) {
  const pages = dig(data, "props", "pageProps");
  if (!pages || typeof pages !== "object") return;

  const rawOdds = (pages as Record<string, unknown>)["odds"] ??
                  (pages as Record<string, unknown>)["initialOdds"] ??
                  (pages as Record<string, unknown>)["marketOdds"];
  if (!rawOdds || typeof rawOdds !== "object") return;

  const markets: Record<string, string> = {
    "1x2": "1x2", "over-under": "ou", "asian-handicap": "ah",
    "both-teams-to-score": "btts", "double-chance": "dc",
    "european-handicap": "eh", "draw-no-bet": "dnb",
    "correct-score": "cs", "half-time-full-time": "htft",
    "odd-even": "oe",
  };

  for (const [rawKey, targetKey] of Object.entries(markets)) {
    const data = (rawOdds as Record<string, unknown>)[rawKey] ??
                 (rawOdds as Record<string, unknown>)[targetKey];
    if (!Array.isArray(data)) continue;
    (odds as Record<string, BookmakerEntry[]>)[targetKey] = parseBookmakerArray(data, targetKey);
  }
}

function parseBookmakerArray(arr: unknown[], market: string): BookmakerEntry[] {
  const entries: BookmakerEntry[] = [];
  for (const item of arr) {
    if (!item || typeof item !== "object") continue;
    const e = item as Record<string, unknown>;
    const bookmaker = String(e["bookmakerName"] ?? e["name"] ?? e["bookie"] ?? "Unknown");
    const oddsData: Record<string, number> = {};

    if (market === "1x2") {
      if (e["home"]) oddsData["1"] = Number(e["home"]);
      if (e["draw"]) oddsData["X"] = Number(e["draw"]);
      if (e["away"]) oddsData["2"] = Number(e["away"]);
    } else if (market === "ou") {
      if (e["over"]) oddsData["over"] = Number(e["over"]);
      if (e["under"]) oddsData["under"] = Number(e["under"]);
      if (e["line"]) oddsData["line"] = Number(e["line"]);
    } else if (market === "ah") {
      if (e["home"]) oddsData["home"] = Number(e["home"]);
      if (e["away"]) oddsData["away"] = Number(e["away"]);
      if (e["handicap"]) oddsData["handicap"] = Number(e["handicap"]);
    } else if (market === "btts") {
      if (e["yes"]) oddsData["yes"] = Number(e["yes"]);
      if (e["no"])  oddsData["no"]  = Number(e["no"]);
    } else if (market === "cs") {
      // Correct score: scores as keys
      for (const [k, v] of Object.entries(e)) {
        if (/^\d+[:-]\d+$/.test(k)) oddsData[k] = Number(v);
      }
    } else {
      // Generic: copy all numeric fields
      for (const [k, v] of Object.entries(e)) {
        if (typeof v === "number" && k !== "id" && k !== "bookmakerOddsId") {
          oddsData[k] = v;
        }
      }
    }

    if (Object.keys(oddsData).length > 0) entries.push({ bookmaker, odds: oddsData });
  }
  return entries;
}

function extract1x2FromHtml(html: string, odds: Partial<OPMatchOdds>) {
  const $ = cheerio.load(html);
  const entries: BookmakerEntry[] = [];

  // Look for odds table rows
  $("tr").each((_, row) => {
    const $row = $(row);
    const bookmakerEl = $row.find("td.bookmaker a, td.name a").first();
    const bookmaker = bookmakerEl.text().trim();
    if (!bookmaker) return;

    const tds = $row.find("td");
    const nums: number[] = [];
    tds.each((_, td) => {
      const t = $(td).text().trim();
      const n = parseFloat(t);
      if (!isNaN(n) && n > 1.0 && n < 100) nums.push(n);
    });

    if (nums.length >= 3) {
      entries.push({
        bookmaker,
        odds: { "1": nums[0], "X": nums[1], "2": nums[2] },
      });
    }
  });

  if (entries.length > 0) odds["1x2"] = entries;
}

async function fetchMarketOddsFromApi(
  matchHash: string,
  referer: string,
  odds: Partial<OPMatchOdds>,
  onProgress?: (msg: string) => void
) {
  if (!matchHash || matchHash.length < 4) return;

  // OddsPortal internal API — they use betTypeId + scopeId integers.
  // betTypeId: 1=1x2, 2=O/U, 5=AH, 8=BTTS, 9=DC, 10=DNB, 11=EH, 12=CS, 13=HTFT, 16=OE
  // scopeId:   2=FT, 4=1H, 6=2H (we default to FT=2)
  // Current pattern: /api/v1/event-row/{hash}/{betTypeId}/{scopeId}/
  // Legacy pattern:  /api/v1/event/{hash}/{market-slug}/
  const apiPatterns: Array<{ market: keyof OPMatchOdds; urls: string[] }> = [
    { market: "1x2",  urls: [`${OP_BASE}/api/v1/event-row/${matchHash}/1/2/`, `${OP_BASE}/api/v1/event/${matchHash}/1x2/`] },
    { market: "ou",   urls: [`${OP_BASE}/api/v1/event-row/${matchHash}/2/2/`, `${OP_BASE}/api/v1/event/${matchHash}/over-under/`] },
    { market: "ah",   urls: [`${OP_BASE}/api/v1/event-row/${matchHash}/5/2/`, `${OP_BASE}/api/v1/event/${matchHash}/asian-handicap/`] },
    { market: "btts", urls: [`${OP_BASE}/api/v1/event-row/${matchHash}/8/2/`, `${OP_BASE}/api/v1/event/${matchHash}/both-teams-score/`] },
    { market: "dc",   urls: [`${OP_BASE}/api/v1/event-row/${matchHash}/9/2/`, `${OP_BASE}/api/v1/event/${matchHash}/double-chance/`] },
    { market: "dnb",  urls: [`${OP_BASE}/api/v1/event-row/${matchHash}/10/2/`, `${OP_BASE}/api/v1/event/${matchHash}/draw-no-bet/`] },
    { market: "eh",   urls: [`${OP_BASE}/api/v1/event-row/${matchHash}/11/2/`, `${OP_BASE}/api/v1/event/${matchHash}/european-handicap/`] },
    { market: "cs",   urls: [`${OP_BASE}/api/v1/event-row/${matchHash}/12/2/`, `${OP_BASE}/api/v1/event/${matchHash}/correct-score/`] },
    { market: "htft", urls: [`${OP_BASE}/api/v1/event-row/${matchHash}/13/2/`, `${OP_BASE}/api/v1/event/${matchHash}/half-time-full-time/`] },
    { market: "oe",   urls: [`${OP_BASE}/api/v1/event-row/${matchHash}/16/2/`, `${OP_BASE}/api/v1/event/${matchHash}/odd-even/`] },
  ];

  const headers = { ...OP_API_HEADERS, "Referer": referer };

  for (const { market, urls } of apiPatterns) {
    // Skip if we already have good data for this market
    const existing = (odds as Record<string, BookmakerEntry[]>)[market];
    if (existing && existing.length > 2) continue;

    for (const url of urls) {
      try {
        const resp = await fetch(url, {
          headers,
          signal: AbortSignal.timeout(8000),
        });
        // 404 with no body = Cloudflare block, not a real 404 — skip all remaining
        if (!resp.ok) {
          const body = await resp.text();
          if (body.length === 0) return; // Cloudflare silently dropping all API calls
          continue;
        }

        const contentType = resp.headers.get("content-type") ?? "";
        if (!contentType.includes("json")) continue;

        const json = await resp.json() as Record<string, unknown>;
        // OddsPortal wraps in {d: ...} or {data: ...} depending on version
        const data = json["d"] ?? json["data"] ?? json["odds"] ?? json["rows"] ?? json;

        if (Array.isArray(data)) {
          const parsed = parseBookmakerArray(data, market);
          if (parsed.length > 0) {
            (odds as Record<string, BookmakerEntry[]>)[market] =
              market === "cs" ? filterTopCsOdds(parsed) : parsed;
            break; // got data from this URL, skip fallbacks
          }
        } else if (typeof data === "object" && data !== null) {
          const arr = Object.values(data).flat();
          const parsed = parseBookmakerArray(arr as unknown[], market);
          if (parsed.length > 0) {
            (odds as Record<string, BookmakerEntry[]>)[market] =
              market === "cs" ? filterTopCsOdds(parsed) : parsed;
            break;
          }
        }
      } catch { /* ignore per-market errors */ }

      await new Promise(r => setTimeout(r, 200));
    }
  }
}

/** Keep only the top 5 most popular correct scores (lowest average odds = most likely) */
function filterTopCsOdds(entries: BookmakerEntry[]): BookmakerEntry[] {
  if (entries.length === 0) return entries;

  // Aggregate all scores across bookmakers, compute average odds
  const scoreAccum: Record<string, { sum: number; count: number }> = {};
  for (const e of entries) {
    for (const [score, odd] of Object.entries(e.odds)) {
      if (!scoreAccum[score]) scoreAccum[score] = { sum: 0, count: 0 };
      scoreAccum[score].sum += odd;
      scoreAccum[score].count++;
    }
  }

  // Sort by lowest avg odds (= most likely) and take top 10 (5 home wins + 5 away wins splits)
  const sorted = Object.entries(scoreAccum)
    .map(([score, { sum, count }]) => ({ score, avgOdds: sum / count }))
    .sort((a, b) => a.avgOdds - b.avgOdds)
    .slice(0, 10)
    .map(s => s.score);

  const topSet = new Set(sorted);

  return entries.map(e => ({
    bookmaker: e.bookmaker,
    odds: Object.fromEntries(
      Object.entries(e.odds).filter(([score]) => topSet.has(score))
    ),
  })).filter(e => Object.keys(e.odds).length > 0);
}
