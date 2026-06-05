/**
 * Playwright-based browser scraper.
 * Uses Replit's pre-installed Chromium to bypass Cloudflare TLS-fingerprint detection.
 * Presents a real Chrome browser identity, so OddsPortal's bot protection passes.
 *
 * Strategy:
 *  1. Launch a singleton Chromium instance (kept alive across requests for speed)
 *  2. Match-list pages: open a fresh browser context (isolated cookies/storage)
 *  3. Odds pages: reuse a persistent context so Cloudflare cookies carry over —
 *     after the first clearance the remaining matches need no re-challenge (~3-5 s each)
 */
import { chromium, Browser, BrowserContext, Page } from "playwright";

export interface InterceptedResponse {
  url:  string;
  json: unknown;
}

/** A hyperlink extracted from the rendered DOM in document order. */
export interface DomLink {
  href: string;
  text: string;
  /** Date string captured from the nearest preceding date-header in the DOM (may be empty). */
  date: string;
}

export interface BrowserFetchResult {
  html:        string | null;
  intercepted: InterceptedResponse[];
  blocked:     boolean;
  /** Anchor tags extracted from the rendered DOM in document order (after JS hydration). */
  domLinks:    DomLink[];
}

const CHROMIUM_PATH = process.env.REPLIT_PLAYWRIGHT_CHROMIUM_EXECUTABLE;

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

const EXTRA_HEADERS = {
  "Accept-Language":    "en-US,en;q=0.9",
  "sec-ch-ua":          '"Google Chrome";v="125", "Chromium";v="125", "Not.A/Brand";v="24"',
  "sec-ch-ua-mobile":   "?0",
  "sec-ch-ua-platform": '"Windows"',
};

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
// Reused across all match pages in a job so Cloudflare cookies persist.
// This turns 30-40 s/match (re-challenge) into ~3-5 s/match.

let _oddsContext: BrowserContext | null = null;

async function getOddsContext(): Promise<BrowserContext> {
  const browser = await getBrowser();
  if (_oddsContext) {
    try {
      // Health-check: if the browser disconnected the context is invalid
      await _oddsContext.cookies();
    } catch {
      _oddsContext = null;
    }
  }
  if (!_oddsContext) {
    console.log("[BrowserScraper] Creating persistent odds context…");
    _oddsContext = await browser.newContext({
      userAgent: USER_AGENT,
      viewport:  { width: 1920, height: 1080 },
      locale:    "en-US",
      timezoneId: "America/New_York",
      extraHTTPHeaders: EXTRA_HEADERS,
    });
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

// ── Anti-automation init script ───────────────────────────────────────────────

async function applyStealthScript(page: Page): Promise<void> {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => false });
  });
}

// ── Cloudflare challenge handler ──────────────────────────────────────────────

async function waitForCloudflare(page: Page, maxMs = 12_000): Promise<boolean> {
  const title = await page.title().catch(() => "");
  const hasCfEl = await page.$("div#challenge-running, #cf-challenge-running").catch(() => null);
  const isCf =
    title.toLowerCase().includes("just a moment") ||
    title.toLowerCase().includes("attention required") ||
    hasCfEl !== null;

  if (!isCf) return false;

  console.log("[BrowserScraper] Cloudflare challenge — waiting…");
  await page.waitForFunction(
    "!document.querySelector('#challenge-running,#cf-challenge-running') && !document.title.toLowerCase().includes('just a moment')",
    { timeout: maxMs, polling: 500 }
  ).catch(() => {});

  const titleAfter = await page.title().catch(() => "");
  return titleAfter.toLowerCase().includes("just a moment");
}

// ── Match-list fetch (fresh context per call) ─────────────────────────────────

/**
 * Fetch a page with a real Chromium browser.
 * Opens a fresh isolated context (new cookies) — used for results/listing pages.
 * @param url           Full URL to navigate to
 * @param interceptHost Hostname whose JSON responses to intercept (e.g. "oddsportal.com")
 * @param timeoutMs     Navigation timeout in ms (default 35 s)
 */
