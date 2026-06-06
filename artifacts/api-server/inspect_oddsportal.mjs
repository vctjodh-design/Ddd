/**
 * Inspector: test the full fixed flow.
 * 1. Load oddsportal.com home page → establish session
 * 2. Call ajax-setcookie/OddsFormat/1 via fetch (update session to decimal)
 * 3. Navigate to canonical match URL
 * 4. Verify decimal odds appear in body text
 * 5. Show bookmaker section
 * 6. Test market tab clicking
 */
import { chromium } from "playwright";

const CHROMIUM = process.env.REPLIT_PLAYWRIGHT_CHROMIUM_EXECUTABLE;
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";
const CANONICAL = "https://www.oddsportal.com/football/algeria/ligue-1/kabylie-aso-chlef-Ekq9W28q/";

async function main() {
  const browser = await chromium.launch({
    executablePath: CHROMIUM,
    headless: true,
    args: ["--no-sandbox","--disable-setuid-sandbox","--disable-blink-features=AutomationControlled"],
  });

  const context = await browser.newContext({
    userAgent:  UA,
    viewport:   { width: 1920, height: 1080 },
    locale:     "en-GB",
    timezoneId: "Europe/London",
    extraHTTPHeaders: { "Accept-Language": "en-GB,en;q=0.9" },
  });

  // ── Step 1: Establish session on home page, then set decimal format ───────────
  console.log("Step 1: Loading home page to establish session…");
  const initPage = await context.newPage();
  await initPage.goto("https://www.oddsportal.com/", { waitUntil: "commit", timeout: 20000 }).catch(e => console.log("home:", e.message.slice(0,60)));
  await new Promise(r => setTimeout(r, 2000));
  console.log("Home page loaded. Calling ajax-setcookie via fetch…");
  const setCookieResult = await initPage.evaluate(async () => {
    try {
      const r = await fetch("/ajax-setcookie/OddsFormat/1/", { credentials: "include" });
      return { status: r.status, ok: r.ok };
    } catch(e) { return { error: String(e) }; }
  }).catch(e => ({ error: String(e) }));
  console.log("ajax-setcookie result:", setCookieResult);
  await initPage.close();
  console.log("Session decimal format set. Context now has updated session cookie.\n");

  // ── Step 2: Navigate to match page ──────────────────────────────────────────
  console.log("Step 2: Loading canonical match URL…");
  const page = await context.newPage();
  const datCalls = [];
  page.on("response", async (resp) => {
    const u = resp.url();
    if (u.includes("match-event")) datCalls.push(u.slice(0, 150));
  });

  await page.goto(CANONICAL, { waitUntil: "commit", timeout: 30000 }).catch(e => console.log("goto:", e.message.slice(0,60)));
  await page.waitForLoadState("networkidle", { timeout: 12000 }).catch(() => {});
  await new Promise(r => setTimeout(r, 3000));
  console.log("URL after nav:", page.url());

  // ── Step 3: Check if decimal format is active ────────────────────────────────
  const firstLines = await page.evaluate(() => document.body.innerText.split("\n").slice(0,5).join(" | ")).catch(()=>"");
  console.log("First 5 lines:", firstLines);

  const isMoneyLine = firstLines.includes("Money Line");
  console.log("Still money line?", isMoneyLine);

  // ── Step 4: If money line, switch via UI ─────────────────────────────────────
  if (isMoneyLine) {
    console.log("\nFalling back to UI click for decimal switch…");
    const btn = page.locator("button").filter({ hasText: "Money Line Odds" }).first();
    const btnCount = await btn.count().catch(()=>0);
    console.log("Format button found:", btnCount);
    if (btnCount > 0) {
      await btn.click({ force: true });
      await new Promise(r => setTimeout(r, 600));
      const decOpt = page.locator("li").filter({ hasText: /^Decimal Odds/ }).first();
      const decCount = await decOpt.count().catch(()=>0);
      console.log("Decimal Odds option found:", decCount);
      if (decCount > 0) {
        await decOpt.click({ force: true });
        await new Promise(r => setTimeout(r, 2500));
        console.log("Switched to Decimal via UI.");
      }
    }
  }

  // ── Step 5: Capture body text, find bookmaker section ────────────────────────
  const bodyText = await page.evaluate(() => document.body.innerText).catch(() => "");
  const bmIdx = bodyText.indexOf("Bookmakers");
  const section = bmIdx >= 0 ? bodyText.slice(bmIdx, bmIdx + 1500) : "(Bookmakers not found)";

  console.log("\nFirst 5 lines after format switch:");
  console.log(bodyText.split("\n").slice(0,5).join("\n"));
  console.log("\nBookmakers section:");
  console.log(section.slice(0, 1000));

  // ── Step 6: Click Over/Under tab ─────────────────────────────────────────────
  console.log("\nStep 6: Clicking Over/Under tab…");
  const clicked = await page.evaluate(() => {
    for (const sel of ["a","li","div","span"]) {
      for (const el of Array.from(document.querySelectorAll(sel))) {
        const t = (el.innerText ?? el.textContent ?? "").trim();
        if (t === "Over/Under" || t.startsWith("Over/Under\n")) { el.click(); return true; }
      }
    }
    return false;
  });
  if (clicked) {
    await new Promise(r => setTimeout(r, 3000));
    await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
    const ouText = await page.evaluate(() => document.body.innerText).catch(() => "");
    const ouBmIdx = ouText.indexOf("Over/Under +");
    console.log("O/U section found:", ouBmIdx >= 0 ? "YES" : "NO");
    if (ouBmIdx >= 0) console.log(ouText.slice(ouBmIdx, ouBmIdx + 600));
  }

  console.log("\nmatch-event calls:", datCalls);
  await browser.close();
  console.log("Done.");
}

main().catch(e => { console.error(e); process.exit(1); });
