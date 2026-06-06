/**
 * Playwright-based browser scraper.
 * Uses Replit's pre-installed Chromium to bypass Cloudflare TLS-fingerprint detection.
 *
 * Odds-page strategy (based on OddsPortal 2025 Vue SPA DOM structure):
 *  1. Navigate to match page with persistent context (Cloudflare cookies persist across matches)
 *  2. Remove classification headers (class: "flex items-center justify-start")
 *  3. Expand all market sections (class: "flex w-full items-center") by clicking their headers
 *  4. Simulate mouseenter on each bookmaker's odds cells to reveal opening odds popups
 *  5. Return full innerText for RegEx extraction + per-cell popup content
 */
import { chromium, Browser, BrowserContext, Page } from "playwright";

export interface InterceptedResponse {
  url:  string;
  json: unknown;
}

export interface DomLink {
  href: string;
  text: string;
  date: string;
}

export interface BrowserFetchResult {
  html:        string | null;
  intercepted: InterceptedResponse[];
  blocked:     boolean;
  domLinks:    DomLink[];
}

/** Raw odds rows extracted from DOM (fallback when regex fails). */
export interface OddsRow {
  bookmaker: string;
  values:    number[];
}

/** Full odds page result including plain text for RegEx extraction. */
export interface OddsPageResult extends BrowserFetchResult {
  /** Full body.innerText after section expansion — used for RegEx odds extraction. */
  pageText: string;
  /** DOM-extracted rows (fallback). */
  oddsRows: OddsRow[];
  /** Popup text per bookmaker+position: key = "{bookmaker}|{hda}" where hda=1,2,3 */
  popupTexts: Record<string, string>;
}

const CHROMIUM_PATH = process.env.REPLIT_PLAYWRIGHT_CHROMIUM_EXECUTABLE;

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

const EXTRA_HEADERS = {
  "Accept-Language":    "en-GB,en;q=0.9",
  "sec-ch-ua":          '"Google Chrome";v="125", "Chromium";v="125", "Not.A/Brand";v="24"',
  "sec-ch-ua-mobile":   "?0",
  "sec-ch-ua-platform": '"Windows"',
};

// ── Singleton browser ─────────────────────────────────────────────────────────

let _browser: Browser | null = null;

async function getBrowser(): Promise<Browser> {
  if (_browser?.isConnected()) return _browser;
  console.log("[BrowserScraper] Launching Chromium…");
  _browser = await chromium.launch({
    executablePath: CHROMIUM_PATH,
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-accelerated-2d-canvas",
      "--disable-gpu",
      "--no-first-run",
      "--no-zygote",
      "--disable-blink-features=AutomationControlled",
    ],
  });
  _browser.on("disconnected", () => { _browser = null; });
  console.log("[BrowserScraper] Chromium launched");
  return _browser;
}

export async function closeBrowser(): Promise<void> {
  if (_browser?.isConnected()) {
    await _browser.close();
    _browser = null;
  }
}

// ── Persistent odds context ───────────────────────────────────────────────────
// Reused across all matches in a job so Cloudflare cookies persist.

let _oddsContext: BrowserContext | null = null;

async function getOddsContext(): Promise<BrowserContext> {
  const browser = await getBrowser();
  if (_oddsContext) {
    try { await _oddsContext.cookies(); } catch { _oddsContext = null; }
  }
  if (!_oddsContext) {
    console.log("[BrowserScraper] Creating persistent odds context…");
    _oddsContext = await browser.newContext({
      userAgent:  USER_AGENT,
      viewport:   { width: 1920, height: 1080 },
      locale:     "en-GB",
      timezoneId: "Europe/London",
      extraHTTPHeaders: EXTRA_HEADERS,
    });

    // Switch OddsPortal to Decimal format for this session.
    // OddsPortal IP-detects Replit as US and serves money line odds by default.
    // The format preference is stored server-side in the Laravel session cookie.
    // Approach: load oddsportal.com first (creates session), then call
    // ajax-setcookie/OddsFormat/1 via fetch() from within the page (updates session).
    // All subsequent navigations in this context share the same session cookie.
    try {
      const initPage = await _oddsContext.newPage();
      // Step 1: establish a session by loading the home page
      await initPage.goto("https://www.oddsportal.com/", {
        waitUntil: "commit", timeout: 20_000,
      }).catch(() => {});
      await new Promise(r => setTimeout(r, 2_000));
      // Step 2: update session to decimal format via the AJAX endpoint
      await initPage.evaluate(async () => {
        await fetch("/ajax-setcookie/OddsFormat/1/", { credentials: "include" }).catch(() => {});
      }).catch(() => {});
      await initPage.close();
      console.log("[BrowserScraper] Decimal odds format set in session");
    } catch (e) {
      console.warn("[BrowserScraper] Failed to set decimal format:", e);
    }
  }
  return _oddsContext;
}

