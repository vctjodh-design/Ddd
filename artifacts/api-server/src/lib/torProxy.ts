/**
 * Tor SOCKS5 proxy manager for BetExplorer geo-bypass.
 *
 * Strategy:
 *   1. Spawn Tor without StrictNodes (fast ~15s bootstrap).
 *   2. After bootstrap, verify the exit IP via api.ipify.org through SOCKS5.
 *   3. If the exit IP is in the EU/non-US geo, mark ready.
 *      If US, send SIGNAL NEWNYM via the Tor control port to rotate the
 *      circuit and re-verify (up to MAX_RETRIES times).
 *   4. Falls back to direct fetch if Tor fails or stays on a US exit.
 *
 * Set TOR_PROXY=0 to disable entirely.
 * Set TOR_SOCKS=socks5://host:port to use an external proxy instead.
 *
 * Tor is started eagerly at module load so it's ready before any
 * processing job begins.
 */

import { spawn }      from "node:child_process";
import { rmSync }     from "node:fs";
import net            from "node:net";
import https          from "node:https";
import http           from "node:http";
import { SocksProxyAgent } from "socks-proxy-agent";
import { logger }     from "./logger.js";

const TOR_DISABLED      = process.env["TOR_PROXY"] === "0";
const SOCKS_PORT        = 9050;
const CONTROL_PORT      = 9051;
const DATA_DIR          = "/tmp/tor-be-proxy";
const BOOTSTRAP_TIMEOUT = 120_000;   // 120s — allow more time on slower networks
const MAX_RETRIES       = 12;        // rotate circuit up to 12 times
const NEWNYM_DELAY      = 4_000;     // ms to wait after NEWNYM before re-checking
// Country codes considered "EU / non-US" for BetExplorer bookmaker geo
const EU_COUNTRIES = new Set([
  "DE","GB","NL","FR","IT","PL","ES","AT","BE","SE","CH",
  "PT","CZ","HU","RO","DK","FI","NO","SK","HR","SI","LT","LV","EE",
  "LU","MT","CY","GR","BG","IE","RS","UA","TR",
]);

let torAgent: SocksProxyAgent | null = null;
let torReady  = false;
let torFailed = false;
let bootstrapPromise: Promise<void> | null = null;

// ── Tor process ────────────────────────────────────────────────────────────────

function spawnTor(): Promise<void> {
  return new Promise((resolve, reject) => {
    try { rmSync(DATA_DIR, { recursive: true, force: true }); } catch { /* ignore */ }

    const proc = spawn("tor", [
      "--DataDirectory", DATA_DIR,
      "--SocksPort",    String(SOCKS_PORT),
      "--ControlPort",  String(CONTROL_PORT),
      "--CookieAuthentication", "0",   // no auth — loopback only
      "--Log", "notice stderr",
      // Note: ExcludeExitNodes/StrictNodes omitted — GEOIP files unavailable in nix store.
      // Country filtering is handled post-bootstrap via ip-api.com + NEWNYM rotation.
    ], { stdio: ["ignore", "ignore", "pipe"] });

    const timer = setTimeout(() => {
      proc.kill();
      reject(new Error(`Tor bootstrap timed out after ${BOOTSTRAP_TIMEOUT / 1000}s`));
    }, BOOTSTRAP_TIMEOUT);

    proc.stderr!.on("data", (chunk: Buffer) => {
      const line = chunk.toString();
      if (line.includes("Bootstrapped 100%")) {
        clearTimeout(timer);
        logger.info("[TorProxy] Bootstrapped 100% — SOCKS5 ready on port " + SOCKS_PORT);
        resolve();
      }
      if (line.includes("Bootstrapped")) {
        logger.info("[TorProxy] " + line.trim());
      }
    });

    proc.on("error", (e) => { clearTimeout(timer); reject(e); });
    proc.on("exit",  (code) => {
      if (code !== 0 && code !== null) { clearTimeout(timer); reject(new Error(`Tor exited ${code}`)); }
    });

    process.on("exit",   () => { try { proc.kill(); } catch { /* ignore */ } });
    process.on("SIGTERM",() => { try { proc.kill(); } catch { /* ignore */ } });
  });
}

// ── Tor control port — NEWNYM ─────────────────────────────────────────────────

function sendNewnym(): Promise<void> {
  return new Promise((resolve) => {
    const sock = net.createConnection(CONTROL_PORT, "127.0.0.1", () => {
      sock.write("SIGNAL NEWNYM\r\n");
      sock.end();
    });
    sock.on("close",   () => resolve());
    sock.on("error",   () => resolve());  // non-fatal
    sock.setTimeout(3000, () => { sock.destroy(); resolve(); });
  });
}

// ── Exit IP check through SOCKS5 ──────────────────────────────────────────────

