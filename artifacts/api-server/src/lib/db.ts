/**
 * SQLite database — persistent storage for bulk-uploaded match data.
 * Uses better-sqlite3 (synchronous, fast, zero-config).
 */
import Database from "better-sqlite3";
import path from "path";
import { mkdirSync } from "fs";

const DB_DIR  = path.resolve(process.cwd(), "data");
const DB_PATH = path.resolve(DB_DIR, "nexus.db");

try { mkdirSync(DB_DIR, { recursive: true }); } catch {}

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!_db) {
    _db = new Database(DB_PATH);
    _db.pragma("journal_mode = WAL");
    _db.pragma("foreign_keys = ON");
    initSchema(_db);
  }
  return _db;
}

function initSchema(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS bulk_jobs (
      id             TEXT PRIMARY KEY,
      league_name    TEXT NOT NULL,
      country_name   TEXT NOT NULL,
      odds_portal_path TEXT NOT NULL,
      year           INTEGER NOT NULL,
      status         TEXT NOT NULL DEFAULT 'pending',
      total_matches  INTEGER DEFAULT 0,
      processed      INTEGER DEFAULT 0,
      stored         INTEGER DEFAULT 0,
      skipped        INTEGER DEFAULT 0,
      current_match  TEXT,
      log_json       TEXT DEFAULT '[]',
      error_message  TEXT,
      created_at     INTEGER NOT NULL,
      updated_at     INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS stored_matches (
      id              TEXT PRIMARY KEY,
      job_id          TEXT NOT NULL,
      league_name     TEXT NOT NULL,
      country_name    TEXT NOT NULL,
      odds_portal_path TEXT NOT NULL,
      year            INTEGER NOT NULL,
      match_date      TEXT NOT NULL,
      home_team       TEXT NOT NULL,
      away_team       TEXT NOT NULL,
      home_score      INTEGER,
      away_score      INTEGER,
      home_team_id    INTEGER,
      away_team_id    INTEGER,
      home_stats_json TEXT,
      away_stats_json TEXT,
      odds_1x2_json   TEXT,
      odds_ou_json    TEXT,
      odds_ah_json    TEXT,
      odds_btts_json  TEXT,
      odds_dc_json    TEXT,
      odds_eh_json    TEXT,
      odds_dnb_json   TEXT,
      odds_cs_json    TEXT,
      odds_htft_json  TEXT,
      odds_oe_json    TEXT,
      created_at      INTEGER NOT NULL,
      FOREIGN KEY (job_id) REFERENCES bulk_jobs(id)
    );

    CREATE INDEX IF NOT EXISTS idx_sm_job    ON stored_matches(job_id);
    CREATE INDEX IF NOT EXISTS idx_sm_league ON stored_matches(odds_portal_path, year);
    CREATE INDEX IF NOT EXISTS idx_sm_date   ON stored_matches(match_date);

    CREATE TABLE IF NOT EXISTS processing_jobs (
      id              TEXT PRIMARY KEY,
      date            TEXT NOT NULL,
      status          TEXT NOT NULL DEFAULT 'pending',
      total_matches   INTEGER DEFAULT 0,
      processed       INTEGER DEFAULT 0,
      stored          INTEGER DEFAULT 0,
      current_match   TEXT,
      log_json        TEXT DEFAULT '[]',
      error_message   TEXT,
      created_at      INTEGER NOT NULL,
      updated_at      INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_pj_date ON processing_jobs(date);

    CREATE TABLE IF NOT EXISTS processing_matches (
      id                       TEXT PRIMARY KEY,
      job_id                   TEXT NOT NULL,
      date                     TEXT NOT NULL,
      home_team                TEXT NOT NULL,
      away_team                TEXT NOT NULL,
      home_team_id             INTEGER,
      away_team_id             INTEGER,
      league_name              TEXT,
      league_id                INTEGER,
      country_name             TEXT,
      country_flag             TEXT,
      kickoff_ts               INTEGER,
      home_score               INTEGER,
      away_score               INTEGER,
      status                   TEXT,
      home_team_stats_json     TEXT,
      away_team_stats_json     TEXT,
      home_player_stats_json   TEXT,
      away_player_stats_json   TEXT,
      po_1x2_json              TEXT,
      po_ou_json               TEXT,
      po_ah_json               TEXT,
      po_btts_json             TEXT,
      po_dc_json               TEXT,
      po_dnb_json              TEXT,
      po_cs_json               TEXT,
      po_eh_json               TEXT,
      po_htft_json             TEXT,
      po_oe_json               TEXT,
      po_wtbh_json             TEXT,
      created_at               INTEGER NOT NULL,
      FOREIGN KEY (job_id) REFERENCES processing_jobs(id)
    );
    CREATE INDEX IF NOT EXISTS idx_pm_job  ON processing_matches(job_id);
    CREATE INDEX IF NOT EXISTS idx_pm_date ON processing_matches(date);
  `);
}

// ── Job helpers ──────────────────────────────────────────────────────────────

export interface BulkJob {
  id: string;
  league_name: string;
  country_name: string;
  odds_portal_path: string;
  year: number;
  status: "pending" | "running" | "complete" | "failed";
  total_matches: number;
  processed: number;
  stored: number;
  skipped: number;
  current_match: string | null;
  log_json: string;
  error_message: string | null;
  created_at: number;
  updated_at: number;
}

export function createJob(params: Omit<BulkJob, "id" | "status" | "total_matches" | "processed" | "stored" | "skipped" | "current_match" | "log_json" | "error_message" | "created_at" | "updated_at">): BulkJob {
  const db = getDb();
  const id = `job_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const now = Date.now();
  db.prepare(`
    INSERT INTO bulk_jobs (id, league_name, country_name, odds_portal_path, year, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)
  `).run(id, params.league_name, params.country_name, params.odds_portal_path, params.year, now, now);
  return getJob(id)!;
}

export function getJob(id: string): BulkJob | null {
  const db = getDb();
  return db.prepare("SELECT * FROM bulk_jobs WHERE id = ?").get(id) as BulkJob | null;
}

export function listJobs(): BulkJob[] {
  const db = getDb();
  return db.prepare("SELECT * FROM bulk_jobs ORDER BY created_at DESC LIMIT 50").all() as BulkJob[];
}

export function updateJob(id: string, patch: Partial<Omit<BulkJob, "id" | "created_at">>) {
  const db = getDb();
  const now = Date.now();
  const fields = Object.entries({ ...patch, updated_at: now });
  const setClauses = fields.map(([k]) => `${k} = ?`).join(", ");
  const values    = fields.map(([, v]) => v);
  db.prepare(`UPDATE bulk_jobs SET ${setClauses} WHERE id = ?`).run(...values, id);
}

export function appendJobLog(id: string, entry: string) {
  const db = getDb();
  const job = db.prepare("SELECT log_json FROM bulk_jobs WHERE id = ?").get(id) as { log_json: string } | null;
  if (!job) return;
  let logs: string[] = [];
  try { logs = JSON.parse(job.log_json || "[]"); } catch {}
  logs.push(`[${new Date().toISOString().slice(11, 19)}] ${entry}`);
  if (logs.length > 500) logs = logs.slice(-500);
  db.prepare("UPDATE bulk_jobs SET log_json = ?, updated_at = ? WHERE id = ?")
    .run(JSON.stringify(logs), Date.now(), id);
}

export function deleteJob(id: string) {
  const db = getDb();
  db.prepare("DELETE FROM stored_matches WHERE job_id = ?").run(id);
  db.prepare("DELETE FROM bulk_jobs WHERE id = ?").run(id);
}

// ── Match helpers ────────────────────────────────────────────────────────────

export interface StoredMatch {
  id: string;
  job_id: string;
  league_name: string;
  country_name: string;
  odds_portal_path: string;
  year: number;
  match_date: string;
  home_team: string;
  away_team: string;
  home_score: number | null;
  away_score: number | null;
  home_team_id: number | null;
  away_team_id: number | null;
  home_stats_json: string | null;
  away_stats_json: string | null;
  odds_1x2_json: string | null;
  odds_ou_json: string | null;
  odds_ah_json: string | null;
  odds_btts_json: string | null;
  odds_dc_json: string | null;
  odds_eh_json: string | null;
  odds_dnb_json: string | null;
  odds_cs_json: string | null;
  odds_htft_json: string | null;
  odds_oe_json: string | null;
  created_at: number;
}

export function insertMatch(m: Omit<StoredMatch, "id" | "created_at">): string {
  const db = getDb();
  const id = `match_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const now = Date.now();
  db.prepare(`
    INSERT OR REPLACE INTO stored_matches
    (id, job_id, league_name, country_name, odds_portal_path, year, match_date,
     home_team, away_team, home_score, away_score, home_team_id, away_team_id,
     home_stats_json, away_stats_json,
     odds_1x2_json, odds_ou_json, odds_ah_json, odds_btts_json,
     odds_dc_json, odds_eh_json, odds_dnb_json, odds_cs_json,
     odds_htft_json, odds_oe_json, created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    id, m.job_id, m.league_name, m.country_name, m.odds_portal_path, m.year,
    m.match_date, m.home_team, m.away_team, m.home_score ?? null, m.away_score ?? null,
    m.home_team_id ?? null, m.away_team_id ?? null,
    m.home_stats_json ?? null, m.away_stats_json ?? null,
    m.odds_1x2_json ?? null, m.odds_ou_json ?? null, m.odds_ah_json ?? null,
    m.odds_btts_json ?? null, m.odds_dc_json ?? null, m.odds_eh_json ?? null,
    m.odds_dnb_json ?? null, m.odds_cs_json ?? null, m.odds_htft_json ?? null,
    m.odds_oe_json ?? null, now
  );
  return id;
}

export function listMatches(opts: {
  limit?: number; offset?: number; jobId?: string;
  oddsPortalPath?: string; year?: number;
}): StoredMatch[] {
  const db = getDb();
  const wheres: string[] = [];
  const params: unknown[] = [];
  if (opts.jobId)          { wheres.push("job_id = ?");          params.push(opts.jobId); }
  if (opts.oddsPortalPath) { wheres.push("odds_portal_path = ?"); params.push(opts.oddsPortalPath); }
  if (opts.year)           { wheres.push("year = ?");             params.push(opts.year); }
  const where = wheres.length ? `WHERE ${wheres.join(" AND ")}` : "";
  params.push(opts.limit ?? 100, opts.offset ?? 0);
  return db.prepare(
    `SELECT * FROM stored_matches ${where} ORDER BY match_date DESC LIMIT ? OFFSET ?`
  ).all(...params) as StoredMatch[];
}

export function countMatches(opts: { jobId?: string; oddsPortalPath?: string; year?: number }): number {
  const db = getDb();
  const wheres: string[] = [];
  const params: unknown[] = [];
  if (opts.jobId)          { wheres.push("job_id = ?");          params.push(opts.jobId); }
  if (opts.oddsPortalPath) { wheres.push("odds_portal_path = ?"); params.push(opts.oddsPortalPath); }
  if (opts.year)           { wheres.push("year = ?");             params.push(opts.year); }
  const where = wheres.length ? `WHERE ${wheres.join(" AND ")}` : "";
  const row = db.prepare(`SELECT COUNT(*) as n FROM stored_matches ${where}`).get(...params) as { n: number };
  return row.n;
}

export function getMatch(id: string): StoredMatch | null {
  return getDb().prepare("SELECT * FROM stored_matches WHERE id = ?").get(id) as StoredMatch | null;
}

export function deleteMatch(id: string) {
  getDb().prepare("DELETE FROM stored_matches WHERE id = ?").run(id);
}

export function dbStats() {
  const db = getDb();
  const jobs = db.prepare("SELECT COUNT(*) as n FROM bulk_jobs").get() as { n: number };
  const matches = db.prepare("SELECT COUNT(*) as n FROM stored_matches").get() as { n: number };
  const withStats = db.prepare("SELECT COUNT(*) as n FROM stored_matches WHERE home_stats_json IS NOT NULL AND away_stats_json IS NOT NULL").get() as { n: number };
  const withOdds  = db.prepare("SELECT COUNT(*) as n FROM stored_matches WHERE odds_1x2_json IS NOT NULL").get() as { n: number };
  const leagues = db.prepare("SELECT DISTINCT odds_portal_path, league_name, country_name FROM stored_matches ORDER BY league_name").all() as {odds_portal_path: string; league_name: string; country_name: string}[];
  return { jobs: jobs.n, matches: matches.n, withStats: withStats.n, withOdds: withOdds.n, leagues };
}

// ── Processing Job helpers ────────────────────────────────────────────────────

export interface ProcessingJob {
  id: string;
  date: string;
  status: "pending" | "running" | "complete" | "failed";
  total_matches: number;
  processed: number;
  stored: number;
  current_match: string | null;
  log_json: string;
  error_message: string | null;
  created_at: number;
  updated_at: number;
}

export function createProcessingJob(params: { date: string }): ProcessingJob {
  const db = getDb();
  const id = `pjob_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const now = Date.now();
  db.prepare(`
    INSERT INTO processing_jobs (id, date, status, created_at, updated_at)
    VALUES (?, ?, 'pending', ?, ?)
  `).run(id, params.date, now, now);
  return getProcessingJob(id)!;
}

export function getProcessingJob(id: string): ProcessingJob | null {
  return getDb().prepare("SELECT * FROM processing_jobs WHERE id = ?").get(id) as ProcessingJob | null;
}

export function listProcessingJobs(): ProcessingJob[] {
  return getDb().prepare("SELECT * FROM processing_jobs ORDER BY created_at DESC LIMIT 100").all() as ProcessingJob[];
}

export function updateProcessingJob(id: string, patch: Partial<Omit<ProcessingJob, "id" | "created_at">>) {
  const db = getDb();
  const now = Date.now();
  const fields = Object.entries({ ...patch, updated_at: now });
  const setClauses = fields.map(([k]) => `${k} = ?`).join(", ");
  const values = fields.map(([, v]) => v);
  db.prepare(`UPDATE processing_jobs SET ${setClauses} WHERE id = ?`).run(...values, id);
}

export function appendProcessingLog(id: string, entry: string) {
  const db = getDb();
  const job = db.prepare("SELECT log_json FROM processing_jobs WHERE id = ?").get(id) as { log_json: string } | null;
  if (!job) return;
  let logs: string[] = [];
  try { logs = JSON.parse(job.log_json || "[]"); } catch {}
  logs.push(`[${new Date().toISOString().slice(11, 19)}] ${entry}`);
  if (logs.length > 500) logs = logs.slice(-500);
  db.prepare("UPDATE processing_jobs SET log_json = ?, updated_at = ? WHERE id = ?")
    .run(JSON.stringify(logs), Date.now(), id);
}

export function deleteProcessingJob(id: string) {
  const db = getDb();
  db.prepare("DELETE FROM processing_matches WHERE job_id = ?").run(id);
  db.prepare("DELETE FROM processing_jobs WHERE id = ?").run(id);
}

// ── Processing Match helpers ──────────────────────────────────────────────────

export interface ProcessingMatch {
  id: string;
  job_id: string;
  date: string;
  home_team: string;
  away_team: string;
  home_team_id: number | null;
  away_team_id: number | null;
  league_name: string | null;
  league_id: number | null;
  country_name: string | null;
  country_flag: string | null;
  kickoff_ts: number | null;
  home_score: number | null;
  away_score: number | null;
  status: string | null;
  home_team_stats_json: string | null;
  away_team_stats_json: string | null;
  home_player_stats_json: string | null;
  away_player_stats_json: string | null;
  po_1x2_json: string | null;
  po_ou_json: string | null;
  po_ah_json: string | null;
  po_btts_json: string | null;
  po_dc_json: string | null;
  po_dnb_json: string | null;
  po_cs_json: string | null;
  po_eh_json: string | null;
  po_htft_json: string | null;
  po_oe_json: string | null;
  po_wtbh_json: string | null;
  created_at: number;
}

export function insertProcessingMatch(m: Omit<ProcessingMatch, "id" | "created_at">): string {
  const db = getDb();
  const id = `pm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const now = Date.now();
  db.prepare(`
    INSERT OR REPLACE INTO processing_matches
    (id, job_id, date, home_team, away_team, home_team_id, away_team_id,
     league_name, league_id, country_name, country_flag, kickoff_ts,
     home_score, away_score, status,
     home_team_stats_json, away_team_stats_json,
     home_player_stats_json, away_player_stats_json,
     po_1x2_json, po_ou_json, po_ah_json, po_btts_json,
     po_dc_json, po_dnb_json, po_cs_json, po_eh_json,
     po_htft_json, po_oe_json, po_wtbh_json, created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    id, m.job_id, m.date, m.home_team, m.away_team,
    m.home_team_id ?? null, m.away_team_id ?? null,
    m.league_name ?? null, m.league_id ?? null,
    m.country_name ?? null, m.country_flag ?? null,
    m.kickoff_ts ?? null,
    m.home_score ?? null, m.away_score ?? null, m.status ?? null,
    m.home_team_stats_json ?? null, m.away_team_stats_json ?? null,
    m.home_player_stats_json ?? null, m.away_player_stats_json ?? null,
    m.po_1x2_json ?? null, m.po_ou_json ?? null, m.po_ah_json ?? null,
    m.po_btts_json ?? null, m.po_dc_json ?? null, m.po_dnb_json ?? null,
    m.po_cs_json ?? null, m.po_eh_json ?? null,
    m.po_htft_json ?? null, m.po_oe_json ?? null, m.po_wtbh_json ?? null,
    now
  );
  return id;
}

export function listProcessingMatches(opts: { date?: string; jobId?: string; limit?: number; offset?: number }): ProcessingMatch[] {
  const db = getDb();
  const wheres: string[] = [];
  const params: unknown[] = [];
  if (opts.date)  { wheres.push("date = ?");   params.push(opts.date); }
  if (opts.jobId) { wheres.push("job_id = ?"); params.push(opts.jobId); }
  const where = wheres.length ? `WHERE ${wheres.join(" AND ")}` : "";
  params.push(opts.limit ?? 200, opts.offset ?? 0);
  return db.prepare(
    `SELECT * FROM processing_matches ${where} ORDER BY kickoff_ts ASC, home_team ASC LIMIT ? OFFSET ?`
  ).all(...params) as ProcessingMatch[];
}

export function getProcessingDbStats() {
  const db = getDb();
  const jobs    = db.prepare("SELECT COUNT(*) as n FROM processing_jobs").get() as { n: number };
  const matches = db.prepare("SELECT COUNT(*) as n FROM processing_matches").get() as { n: number };
  const withStats = db.prepare("SELECT COUNT(*) as n FROM processing_matches WHERE home_team_stats_json IS NOT NULL").get() as { n: number };
  const withOdds  = db.prepare("SELECT COUNT(*) as n FROM processing_matches WHERE po_1x2_json IS NOT NULL").get() as { n: number };
  const withPlayer = db.prepare("SELECT COUNT(*) as n FROM processing_matches WHERE home_player_stats_json IS NOT NULL").get() as { n: number };
  const dates = db.prepare("SELECT DISTINCT date FROM processing_matches ORDER BY date DESC LIMIT 30").all() as { date: string }[];
  return { jobs: jobs.n, matches: matches.n, withStats: withStats.n, withOdds: withOdds.n, withPlayer: withPlayer.n, dates: dates.map(d => d.date) };
}