export async function browserFetch(
  url:           string,
  interceptHost: string = "oddsportal.com",
  timeoutMs:     number = 35_000
): Promise<BrowserFetchResult> {
  let browser: Browser;
  try {
    browser = await getBrowser();
  } catch (e) {
    console.error("[BrowserScraper] Could not launch browser:", e);
    return { html: null, intercepted: [], blocked: false, domLinks: [] };
  }

  const intercepted: InterceptedResponse[] = [];
  let context: BrowserContext | null = null;

  try {
    context = await browser.newContext({
      userAgent: USER_AGENT,
      viewport:  { width: 1920, height: 1080 },
      locale:    "en-US",
      timezoneId: "America/New_York",
      extraHTTPHeaders: EXTRA_HEADERS,
    });

    context.on("response", async (response) => {
      try {
        if (!response.url().includes(interceptHost)) return;
        const ct = response.headers()["content-type"] ?? "";
        if (!ct.includes("json")) return;
        const json = await response.json().catch(() => null);
        if (json !== null) intercepted.push({ url: response.url(), json });
      } catch {}
    });

    const page = await context.newPage();
    await applyStealthScript(page);

    await page.goto(url, { waitUntil: "commit", timeout: timeoutMs }).catch(() => {});
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});

    const stillBlocked = await waitForCloudflare(page);
    if (stillBlocked) {
      console.warn("[BrowserScraper] Still blocked by Cloudflare at:", url);
      return { html: null, intercepted, blocked: true, domLinks: [] };
    }

    // Scroll to trigger lazy-loaded content (OddsPortal renders match rows via React)
    await page.evaluate("window.scrollBy(0, 800)").catch(() => {});
    await new Promise(r => setTimeout(r, 2_000));
    await page.evaluate("window.scrollBy(0, 1600)").catch(() => {});
    await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => {});
    await new Promise(r => setTimeout(r, 3_000));

    const html = await page.content().catch(() => null);
    if (!html || html.length < 500) {
      console.warn("[BrowserScraper] Page content empty or too short for:", url);
      return { html: null, intercepted, blocked: false, domLinks: [] };
    }

    const domLinks: DomLink[] = await page.evaluate(
      (): Array<{ href: string; text: string; date: string }> => {
        const items: Array<{ href: string; text: string; date: string }> = [];
        let currentDate = "";

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        function visit(node: any): void {
          if (node.nodeType === 3 /* TEXT_NODE */) {
            const text: string = (node.textContent ?? "").trim();
            if (text.length > 0 && text.length < 25 && (
              /^\d{1,2}\s+\w{3,9}\s+\d{4}$/.test(text) ||
              /^\d{2}\.\d{2}\.\d{4}$/.test(text)
            )) {
              currentDate = text;
            }
            return;
          }
          if (node.nodeType !== 1 /* ELEMENT_NODE */) return;

          if (node.tagName === "A") {
            const href: string = node.getAttribute("href") ?? "";
            const text: string = (node.textContent ?? "").trim();
            if (href.includes("/football/") && text.length > 0) {
              const pathParts: string[] = href.split("/").filter(Boolean);
              if (pathParts.length >= 3 && !href.includes("/?") && !href.endsWith("/football/")) {
                items.push({ href, text, date: currentDate });
                return;
              }
            }
          }

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          for (const child of Array.from<any>(node.childNodes)) {
            visit(child);
          }
        }

        // @ts-ignore
        visit(document.body); // eslint-disable-line no-undef
        return items;
      }
    ).catch(() => []);

    console.log(`[BrowserScraper] DOM links extracted: ${domLinks.length} for ${url}`);
    return { html, intercepted, blocked: false, domLinks };

  } catch (e) {
    console.warn("[BrowserScraper] Navigation error for", url, ":", e);
    return { html: null, intercepted, blocked: false, domLinks: [] };
  } finally {
    await context?.close().catch(() => {});
  }
}

/**
 * Navigate to a hash-paginated URL (e.g. /results/#/page/2/) and wait for
 * client-side navigation to settle, then return the updated page content.
 */
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

// ── Odds page fetch (persistent context — fast after first clearance) ──────────

/**
 * Fetch an OddsPortal match page using the persistent odds context.
 * After the first Cloudflare clearance, subsequent calls are ~3-5 s each.
 *
 * Also extracts DOM-rendered odds (OddsPortal 2025 encrypts API responses;
 * odds data only exists in the fully-rendered DOM).
 */