export async function resetOddsContext(): Promise<void> {
  if (_oddsContext) {
    await _oddsContext.close().catch(() => {});
    _oddsContext = null;
    console.log("[BrowserScraper] Odds context reset");
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function applyStealthScript(page: Page): Promise<void> {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => false });
  });
}

async function waitForCloudflare(page: Page, maxMs = 12_000): Promise<boolean> {
  const title = await page.title().catch(() => "");
  const hasCf  = await page.$("div#challenge-running,#cf-challenge-running").catch(() => null);
  const isCf   =
    title.toLowerCase().includes("just a moment") ||
    title.toLowerCase().includes("attention required") ||
    hasCf !== null;

  if (!isCf) return false;

  console.log("[BrowserScraper] Cloudflare challenge — waiting…");
  await page.waitForFunction(
    "!document.querySelector('#challenge-running,#cf-challenge-running') && !document.title.toLowerCase().includes('just a moment')",
    { timeout: maxMs, polling: 500 }
  ).catch(() => {});

  const after = await page.title().catch(() => "");
  return after.toLowerCase().includes("just a moment");
}

// ── Match-list fetch (fresh context) ─────────────────────────────────────────

export async function browserFetch(
  url:           string,
  interceptHost: string = "oddsportal.com",
  timeoutMs:     number = 35_000
): Promise<BrowserFetchResult> {
  let browser: Browser;
  try { browser = await getBrowser(); }
  catch (e) {
    console.error("[BrowserScraper] Could not launch browser:", e);
    return { html: null, intercepted: [], blocked: false, domLinks: [] };
  }

  const intercepted: InterceptedResponse[] = [];
  let context: BrowserContext | null = null;

  try {
    context = await browser.newContext({
      userAgent:  USER_AGENT,
      viewport:   { width: 1920, height: 1080 },
      locale:     "en-GB",
      timezoneId: "Europe/London",
      extraHTTPHeaders: EXTRA_HEADERS,
    });
    context.on("response", async (resp) => {
      try {
        if (!resp.url().includes(interceptHost)) return;
        const ct = resp.headers()["content-type"] ?? "";
        if (!ct.includes("json")) return;
        const json = await resp.json().catch(() => null);
        if (json !== null) intercepted.push({ url: resp.url(), json });
      } catch {}
    });

    const page = await context.newPage();
    await applyStealthScript(page);

    await page.goto(url, { waitUntil: "commit", timeout: timeoutMs }).catch(() => {});
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});

    if (await waitForCloudflare(page)) {
      return { html: null, intercepted, blocked: true, domLinks: [] };
    }

    await page.evaluate("window.scrollBy(0, 800)").catch(() => {});
    await new Promise(r => setTimeout(r, 2_000));
    await page.evaluate("window.scrollBy(0, 1600)").catch(() => {});
    await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => {});
    await new Promise(r => setTimeout(r, 3_000));

    const html = await page.content().catch(() => null);
    if (!html || html.length < 500) {
      return { html: null, intercepted, blocked: false, domLinks: [] };
    }

    const domLinks: DomLink[] = await page.evaluate(
      (): Array<{ href: string; text: string; date: string }> => {
        const items: Array<{ href: string; text: string; date: string }> = [];
        let currentDate = "";
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        function visit(node: any): void {
          if (node.nodeType === 3) {
            const t: string = (node.textContent ?? "").trim();
            if (t.length > 0 && t.length < 25 && (
              /^\d{1,2}\s+\w{3,9}\s+\d{4}$/.test(t) ||
              /^\d{2}\.\d{2}\.\d{4}$/.test(t)
            )) currentDate = t;
            return;
          }
          if (node.nodeType !== 1) return;
          if (node.tagName === "A") {
            const href: string = node.getAttribute("href") ?? "";
            const text: string = (node.textContent ?? "").trim();
            if (href.includes("/football/") && text.length > 0) {
              const parts: string[] = href.split("/").filter(Boolean);
              if (parts.length >= 3 && !href.includes("/?") && !href.endsWith("/football/")) {
                // H2H links (e.g. /football/h2h/team1-HASH/team2-HASH/#matchHash) only
                // contain status text like "FinishedFIN" inside the <a>.  Team names
                // and scores are in sibling elements outside the link.  Walk up the
                // DOM to find the nearest ancestor whose innerText contains exactly
                // one en-dash score separator — that's the match-row container.
                let captureText = text;
                if (href.includes("/h2h/") && !text.includes("\u2013")) {
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  let el: any = node.parentElement;
                  for (let d = 0; d < 8 && el && el.tagName !== "BODY"; d++) {
                    const t2: string = (el.innerText ?? el.textContent ?? "").replace(/\s+/g, " ").trim();
                    const dashes: number = (t2.match(/\u2013/g) ?? []).length;
                    if (dashes === 1) { captureText = t2; break; }
                    if (dashes > 2) break; // container has multiple matches — stop
                    el = el.parentElement;
                  }
                }
                items.push({ href, text: captureText, date: currentDate });
                return;
              }
            }
          }
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          for (const child of Array.from<any>(node.childNodes)) visit(child);
        }
        // @ts-ignore
        visit(document.body); // eslint-disable-line no-undef
        return items;
      }
    ).catch(() => []);

    console.log(`[BrowserScraper] DOM links: ${domLinks.length} for ${url}`);
    return { html, intercepted, blocked: false, domLinks };

  } catch (e) {
    console.warn("[BrowserScraper] Navigation error:", url, e);
    return { html: null, intercepted, blocked: false, domLinks: [] };
  } finally {
    await context?.close().catch(() => {});
  }
}

