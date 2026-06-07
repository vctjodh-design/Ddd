/**
 * Odds scraper — captures Oddspedia widget API calls during the main page load.
 *
 * Strategy:
 *  1. Set up context.route() BEFORE loading performanceodds.com
 *  2. Navigate to the page — the Oddspedia widget iframe loads naturally (CF-allowed)
 *  3. Wait until we see JSON from oddspedia / known odds API hostnames
 *  4. Parse those JSON payloads for match + odds data
 *
 * The iframe at widgets.oddspedia.com loads fine inside the WP page (Cloudflare allows it
 * via Referer), but direct navigation to that URL from a new tab is challenged.
 */

import { chromium, type Browser, type BrowserContext } from "playwright";

const PO_URL  = "https://www.performanceodds.com/odds-comparison/";
const CHROMIUM_PATH = process.env.REPLIT_PLAYWRIGHT_CHROMIUM_EXECUTABLE;

// ── Browser singleton (shared, persistent CF cookies) ─────────────────────────
let _browser: Browser | null = null;
let _ctx: BrowserContext | null = null;

async function getCtx(): Promise<BrowserContext> {
  if (!_browser || !_browser.isConnected()) {
    _browser = await chromium.launch({
      executablePath: CHROMIUM_PATH,
      headless: true,
      args: [
        "--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage",
        "--disable-accelerated-2d-canvas", "--disable-gpu",
        "--no-first-run", "--no-zygote",
        "--disable-blink-features=AutomationControlled",
      ],
    });
    _browser.on("disconnected", () => { _browser = null; _ctx = null; });
    _ctx = null;
  }
  if (!_ctx) {
    _ctx = await _browser.newContext({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
      viewport: { width: 1400, height: 900 },
      locale:    "en-GB",
      extraHTTPHeaders: {
        "Accept-Language":    "en-GB,en;q=0.9",
        "sec-ch-ua":          '"Google Chrome";v="125", "Chromium";v="125", "Not.A/Brand";v="24"',
        "sec-ch-ua-mobile":   "?0",
        "sec-ch-ua-platform": '"Windows"',
      },
    });
  }
  return _ctx;
}

export async function closePOBrowser() {
  if (_ctx) { await _ctx.close().catch(() => {}); _ctx = null; }
  if (_browser) { await _browser.close().catch(() => {}); _browser = null; }
}

// ── Types ─────────────────────────────────────────────────────────────────────
export interface POOddsEntry {
  bookmaker: string; home?: number; draw?: number; away?: number;
  values: number[]; labels: string[]; line?: number;
}
export interface POMarkets {
  "1x2"?:  POOddsEntry[]; "ou"?:   POOddsEntry[]; "ah"?:   POOddsEntry[];
  "btts"?: POOddsEntry[]; "dc"?:   POOddsEntry[]; "dnb"?:  POOddsEntry[];
  "cs"?:   POOddsEntry[]; "eh"?:   POOddsEntry[]; "htft"?: POOddsEntry[];
  "oe"?:   POOddsEntry[]; "wtbh"?: POOddsEntry[];
}
export interface POMatch {
  homeTeam: string; awayTeam: string; kickoffTs?: number;
  league?: string; country?: string; markets: POMarkets; sourceUrl?: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function normName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}

export function findBestPOMatch(home: string, away: string, candidates: POMatch[]): POMatch | null {
  let best: { m: POMatch; score: number } | null = null;
  for (const m of candidates) {
    const score = (sim(home, m.homeTeam) + sim(away, m.awayTeam)) / 2;
    if (!best || score > best.score) best = { m, score };
  }
  return best && best.score >= 0.5 ? best.m : null;
}