export async function fetchOddsPage(
  url:           string,
  interceptHost: string = "oddsportal.com",
  timeoutMs:     number = 25_000
): Promise<BrowserFetchResult & { oddsRows: OddsRow[] }> {
  let context: BrowserContext;
  try {
    context = await getOddsContext();
  } catch (e) {
    console.error("[BrowserScraper] Could not get odds context:", e);
    return { html: null, intercepted: [], blocked: false, domLinks: [], oddsRows: [] };
  }

  const intercepted: InterceptedResponse[] = [];
  let page: Page | null = null;

  const responseHandler = async (response: { url: () => string; headers: () => Record<string,string>; json: () => Promise<unknown> }) => {
    try {
      if (!response.url().includes(interceptHost)) return;
      const ct = response.headers()["content-type"] ?? "";
      if (!ct.includes("json")) return;
      const json = await response.json().catch(() => null);
      if (json !== null) intercepted.push({ url: response.url(), json });
    } catch {}
  };

  try {
    page = await context.newPage();
    await applyStealthScript(page);
    page.on("response", responseHandler);

    await page.goto(url, { waitUntil: "commit", timeout: timeoutMs }).catch(() => {});
    await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});

    const stillBlocked = await waitForCloudflare(page, 12_000);
    if (stillBlocked) {
      console.warn("[BrowserScraper] Odds page still blocked by Cloudflare at:", url);
      return { html: null, intercepted, blocked: true, domLinks: [], oddsRows: [] };
    }

    // Short wait for Vue/React to render the odds table
    await new Promise(r => setTimeout(r, 2_500));
    await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => {});

    const html = await page.content().catch(() => null);
    if (!html || html.length < 500) {
      return { html: null, intercepted, blocked: false, domLinks: [], oddsRows: [] };
    }

    // ── DOM odds extraction ─────────────────────────────────────────────────
    // OddsPortal 2025 Vue SPA encrypts API responses; odds only exist in DOM.
    // Walk the rendered DOM looking for bookmaker rows containing decimal odds.
    const oddsRows: OddsRow[] = await page.evaluate((): OddsRow[] => {
      const rows: OddsRow[] = [];

      function isOddsValue(text: string): boolean {
        const t = text.trim();
        const n = parseFloat(t);
        return !isNaN(n) && n >= 1.01 && n <= 999 && /^\d+(\.\d{1,3})?$/.test(t);
      }

      function getBookmakerName(el: Element): string {
        // Try common OddsPortal class patterns
        const nameEl =
          el.querySelector('[class*="ookmaker" i] a, [class*="ookmaker" i]') ??
          el.querySelector('p, span, a');
        return (nameEl?.textContent ?? el.children[0]?.textContent ?? "").trim().slice(0, 60);
      }

      // Strategy A: find elements (div/tr/li) whose direct children include 2+ odds values
      const candidates = Array.from(document.querySelectorAll("div, tr, li, section"));
      const seen = new WeakSet<Element>();

      for (const el of candidates) {
        if (seen.has(el)) continue;
        const children = Array.from(el.children);
        const oddsEls = children.filter(c => isOddsValue(c.textContent ?? ""));
        if (oddsEls.length >= 2 && oddsEls.length <= 15 && children.length >= 3) {
          seen.add(el);
          const values = oddsEls.map(c => parseFloat(c.textContent?.trim() ?? "0"));
          const bookmaker = getBookmakerName(el);
          if (bookmaker && bookmaker.length > 0 && values.every(v => v > 1)) {
            rows.push({ bookmaker, values });
          }
        }
      }

      // Strategy B: if no rows found, scan page for all decimal numbers and group by Y position
      if (rows.length === 0) {
        const walker = document.createTreeWalker(document.body, 4 /* NodeFilter.SHOW_TEXT */);
        const byLine: Map<number, { text: string; top: number; el: Element }[]> = new Map();

        let node;
        while ((node = walker.nextNode())) {
          const text = (node.textContent ?? "").trim();
          if (!isOddsValue(text)) continue;
          const el = node.parentElement;
          if (!el) continue;
          const rect = el.getBoundingClientRect();
          const lineKey = Math.round(rect.top / 5) * 5;
          if (!byLine.has(lineKey)) byLine.set(lineKey, []);
          byLine.get(lineKey)!.push({ text, top: rect.top, el });
        }

        for (const [, items] of byLine) {
          if (items.length < 2) continue;
          const values = items.map(i => parseFloat(i.text));
          const ancestor = items[0].el.closest("div, tr, li") ?? items[0].el;
          const bookmaker = getBookmakerName(ancestor);
          rows.push({ bookmaker: bookmaker || "Unknown", values });
        }
      }

      return rows;
    }).catch(() => []);

    console.log(`[BrowserScraper] Odds page: ${intercepted.length} API responses, ${oddsRows.length} DOM rows for ${url}`);
    return { html, intercepted, blocked: false, domLinks: [], oddsRows };

  } catch (e) {
    console.warn("[BrowserScraper] Odds page navigation error:", url, e);
    return { html: null, intercepted, blocked: false, domLinks: [], oddsRows: [] };
  } finally {
    await page?.close().catch(() => {});
  }
}

export interface OddsRow {
  bookmaker: string;
  values: number[];
}