export async function browserFetchHashPage(
  baseUrl:       string,
  pageNum:       number,
  interceptHost: string = "oddsportal.com",
  timeoutMs:     number = 25_000
): Promise<BrowserFetchResult> {
  const hashUrl = pageNum <= 1
    ? baseUrl
    : `${baseUrl.split("#")[0]}#/page/${pageNum}/`;
  return browserFetch(hashUrl, interceptHost, timeoutMs);
}

// ── Odds page fetch (persistent context + DOM manipulation) ──────────────────

/**
 * Fetch an OddsPortal match page and extract odds data.
 *
 * Steps:
 *  1. Navigate to the match page (persistent context = Cloudflare cookies reused)
 *  2. Remove classification headers (flex items-center justify-start)
 *  3. Expand all market sections (flex w-full items-center) — O/U, AH, BTTS, etc.
 *  4. Simulate mouseenter on each bookmaker's home/draw/away cells → opening odds popup
 *  5. Return pageText (for RegEx extraction) + popup texts per bookmaker
 */
export async function fetchOddsPage(
  url:           string,
  interceptHost: string = "oddsportal.com",
  timeoutMs:     number = 25_000
): Promise<OddsPageResult> {
  const empty: OddsPageResult = {
    html: null, intercepted: [], blocked: false, domLinks: [],
    pageText: "", oddsRows: [], popupTexts: {},
  };

  let context: BrowserContext;
  try { context = await getOddsContext(); }
  catch (e) {
    console.error("[BrowserScraper] Could not get odds context:", e);
    return empty;
  }

  const intercepted: InterceptedResponse[] = [];
  let page: Page | null = null;

  try {
    page = await context.newPage();
    await applyStealthScript(page);

    page.on("response", async (resp) => {
      try {
        if (!resp.url().includes(interceptHost)) return;
        const ct = resp.headers()["content-type"] ?? "";
        const respUrl = resp.url();
        // Capture JSON responses AND .dat files (OddsPortal match-event API)
        const isJsonCt = ct.includes("json");
        const isDat    = respUrl.includes("match-event") || respUrl.endsWith(".dat");
        if (!isJsonCt && !isDat) return;
        const body = await resp.text().catch(() => null);
        if (!body) return;
        const json = JSON.parse(body);
        intercepted.push({ url: respUrl, json });
      } catch {}
    });

    await page.goto(url, { waitUntil: "commit", timeout: timeoutMs }).catch(() => {});
    await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});

    if (await waitForCloudflare(page, 12_000)) {
      console.warn("[BrowserScraper] Odds page Cloudflare blocked:", url);
      return { ...empty, blocked: true };
    }

    // Wait for Vue to render odds
    await new Promise(r => setTimeout(r, 3_000));

    const html = await page.content().catch(() => null);
    if (!html || html.length < 500) return { ...empty, html: null };

    // ── Step 0: Switch to Decimal odds format if page shows Money Line ─────────
    // OddsPortal geo-detects the Replit IP as US and defaults to Money Line odds.
    // The context init step (ajax-setcookie) should have set decimal; this is a
    // per-page UI fallback in case it didn't persist across page navigations.
    try {
      const fmtBtn = page.locator("button").filter({ hasText: "Money Line Odds" }).first();
      if (await fmtBtn.count() > 0) {
        console.log("[BrowserScraper] Money Line format detected — switching to Decimal…");
        await fmtBtn.click({ force: true });
        await new Promise(r => setTimeout(r, 600));
        const decOpt = page.locator("li").filter({ hasText: /^Decimal Odds/ }).first();
        if (await decOpt.count() > 0) {
          await decOpt.click({ force: true });
          await new Promise(r => setTimeout(r, 2_500));
          console.log("[BrowserScraper] Switched to Decimal odds.");
        }
      }
    } catch { /* non-fatal */ }

    // ── Step 1: Capture 1X2 page text (default market shown on load) ──────────
    const text1x2 = await page.evaluate(() => document.body.innerText).catch(() => "");

    // ── Step 2: Click each market tab to load odds for other markets ──────────
    // OddsPortal match pages show ONE market at a time.  Market tabs appear as
    // clickable elements with text like "Over/Under", "Both Teams to Score", etc.
    // We find them by text content, click each, wait for Vue to re-render,
    // then capture the updated body text.
    const MARKET_TABS = [
      "Over/Under",
      "Both Teams to Score",
      "Double Chance",
      "Draw No Bet",
      "Asian Handicap",
      "European Handicap",
      "Correct Score",
      "Half Time/Full Time",
      "Odd or Even",
    ] as const;

    const tabTexts: Record<string, string> = { "1X2": text1x2 };

    for (const tabName of MARKET_TABS) {
      try {
        const clicked = await page.evaluate((txt: string): boolean => {
          // Try <a>, <button>, <li>, <div>, <span> elements with exact text match
          for (const sel of ["a", "button", "li", "div", "span"]) {
            for (const el of Array.from(document.querySelectorAll(sel))) {
              const t = (el as HTMLElement).innerText?.trim() ?? el.textContent?.trim() ?? "";
              if (t === txt || t.startsWith(txt + "\n") || t.startsWith(txt + " ")) {
                (el as HTMLElement).click();
                return true;
              }
            }
          }
          return false;
        }, tabName);

        if (clicked) {
          await new Promise(r => setTimeout(r, 2_000));
          await page.waitForLoadState("networkidle", { timeout: 6_000 }).catch(() => {});
          tabTexts[tabName] = await page.evaluate(() => document.body.innerText).catch(() => "");
        }
      } catch { /* ignore per-tab errors */ }
    }

    // Combine all tab texts: put them in order so the parser can find each section
    // Each tab text already contains the full page text for that market.
    // We'll pass them concatenated with section markers so parseOddsFromPageText
    // can find each market's section header.
    const combinedText = Object.entries(tabTexts)
      .map(([tab, txt]) => `\n${tab}\n${txt}`)
      .join("\n\n---MARKET---\n\n");

    console.log(`[BrowserScraper] Tab texts captured: ${Object.keys(tabTexts).join(", ")} (${combinedText.length} chars)`);


    // pageText = combined text from all market tabs (1X2 default + each tab clicked)
    const pageText = combinedText;
    const popupTexts: Record<string, string> = {};
    const oddsRows: OddsRow[] = [];

    console.log(`[BrowserScraper] Odds page ready: ${intercepted.length} API responses, ${pageText.length} chars text`);

    return { html, intercepted, blocked: false, domLinks: [], pageText, oddsRows, popupTexts };

  } catch (e) {
    console.warn("[BrowserScraper] Odds page error:", url, e);
    return empty;
  } finally {
    await page?.close().catch(() => {});
  }
}
