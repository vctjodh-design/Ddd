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
  "Accept-Language":    "en-US,en;q=0.9",
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
      locale:     "en-US",
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
      locale:     "en-US",
      timezoneId: "America/New_York",
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
                items.push({ href, text, date: currentDate });
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
        if (!ct.includes("json")) return;
        const json = await resp.json().catch(() => null);
        if (json !== null) intercepted.push({ url: resp.url(), json });
      } catch {}
    });

    await page.goto(url, { waitUntil: "commit", timeout: timeoutMs }).catch(() => {});
    await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});

    if (await waitForCloudflare(page, 12_000)) {
      console.warn("[BrowserScraper] Odds page Cloudflare blocked:", url);
      return { ...empty, blocked: true };
    }

    // Wait for the odds table to appear
    await new Promise(r => setTimeout(r, 2_000));

    const html = await page.content().catch(() => null);
    if (!html || html.length < 500) return { ...empty, html: null };

    // ── Step 1: Remove classification headers ─────────────────────────────────
    // These are date/round separators between match rows on the results listing.
    // Removing them gives a cleaner innerText for odds RegEx extraction.
    await page.evaluate(() => {
      const hdrs = Array.from(document.getElementsByClassName("flex items-center justify-start"));
      for (let i = hdrs.length - 1; i >= 0; i--) {
        const next = hdrs[i].nextSibling;
        if (next && next.parentElement) next.parentElement.removeChild(next);
        if (hdrs[i].parentElement) hdrs[i].parentElement.removeChild(hdrs[i]);
      }
    }).catch(() => {});

    // ── Step 2: Expand all market sections ────────────────────────────────────
    // OddsPortal shows only the 1X2 market by default.
    // Click every "flex w-full items-center" header to expand O/U, AH, BTTS, DC, etc.
    const expandedSections = await page.evaluate((): string[] => {
      const expanded: string[] = [];
      const sections = Array.from(document.getElementsByClassName("flex w-full items-center"));
      for (const sec of sections) {
        const el = sec as HTMLElement;
        const txt = el.innerText?.trim() ?? "";
        if (txt.length > 0 && txt.length < 80) {
          el.click();
          expanded.push(txt.slice(0, 40));
        }
      }
      return expanded;
    }).catch(() => [] as string[]);

    if (expandedSections.length > 0) {
      console.log(`[BrowserScraper] Expanded sections: ${expandedSections.join(", ")}`);
      // Wait for the expanded content to render
      await new Promise(r => setTimeout(r, 2_000));
      await page.waitForLoadState("networkidle", { timeout: 6_000 }).catch(() => {});
    }

    // ── Step 3: Capture opening odds via mouseenter ───────────────────────────
    // Bookmaker rows are "flex" elements where innerText starts with the bookmaker
    // name and ends with "%" or "-".
    // Children: [0]=name cell, [1]=home odds, [2]=draw odds, [3]=away odds.
    // Hovering over children[hda].children[0] opens a tooltip with opening odds.
    //
    // We iterate all bookmaker rows and all 3 positions (hda 1,2,3) to capture
    // opening odds for every bookmaker automatically.
    const popupTexts: Record<string, string> = {};

    const bookmakerRows = await page.evaluate((): string[] => {
      const names: string[] = [];
      const rows = Array.from(document.getElementsByClassName("flex"));
      for (const el of rows) {
        const h = el as HTMLElement;
        const txt = h.innerText?.trim() ?? "";
        if (txt && (txt.endsWith("%") || txt.endsWith("-")) && h.children.length >= 4) {
          // First word-like segment = bookmaker name
          const firstLine = txt.split("\n")[0].trim();
          if (firstLine.length > 0 && firstLine.length < 50 && !names.includes(firstLine)) {
            names.push(firstLine);
          }
        }
      }
      return names;
    }).catch(() => [] as string[]);

    for (const bookmaker of bookmakerRows.slice(0, 30)) { // cap at 30 bookmakers for speed
      for (const hda of [1, 2, 3]) {
        try {
          // Trigger mouseenter to open popup
          await page.evaluate(({ bm, hda }: { bm: string; hda: number }) => {
            const rows = Array.from(document.getElementsByClassName("flex"));
            for (let i = rows.length - 1; i >= 0; i--) {
              const el = rows[i] as HTMLElement;
              const txt = el.innerText?.trim() ?? "";
              if (txt.startsWith(bm) && (txt.endsWith("%") || txt.endsWith("-")) && el.children.length > hda) {
                const cell = el.children[hda]?.children[0];
                if (cell) cell.dispatchEvent(new Event("mouseenter", { bubbles: true }));
              }
            }
          }, { bm: bookmaker, hda });

          await new Promise(r => setTimeout(r, 350));

          // Read popup text
          const popup = await page.$("[class*='tooltip'], [class*='Tooltip'], [class*='popup'], [class*='Popup'], [class*='overlay']");
          if (popup) {
            const txt = await popup.innerText().catch(() => "");
            if (txt && txt.includes("Opening odds")) {
              popupTexts[`${bookmaker}|${hda}`] = txt;
            }
          }

          // Close popup (mouseleave)
          await page.evaluate(({ bm, hda }: { bm: string; hda: number }) => {
            const rows = Array.from(document.getElementsByClassName("flex"));
            for (let i = rows.length - 1; i >= 0; i--) {
              const el = rows[i] as HTMLElement;
              const txt = el.innerText?.trim() ?? "";
              if (txt.startsWith(bm) && (txt.endsWith("%") || txt.endsWith("-")) && el.children.length > hda) {
                const cell = el.children[hda]?.children[0];
                if (cell) cell.dispatchEvent(new Event("mouseleave", { bubbles: true }));
              }
            }
          }, { bm: bookmaker, hda });

          await new Promise(r => setTimeout(r, 100));
        } catch { /* ignore per-cell errors */ }
      }
    }

    // ── Step 4: Get full page text for RegEx extraction ───────────────────────
    const pageText = await page.evaluate(() => document.body.innerText).catch(() => "");

    // ── Step 5: DOM-walk fallback odds extraction ─────────────────────────────
    const oddsRows: OddsRow[] = await page.evaluate((): OddsRow[] => {
      const rows: OddsRow[] = [];
      function isOdds(t: string): boolean {
        const n = parseFloat(t.trim());
        return !isNaN(n) && n >= 1.01 && n <= 999 && /^\d+(\.\d{1,3})?$/.test(t.trim());
      }
      const allEls = Array.from(document.querySelectorAll("div,tr,li"));
      const seen = new WeakSet<Element>();
      for (const el of allEls) {
        if (seen.has(el)) continue;
        const kids = Array.from(el.children);
        const oddsKids = kids.filter(c => isOdds(c.textContent ?? ""));
        if (oddsKids.length >= 2 && oddsKids.length <= 15 && kids.length >= 3) {
          seen.add(el);
          const values = oddsKids.map(c => parseFloat(c.textContent?.trim() ?? "0"));
          const nameEl =
            el.querySelector("[class*='ookmaker' i] a, [class*='ookmaker' i]") ??
            el.querySelector("p,span,a");
          const bookmaker = (nameEl?.textContent ?? el.children[0]?.textContent ?? "").trim().slice(0, 60);
          if (bookmaker && values.every(v => v > 1)) rows.push({ bookmaker, values });
        }
      }
      return rows;
    }).catch(() => []);

    const pmCount = Object.keys(popupTexts).length;
    console.log(`[BrowserScraper] Odds: ${bookmakerRows.length} bookmakers, ${pmCount} popups, ${pageText.length} chars text`);

    return { html, intercepted, blocked: false, domLinks: [], pageText, oddsRows, popupTexts };

  } catch (e) {
    console.warn("[BrowserScraper] Odds page error:", url, e);
    return empty;
  } finally {
    await page?.close().catch(() => {});
  }
}
