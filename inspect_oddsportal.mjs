/**
 * Playwright inspector — visits OddsPortal and logs exactly how odds data is structured.
 * Run:  node inspect_oddsportal.mjs
 */
import { chromium } from "playwright";

const CHROMIUM = process.env.REPLIT_PLAYWRIGHT_CHROMIUM_EXECUTABLE;
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

const TARGET_RESULTS = "https://www.oddsportal.com/football/algeria/ligue-1/2025-2026/results/";

(async () => {
  const browser = await chromium.launch({
    executablePath: CHROMIUM,
    headless: true,
    args: ["--no-sandbox","--disable-setuid-sandbox","--disable-dev-shm-usage","--disable-gpu"],
  });

  const intercepted = [];
  const ctx = await browser.newContext({
    userAgent: UA,
    viewport: { width: 1920, height: 1080 },
    locale: "en-US",
    timezoneId: "America/New_York",
  });

  ctx.on("response", async (resp) => {
    const url = resp.url();
    if (!url.includes("oddsportal")) return;
    const ct = resp.headers()["content-type"] ?? "";
    const status = resp.status();
    if (ct.includes("json") || url.includes("/api/") || url.includes("feed")) {
      let body = "";
      try { body = (await resp.text()).slice(0, 300); } catch {}
      intercepted.push({ url: url.slice(0, 130), status, body: body.slice(0, 200) });
    }
  });

  const page = await ctx.newPage();
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => false });
  });

  // ── STEP 1: results page → grab a match link ──────────────────────────────
  console.log("\n=== STEP 1: Results page ===");
  await page.goto(TARGET_RESULTS, { waitUntil: "networkidle", timeout: 35000 }).catch(e => console.log("goto err:", e.message));
  await new Promise(r => setTimeout(r, 4000));

  const title1 = await page.title();
  console.log("Title:", title1);
  if (title1.toLowerCase().includes("just a moment")) {
    console.log("❌ Cloudflare — cannot proceed"); await browser.close(); process.exit(0);
  }

  // Intercepted API calls on results page
  console.log(`\nIntercepted on results page (${intercepted.length}):`);
  for (const r of intercepted.slice(0, 15)) {
    console.log(`  [${r.status}] ${r.url}`);
    if (r.body) console.log(`         ${r.body.replace(/\n/g," ").slice(0,120)}`);
  }
  intercepted.length = 0;

  // Find match links
  const matchLinks = await page.evaluate(() => {
    return Array.from(document.querySelectorAll("a[href]"))
      .map(a => a.getAttribute("href") || "")
      .filter(h => /\/football\/.+\/.+-[\w]{6,}\/\s*$/.test(h) && !h.includes("/h2h/"))
      .slice(0, 5);
  });
  console.log("\nMatch links found:", matchLinks);

  if (matchLinks.length === 0) {
    const bodySnippet = await page.evaluate(() => document.body.innerText.slice(0, 2000));
    console.log("\nBody snippet:\n", bodySnippet);
    await browser.close(); return;
  }

  // ── STEP 2: Match page ────────────────────────────────────────────────────
  const matchUrl = "https://www.oddsportal.com" + matchLinks[0];
  console.log(`\n=== STEP 2: Match page: ${matchUrl} ===`);
  intercepted.length = 0;

  await page.goto(matchUrl, { waitUntil: "networkidle", timeout: 35000 }).catch(e => console.log("match err:", e.message));
  await new Promise(r => setTimeout(r, 4000));
  console.log("Match page title:", await page.title());

  // API calls made by the match page
  console.log(`\nIntercepted on match page (${intercepted.length}):`);
  for (const r of intercepted) {
    console.log(`  [${r.status}] ${r.url}`);
    if (r.body) console.log(`         ${r.body.replace(/\n/g," ").slice(0,150)}`);
  }

  // Raw innerText BEFORE any manipulation
  const textBefore = await page.evaluate(() => document.body.innerText);
  console.log(`\n=== body.innerText BEFORE (${textBefore.length} chars) — first 3000: ===`);
  console.log(textBefore.slice(0, 3000));

  // ── STEP 3: inspect element classes around odds values ────────────────────
  console.log("\n=== STEP 3: Elements with single odds values (e.g. 2.10) ===");
  const oddsEls = await page.evaluate(() => {
    const results = [];
    for (const el of document.querySelectorAll("*")) {
      const txt = (el.textContent || "").trim();
      if (/^\d\.\d{2}$/.test(txt) && el.children.length === 0) {
        const p  = el.parentElement;
        const gp = p && p.parentElement;
        results.push({
          tag: el.tagName,
          cls: (el.className || "").toString().slice(0, 100),
          parentTag: p ? p.tagName : "",
          parentCls: (p && p.className || "").toString().slice(0, 100),
          gpTag: gp ? gp.tagName : "",
          gpCls: (gp && gp.className || "").toString().slice(0, 100),
          val: txt,
        });
        if (results.length >= 15) break;
      }
    }
    return results;
  });
  for (const e of oddsEls) {
    console.log(`  ${e.tag}.${e.cls} = ${e.val}`);
    console.log(`    parent:  ${e.parentTag}.${e.parentCls}`);
    console.log(`    grandpa: ${e.gpTag}.${e.gpCls}`);
  }

  // ── STEP 4: Market section expanders ─────────────────────────────────────
  console.log("\n=== STEP 4: Market section expander candidates ===");
  const expanderCandidates = await page.evaluate(() => {
    const results = [];
    // Try exact class match
    const exact = Array.from(document.getElementsByClassName("flex w-full items-center"));
    if (exact.length) {
      results.push({ selector: "flex w-full items-center", count: exact.length,
        samples: exact.slice(0,5).map(el => ({
          text: (el.innerText || "").slice(0,60),
          fullCls: (el.className || "").toString().slice(0,100),
          childCount: el.children.length,
        }))
      });
    }
    // Any div/button with role=button or data-toggle
    const btns = Array.from(document.querySelectorAll("[data-toggle],[aria-expanded],[role=button]"));
    if (btns.length) {
      results.push({ selector: "aria-expanded/data-toggle", count: btns.length,
        samples: btns.slice(0,5).map(el => ({
          text: (el.innerText || "").slice(0,60),
          fullCls: (el.className || "").toString().slice(0,80),
          childCount: el.children.length,
        }))
      });
    }
    return results;
  });
  for (const g of expanderCandidates) {
    console.log(`\n  ${g.selector} (${g.count} total):`);
    for (const s of g.samples) {
      console.log(`    text: "${s.text}" | cls: "${s.fullCls}"`);
    }
  }

  // ── STEP 5: Click Over/Under section and capture API calls + new text ─────
  console.log("\n=== STEP 5: Click first expander and watch what changes ===");
  intercepted.length = 0;
  const clicked = await page.evaluate(() => {
    const els = Array.from(document.getElementsByClassName("flex w-full items-center"));
    for (const el of els) {
      const txt = (el.innerText || "").trim();
      if (txt.length > 0 && txt.length < 80) {
        el.click();
        return txt.slice(0, 60);
      }
    }
    return null;
  });
  console.log("Clicked:", clicked);
  await new Promise(r => setTimeout(r, 3000));

  console.log(`New API calls after click (${intercepted.length}):`);
  for (const r of intercepted) {
    console.log(`  [${r.status}] ${r.url}`);
    if (r.body) console.log(`         ${r.body.replace(/\n/g," ").slice(0,150)}`);
  }

  const textAfterClick = await page.evaluate(() => document.body.innerText);
  console.log(`\nbody.innerText AFTER click (${textAfterClick.length} chars) — first 2000:`);
  console.log(textAfterClick.slice(0, 2000));

  // ── STEP 6: Hover over first odds cell and capture popup ─────────────────
  console.log("\n=== STEP 6: Hover over first odds cell ===");
  const hoverResult = await page.evaluate(() => {
    // Try to find the first bookmaker row's home odds cell
    const rows = Array.from(document.getElementsByClassName("flex"));
    for (const el of rows) {
      const txt = (el.innerText || "").trim();
      if ((txt.endsWith("%") || txt.endsWith("-")) && el.children.length >= 4) {
        const cell = el.children[1] && el.children[1].children[0];
        if (cell) {
          cell.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
          return { found: true, rowText: txt.slice(0, 80) };
        }
      }
    }
    return { found: false };
  });
  console.log("Hover result:", hoverResult);
  await new Promise(r => setTimeout(r, 1000));

  const popupEls = await page.evaluate(() => {
    const candidates = [];
    for (const sel of ["[class*='tooltip']","[class*='Tooltip']","[class*='popup']","[class*='Popup']","[class*='overlay']","[class*='modal']"]) {
      const els = document.querySelectorAll(sel);
      for (const el of els) {
        const txt = (el.innerText || "").trim();
        if (txt.length > 0) candidates.push({ sel, cls: (el.className||"").toString().slice(0,80), text: txt.slice(0,200) });
      }
    }
    return candidates;
  });
  console.log("Popup elements found:", popupEls.length);
  for (const p of popupEls) {
    console.log(`  cls: "${p.cls}"\n  text: "${p.text}"`);
  }

  // ── STEP 7: Full innerText after all expansions ───────────────────────────
  // Click all remaining expanders
  console.log("\n=== STEP 7: Expand ALL sections + full innerText ===");
  const allExpanded = await page.evaluate(() => {
    const labels = [];
    const els = Array.from(document.getElementsByClassName("flex w-full items-center"));
    for (const el of els) {
      const txt = (el.innerText || "").trim();
      if (txt.length > 0 && txt.length < 80) { el.click(); labels.push(txt.slice(0,40)); }
    }
    return labels;
  });
  console.log("Expanded:", allExpanded);
  await new Promise(r => setTimeout(r, 4000));

  const fullText = await page.evaluate(() => document.body.innerText);
  console.log(`\nFull body.innerText (${fullText.length} chars):`);
  // Print all of it in chunks
  for (let i = 0; i < Math.min(fullText.length, 8000); i += 1000) {
    console.log("---", i, "---");
    console.log(fullText.slice(i, i + 1000));
  }

  await browser.close();
  console.log("\n=== Inspector done ===");
})().catch(e => { console.error("Fatal:", e); process.exit(1); });
