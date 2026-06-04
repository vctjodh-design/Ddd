/**
 * OddsPortal scraper — fetches match lists and bookmaker odds.
 * Uses direct HTTP fetch + cheerio HTML parsing + __NEXT_DATA__ JSON extraction.
 * Resilient: gracefully handles Cloudflare blocks and missing markets.
 */
import * as cheerio from "cheerio";

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
  odds: Record<string, number>;
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

// ── Build the results URL ────────────────────────────────────────────────────

function buildResultsUrl(oddsPortalPath: string, year: number): string {
  // oddsPortalPath = "usa/usl-championship" or "england/premier-league"
  const parts = oddsPortalPath.split("/");
  const country = parts[0];
  const league  = parts.slice(1).join("/");
  const currentYear = new Date().getFullYear();

  // OddsPortal: current year uses the base slug, previous years append "-YEAR"
  const slugWithYear = year === currentYear ? league : `${league}-${year}`;
  return `${OP_BASE}/football/${country}/${slugWithYear}/results/`;
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
      const data2 = (q as Record<string, unknown>)["state"]?.["data"];
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
        return false;
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

// ── Fetch match list with pagination ─────────────────────────────────────────

export async function fetchMatchList(
  oddsPortalPath: string,
  year: number,
  onProgress?: (msg: string) => void
): Promise<OPMatch[]> {
  const startUrl = buildResultsUrl(oddsPortalPath, year);
  onProgress?.(`Fetching match list from OddsPortal: ${startUrl}`);

  const allMatches: OPMatch[] = [];
  const seen = new Set<string>();
  let url: string | null = startUrl;
  let page = 1;
  const MAX_PAGES = 20;

  let consecutiveBlocks = 0;

  while (url && page <= MAX_PAGES) {
    onProgress?.(`Fetching page ${page}…`);
    const result = await opFetch(url);
    if (!result.html) {
      if (result.blocked) {
        consecutiveBlocks++;
        onProgress?.(
          `⚠ OddsPortal is blocking server-side requests (Cloudflare bot protection). ` +
          `Page ${page} returned an empty response. ` +
          `OddsPortal requires a real browser session to access their data.`
        );
        if (consecutiveBlocks >= 2) {
          onProgress?.(
            `❌ OddsPortal block confirmed. ` +
            `Their site uses Cloudflare TLS-fingerprint detection — plain HTTP requests from a server ` +
            `are silently dropped. To scrape OddsPortal you need a headless browser (Playwright/Puppeteer) ` +
            `or a proxy that presents a real browser TLS fingerprint.`
          );
          break;
        }
      } else {
        onProgress?.(`⚠ Could not fetch page ${page} — stopping pagination`);
        break;
      }
      break;
    }

    consecutiveBlocks = 0;

    // Try __NEXT_DATA__ JSON first
    const nextData = extractNextData(result.html);
    let pageMatches: OPMatch[] = [];
    if (nextData) {
      pageMatches = parseNextDataMatches(nextData, url);
      onProgress?.(`  JSON: found ${pageMatches.length} matches on page ${page}`);
    }

    // Fall back to HTML parsing
    if (pageMatches.length === 0) {
      pageMatches = parseHtmlMatches(result.html, url);
      onProgress?.(`  HTML: found ${pageMatches.length} matches on page ${page}`);
    }

    if (pageMatches.length === 0) {
      onProgress?.(`  No matches found on page ${page} — stopping`);
      break;
    }

    let newCount = 0;
    for (const m of pageMatches) {
      const key = `${m.date}|${m.homeTeam}|${m.awayTeam}`;
      if (!seen.has(key)) { seen.add(key); allMatches.push(m); newCount++; }
    }
    onProgress?.(`  Added ${newCount} new matches (total: ${allMatches.length})`);

    // Check for next page
    const nextUrl = findNextPageUrl(result.html, url);
    url = nextUrl;
    page++;

    // Polite delay between pages
    if (url) await new Promise(r => setTimeout(r, 1500));
  }

  onProgress?.(`Match list complete: ${allMatches.length} matches`);
  return allMatches;
}

// ── Fetch odds for a single match ─────────────────────────────────────────────

export async function fetchMatchOdds(
  match: OPMatch,
  onProgress?: (msg: string) => void
): Promise<Partial<OPMatchOdds>> {
  const odds: Partial<OPMatchOdds> = {};

  if (!match.matchUrl) return odds;

  const matchPageUrl = match.matchUrl.startsWith("http")
    ? match.matchUrl : `${OP_BASE}${match.matchUrl}`;

  onProgress?.(`  Fetching odds page: ${matchPageUrl}`);
  const result = await opFetch(matchPageUrl);
  if (!result.html) {
    onProgress?.(result.blocked
      ? `  ⚠ Cloudflare block on match page — odds unavailable`
      : `  ⚠ Could not fetch match page`);
    return odds;
  }

  // Try to extract from __NEXT_DATA__
  const nextData = extractNextData(result.html);
  if (nextData) {
    extractOddsFromNextData(nextData, odds);
  }

  // Fall back to HTML parsing for 1X2
  if (!odds["1x2"] || odds["1x2"].length === 0) {
    extract1x2FromHtml(result.html, odds);
  }

  // Try their internal API for each market using the match hash
  if (match.matchHash) {
    await fetchMarketOddsFromApi(match.matchHash, matchPageUrl, odds, onProgress);
  }

  return odds;
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