function getExitCountry(agent: SocksProxyAgent): Promise<string | null> {
  return new Promise((resolve) => {
    // Use ip-api.com (free, no account required, returns JSON with countryCode)
    const req = http.request({
      agent,
      method:   "GET",
      hostname: "ip-api.com",
      port:     80,
      path:     "/json/?fields=countryCode",
      headers:  { Host: "ip-api.com", "User-Agent": "curl/7.88" },
      timeout:  10_000,
    }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (c: string) => body += c);
      res.on("end",  () => {
        try {
          const json = JSON.parse(body) as { countryCode?: string };
          resolve(json.countryCode?.trim().toUpperCase() ?? null);
        } catch {
          resolve(null);
        }
      });
      res.on("error",() => resolve(null));
    });
    req.on("error",   () => resolve(null));
    req.on("timeout", () => { req.destroy(); resolve(null); });
    req.end();
  });
}

// ── Bootstrap orchestration ────────────────────────────────────────────────────

function startBootstrap(): Promise<void> {
  if (bootstrapPromise) return bootstrapPromise;
  if (TOR_DISABLED) { bootstrapPromise = Promise.resolve(); return bootstrapPromise; }

  bootstrapPromise = (async () => {
    // External proxy shortcut
    if (process.env["TOR_SOCKS"]) {
      const url = process.env["TOR_SOCKS"]!;
      logger.info(`[TorProxy] Using external SOCKS5 proxy: ${url}`);
      torAgent = new SocksProxyAgent(url);
      torReady = true;
      return;
    }

    logger.info("[TorProxy] Starting Tor…");
    try {
      await spawnTor();
    } catch (err) {
      logger.warn({ err }, "[TorProxy] Tor bootstrap failed — falling back to direct fetch");
      torFailed = true;
      return;
    }

    const agent = new SocksProxyAgent(`socks5://127.0.0.1:${SOCKS_PORT}`);

    // Retry loop: rotate circuits until we get an EU exit node
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      const country = await getExitCountry(agent);
      logger.info(`[TorProxy] Exit IP check #${attempt}: country=${country ?? "unknown"}`);

      if (country && EU_COUNTRIES.has(country)) {
        logger.info(`[TorProxy] EU exit node confirmed (${country}) — ready ✓`);
        torAgent = agent;
        torReady = true;
        return;
      }

      // US or unknown — request a new circuit
      logger.info(`[TorProxy] Non-EU exit (${country ?? "?"}) — sending NEWNYM, waiting ${NEWNYM_DELAY}ms…`);
      await sendNewnym();
      await new Promise(r => setTimeout(r, NEWNYM_DELAY));
    }

    // Ran out of retries — use whatever circuit we have (better than direct)
    logger.warn(`[TorProxy] Could not confirm EU exit after ${MAX_RETRIES} retries — using current circuit`);
    torAgent = agent;
    torReady = true;
  })();

  return bootstrapPromise;
}

// ── Eager init at module load ─────────────────────────────────────────────────
startBootstrap();

// ── Fetch wrapper ─────────────────────────────────────────────────────────────

interface TorFetchOptions {
  method?:   string;
  headers?:  Record<string, string>;
  timeout?:  number;
  redirect?: "follow" | "manual";
}

interface TorFetchResponse {
  ok:     boolean;
  status: number;
  text(): Promise<string>;
}

/** HTTP/HTTPS request through the Tor SOCKS5 proxy (or direct if unavailable). */
export async function torFetch(
  url:     string,
  options: TorFetchOptions = {},
): Promise<TorFetchResponse> {
  await startBootstrap();

  if (!torReady || !torAgent) {
    const resp = await fetch(url, {
      method:  options.method,
      headers: options.headers,
      redirect: options.redirect ?? "follow",
      signal:  AbortSignal.timeout(options.timeout ?? 30_000),
    });
    return { ok: resp.ok, status: resp.status, text: () => resp.text() };
  }

  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const mod    = parsed.protocol === "https:" ? https : http;

    const req = mod.request({
      agent:    torAgent!,
      method:   options.method ?? "GET",
      hostname: parsed.hostname,
      port:     parsed.port || (parsed.protocol === "https:" ? 443 : 80),
      path:     parsed.pathname + parsed.search,
      headers:  { Host: parsed.hostname, ...options.headers },
      timeout:  options.timeout ?? 30_000,
    }, (res) => {
      if (
        options.redirect !== "manual" &&
        res.statusCode && res.statusCode >= 300 && res.statusCode < 400 &&
        res.headers.location
      ) {
        resolve(torFetch(res.headers.location, options));
        res.resume();
        return;
      }
      let body = "";
      res.setEncoding("utf8");
      res.on("data",  (c: string) => body += c);
      res.on("end",   () => resolve({
        ok:     (res.statusCode ?? 0) >= 200 && (res.statusCode ?? 0) < 300,
        status: res.statusCode ?? 0,
        text:   () => Promise.resolve(body),
      }));
      res.on("error", reject);
    });

    req.on("error",   reject);
    req.on("timeout", () => req.destroy(new Error("torFetch timeout")));
    req.end();
  });
}

export { torReady, torFailed, TOR_DISABLED };