function sim(a: string, b: string): number {
  const na = normName(a); const nb = normName(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  if (na.includes(nb) || nb.includes(na)) return 0.85;
  const wa = new Set(na.split(" ")); const wb = new Set(nb.split(" "));
  const inter = [...wa].filter(w => wb.has(w)).length;
  const union = new Set([...wa, ...wb]).size;
  return union === 0 ? 0 : inter / union;
}

// ── Market classification ─────────────────────────────────────────────────────
const MKT_MAP: [string, keyof POMarkets][] = [
  ["1x2","1x2"],["match_result","1x2"],["match result","1x2"],["full_time_result","1x2"],
  ["home_draw_away","1x2"],["over_under","ou"],["overunder","ou"],["over/under","ou"],
  ["asian_handicap","ah"],["asian handicap","ah"],["both_teams","btts"],["btts","btts"],
  ["double_chance","dc"],["double chance","dc"],["draw_no_bet","dnb"],["draw no bet","dnb"],
  ["correct_score","cs"],["correct score","cs"],["european_handicap","eh"],
  ["half_time","htft"],["ht_ft","htft"],["odd_even","oe"],
];
function mkt(text: string): keyof POMarkets | null {
  const t = text.toLowerCase();
  for (const [kw, k] of MKT_MAP) if (t.includes(kw)) return k;
  return null;
}

// ── Parse Oddspedia JSON payload ──────────────────────────────────────────────
function parsePayload(payload: unknown): POMatch[] {
  if (!payload || typeof payload !== "object") return [];
  const results: POMatch[] = [];

  function walk(node: unknown, depth = 0): void {
    if (depth > 10 || !node || typeof node !== "object") return;
    if (Array.isArray(node)) { for (const i of node) walk(i, depth + 1); return; }
    const obj = node as Record<string, unknown>;

    const ht = str(obj.home_team ?? obj.homeTeam ?? obj.home ?? obj.home_name ??
                    obj.homeName ?? obj.home_participant ?? obj.homeParticipant ??
                    obj.home_name_en ?? obj.home_team_name);
    const at = str(obj.away_team ?? obj.awayTeam ?? obj.away ?? obj.away_name ??
                    obj.awayName ?? obj.away_participant ?? obj.awayParticipant ??
                    obj.away_name_en ?? obj.away_team_name);

    if (ht && at && ht.length > 1 && at.length > 1 && ht.length < 80 && at.length < 80) {
      const m: POMatch = {
        homeTeam: ht.trim(), awayTeam: at.trim(),
        kickoffTs: asNum(obj.start_time ?? obj.startTime ?? obj.kickoff ?? obj.time ?? obj.start),
        league:  str(obj.league_name ?? obj.leagueName ?? obj.tournament ?? obj.league ??
                     obj.competition ?? obj.competition_name ?? obj.competitionName),
        country: str(obj.country_name ?? obj.countryName ?? obj.country),
        markets: {},
        sourceUrl: str(obj.url ?? obj.link ?? obj.href ?? obj.slug),
      };
      extractMarkets(obj, m);
      results.push(m);
      return;
    }
    for (const v of Object.values(obj)) walk(v, depth + 1);
  }

  walk(payload);
  return results;
}

function str(v: unknown): string {
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  return "";
}
function asNum(v: unknown): number | undefined {
  if (typeof v === "number") return v;
  if (typeof v === "string" && /^\d+$/.test(v)) return parseInt(v);
  return undefined;
}
function extractMarkets(obj: Record<string, unknown>, match: POMatch) {
  for (const [key, val] of Object.entries(obj)) {
    const mk = mkt(key); if (!mk || match.markets[mk]) continue;
    if (Array.isArray(val)) {
      const es = val.map(oddsEntry).filter(Boolean) as POOddsEntry[];
      if (es.length) match.markets[mk] = es;
    } else if (val && typeof val === "object") {
      const e = oddsEntry(val); if (e) match.markets[mk] = [e];
    }
  }
}
function oddsEntry(item: unknown): POOddsEntry | null {
  if (!item || typeof item !== "object") return null;
  const o = item as Record<string, unknown>;
  const bookmaker = str(o.bookmaker ?? o.bookmaker_name ?? o.bookmakerName ?? o.name ?? o.bookie);
  if (!bookmaker) return null;
  const nums: number[] = []; const labels: string[] = [];
  for (const [k, v] of Object.entries(o)) {
    const n = typeof v === "number" ? v : typeof v === "string" && /^\d+(\.\d+)?$/.test(v) ? parseFloat(v) : NaN;
    if (!isNaN(n) && n >= 1.0 && n <= 200) { nums.push(n); labels.push(k); }
  }
  if (nums.length === 0) return null;
  return {
    bookmaker, values: nums, labels,
    home: asNum(o.home_odd ?? o.homeOdd ?? o["1"]) ?? nums[0],
    draw: asNum(o.draw_odd ?? o.drawOdd ?? o.draw ?? o["x"] ?? o["X"]) ?? nums[1],
    away: asNum(o.away_odd ?? o.awayOdd ?? o["2"]) ?? nums[2],
  };
}

// ── Hosts whose JSON responses may contain odds/match data ────────────────────
const ODDS_HOSTS = [
  "oddspedia", "oddsportal", "sofascore", "flashscore", "betfair", "betexplorer",
  "oddscomparison", "feedsports", "sbapi", "odds-api", "betsapi", "betapi",
];

function isOddsUrl(url: string): boolean {
  const u = url.toLowerCase();
  return ODDS_HOSTS.some(h => u.includes(h));
}

// ── Main scrape entry point ───────────────────────────────────────────────────
export async function scrapePerformanceOdds(
  date: string,
  log: (msg: string) => void,
): Promise<POMatch[]> {
  const ctx = await getCtx();
  const captured: { url: string; body: unknown }[] = [];

  // ── 1. Set up route interception BEFORE navigation ────────────────────────
  const handler = async (route: Parameters<Parameters<typeof ctx.route>[1]>[0]) => {
    const req = route.request();
    try {
      const res = await route.fetch();
      const ct  = res.headers()["content-type"] ?? "";
      if (ct.includes("json") || ct.includes("javascript")) {
        const url = req.url();
        if (isOddsUrl(url)) {
          try {
            const body = await res.json();
            captured.push({ url, body });
            log(`[PO] API: ${url.slice(0, 100)}`);
          } catch { /* not JSON */ }
        }
      }
      await route.fulfill({ response: res });
    } catch {
      await route.continue().catch(() => {});
    }
  };

  await ctx.route("**/*", handler);

  const page = await ctx.newPage();
  try {
    // ── 2. Navigate to the page ─────────────────────────────────────────────
    log(`[PO] Loading ${PO_URL}…`);
    await page.goto(PO_URL, { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});

    // ── 3. Dismiss any cookie / consent modal ───────────────────────────────
    const consentSels = [
      "button[id*='accept']", "#onetrust-accept-btn-handler",
      ".fc-cta-consent", "button:has-text('Accept all')",
      "button:has-text('Accept')", "button:has-text('Got it')",
    ];
    for (const sel of consentSels) {
      try { await page.click(sel, { timeout: 800 }); break; } catch { /* noop */ }
    }

    // ── 4. Wait for Oddspedia iframe to appear ──────────────────────────────
    log("[PO] Waiting for Oddspedia widget iframe…");
    try {
      await page.waitForSelector('iframe[src*="oddspedia"]', { timeout: 20000 });
      log("[PO] Widget iframe found in DOM — waiting for its API calls…");
    } catch {
      log("[PO] Widget iframe not found via selector — continuing to wait…");
    }

    // ── 5. Scroll + wait for API calls to fire ──────────────────────────────
    // Give the widget time to configure via postMessage and fetch odds data
    for (let i = 0; i < 6; i++) {
      await page.waitForTimeout(5000);
      await page.evaluate((offset: number) => window.scrollTo(0, offset), i * 200).catch(() => {});
      if (captured.length > 0) {
        log(`[PO] Got ${captured.length} API response(s) — continuing to wait for more…`);
      }
    }

    log(`[PO] Total captured: ${captured.length} API response(s)`);

    // ── 6. Log all frames visible ───────────────────────────────────────────
    for (const frame of page.frames()) {
      const fu = frame.url();
      if (fu && fu !== "about:blank") log(`[PO] Frame: ${fu.slice(0, 120)}`);
    }

    // ── 7. Parse captured responses ─────────────────────────────────────────
    const allMatches: POMatch[] = [];
    const seen = new Set<string>();
    for (const { url, body } of captured) {
      const parsed = parsePayload(body);
      if (parsed.length > 0) log(`[PO]   ${url.slice(0, 80)} → ${parsed.length} match(es)`);
      for (const m of parsed) {
        const k = `${normName(m.homeTeam)}|${normName(m.awayTeam)}`;
        if (!seen.has(k)) { seen.add(k); allMatches.push(m); }
      }
    }

    // ── 8. Date-filter ───────────────────────────────────────────────────────
    const targetMs = new Date(`${date}T00:00:00Z`).getTime();
    const dayMs    = 24 * 60 * 60 * 1000;
    const filtered = allMatches.filter(m => {
      if (!m.kickoffTs) return true;
      const ts = m.kickoffTs * (m.kickoffTs < 1e10 ? 1000 : 1);
      return ts >= targetMs - dayMs && ts < targetMs + 2 * dayMs;
    });

    log(`[PO] Final: ${filtered.length} match(es) for ${date} (total: ${allMatches.length})`);
    return filtered;

  } catch (e) {
    log(`[PO] Error: ${e}`);
    return [];
  } finally {
    await ctx.unroute("**/*", handler).catch(() => {});
    await page.close().catch(() => {});
  }
}
