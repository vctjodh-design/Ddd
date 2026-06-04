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

export interface BrowserFetchResult {
  html:        string | null;
  intercepted: InterceptedResponse[];
  blocked:     boolean;
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
    return { html: null, intercepted: [], blocked: false };
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

    const response = await page.goto(url, {
      waitUntil: "networkidle",
      timeout:   timeoutMs,
    });

    // Detect Cloudflare challenge (shouldn't happen with real browser but guard anyway)
    const title = await page.title().catch(() => "");
    const isBlocked =
      title.toLowerCase().includes("just a moment") ||
      title.toLowerCase().includes("attention required") ||
      (await page.$("div#challenge-running").catch(() => null)) !== null;

    if (isBlocked) {
      console.warn("[BrowserScraper] Cloudflare challenge even with browser at:", url);
      return { html: null, intercepted, blocked: true };
    }

    const html = await page.content();
    return { html, intercepted, blocked: false };

  } catch (e) {
    console.warn("[BrowserScraper] Navigation error for", url, ":", e);
    return { html: null, intercepted, blocked: false };
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
