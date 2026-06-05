/**
 * Playwright-based browser scraper.
 * Uses Replit's pre-installed Chromium to bypass Cloudflare TLS-fingerprint detection.
 * Presents a real Chrome browser identity, so OddsPortal's bot protection passes.
 *
 * Strategy:
 *  1. Launch a singleton Chromium instance (kept alive across requests for speed)
 *  2. Per-request: open a fresh browser context (isolated cookies/storage)
 *  3. Intercept ALL JSON responses from the target domain
 *  4. Navigate to the URL, wait for network idle
 *  5. Return the page HTML + all intercepted API JSON responses
 */
import { chromium, Browser, BrowserContext } from "playwright";

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

/**
 * Fetch a page with a real Chromium browser.
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
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
      viewport:         { width: 1920, height: 1080 },
      locale:           "en-US",
      timezoneId:       "America/New_York",
      extraHTTPHeaders: {
        "Accept-Language":    "en-US,en;q=0.9",
        "sec-ch-ua":          '"Google Chrome";v="125", "Chromium";v="125", "Not.A/Brand";v="24"',
        "sec-ch-ua-mobile":   "?0",
        "sec-ch-ua-platform": '"Windows"',
      },
    });

    // Intercept all JSON responses from the target host
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

    // Hide automation signals
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => false });
    });

    // Use "commit" so Playwright doesn't throw on 4xx/5xx status codes.
    // Then wait for networkidle separately so intercepted responses have time to settle.
    await page.goto(url, { waitUntil: "commit", timeout: timeoutMs }).catch(() => {});
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});

    // Detect Cloudflare challenge — give it up to 10 s to solve the JS challenge
    let title = await page.title().catch(() => "");
    let isCfChallenge =
      title.toLowerCase().includes("just a moment") ||
      title.toLowerCase().includes("attention required") ||
      (await page.$("div#challenge-running").catch(() => null)) !== null;

    if (isCfChallenge) {
      console.log("[BrowserScraper] Cloudflare challenge detected — waiting up to 10 s…");
      await page.waitForFunction(
        "!document.querySelector('#challenge-running') && !document.title.toLowerCase().includes('just a moment')",
        { timeout: 10_000, polling: 500 }
      ).catch(() => {});
      title = await page.title().catch(() => "");
      isCfChallenge =
        title.toLowerCase().includes("just a moment") ||
        (await page.$("div#challenge-running").catch(() => null)) !== null;
    }

    if (isCfChallenge) {
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

    // ── DOM link extraction ────────────────────────────────────────────────────
    // OddsPortal is fully client-side rendered with encrypted API responses.
    // Match data only exists in the rendered DOM, not in interceptable JSON.
    // Walk the DOM in document order, tracking date headers and match links.
    // NOTE: this function runs inside the browser via page.evaluate(); use plain
    //       JS (no TypeScript DOM types) to avoid compilation errors.
    const domLinks: DomLink[] = await page.evaluate(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
                return; // don't recurse into the link's children
              }
            }
          }

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          for (const child of Array.from<any>(node.childNodes)) {
            visit(child);
          }
        }

        // `document` is available in the browser context where evaluate() runs
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
