/**
 * Tester database — separate SQLite for pre-match test runs.
 * Stores stats + odds for any date's fixtures WITHOUT storing actual outcomes.
 * Never mixed with training data (nexus.db).
 */
import Database from "better-sqlite3";
import path from "path";
import { mkdirSync } from "fs";

const DB_DIR  = path.resolve(process.cwd(), "data");
const DB_PATH = path.resolve(DB_DIR, "tester.db");

try { mkdirSync(DB_DIR, { recursive: true }); } catch {}

let _db: Database.Database | null = null;

export function getTesterDb(): Database.Database {
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
    CREATE TABLE IF NOT EXISTS tester_jobs (
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
    CREATE INDEX IF NOT EXISTS idx_tj_date ON tester_jobs(date);

    CREATE TABLE IF NOT EXISTS tester_matches (
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
      data_source              TEXT DEFAULT 'statshub',
      home_team_stats_json     TEXT,
      away_team_stats_json     TEXT,
      home_player_stats_json   TEXT,
      away_player_stats_json   TEXT,
      be_home_stats_json       TEXT,
      be_away_stats_json       TEXT,
      po_1x2_json              TEXT,
      po_ou_json               TEXT,
      po_ah_json               TEXT,
      po_btts_json             TEXT,
      po_dc_json               TEXT,
      po_dnb_json              TEXT,
      bookie_count             INTEGER DEFAULT 0,
      created_at               INTEGER NOT NULL,
      FOREIGN KEY (job_id) REFERENCES tester_jobs(id)
    );
    CREATE INDEX IF NOT EXISTS idx_tm_job  ON tester_matches(job_id);
    CREATE INDEX IF NOT EXISTS idx_tm_date ON tester_matches(date);
  `);

  const exists = (db.prepare(
    `SELECT 1 FROM sqlite_master WHERE type='index' AND name='idx_tm_unique'`
  ).get()) as unknown;
  if (!exists) {
    db.exec(`
      DELETE FROM tester_matches
      WHERE id NOT IN (
        SELECT id FROM tester_matches
        GROUP BY date, home_team, away_team
        HAVING id = MAX(id)
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_tm_unique
        ON tester_matches(date, home_team, away_team);
    `);
  }
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface TesterJob {
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

export interface TesterMatch {
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
  data_source: string;
  home_team_stats_json: string | null;
  away_team_stats_json: string | null;
  home_player_stats_json: string | null;
  away_player_stats_json: string | null;
  be_home_stats_json: string | null;
  be_away_stats_json: string | null;
  po_1x2_json: string | null;
  po_ou_json: string | null;
  po_ah_json: string | null;
  po_btts_json: string | null;
  po_dc_json: string | null;
  po_dnb_json: string | null;
  bookie_count: number;
  created_at: number;
}

// ── Job helpers ────────────────────────────────────────────────────────────────

export function createTesterJob(params: { date: string }): TesterJob {
  const db = getTesterDb();
  const id = `tjob_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const now = Date.now();
  db.prepare(`
    INSERT INTO tester_jobs (id, date, status, created_at, updated_at)
    VALUES (?, ?, 'pending', ?, ?)
  `).run(id, params.date, now, now);
  return getTesterJob(id)!;
}

export function getTesterJob(id: string): TesterJob | null {
  return getTesterDb().prepare("SELECT * FROM tester_jobs WHERE id = ?").get(id) as TesterJob | null;
}

export function listTesterJobs(): TesterJob[] {
  return getTesterDb().prepare("SELECT * FROM tester_jobs ORDER BY created_at DESC LIMIT 100").all() as TesterJob[];
}

export function updateTesterJob(id: string, patch: Partial<Omit<TesterJob, "id" | "created_at">>) {
  const db = getTesterDb();
  const now = Date.now();
  const fields = Object.entries({ ...patch, updated_at: now });
  const setClauses = fields.map(([k]) => `${k} = ?`).join(", ");
  const values = fields.map(([, v]) => v);
  db.prepare(`UPDATE tester_jobs SET ${setClauses} WHERE id = ?`).run(...values, id);
}

export function appendTesterLog(id: string, entry: string) {
  const db = getTesterDb();
  const job = db.prepare("SELECT log_json FROM tester_jobs WHERE id = ?").get(id) as { log_json: string } | null;
  if (!job) return;
  let logs: string[] = [];
  try { logs = JSON.parse(job.log_json || "[]"); } catch {}
  logs.push(`[${new Date().toISOString().slice(11, 19)}] ${entry}`);
  if (logs.length > 500) logs = logs.slice(-500);
  db.prepare("UPDATE tester_jobs SET log_json = ?, updated_at = ? WHERE id = ?")
    .run(JSON.stringify(logs), Date.now(), id);
}

export function deleteTesterJob(id: string) {
  const db = getTesterDb();
  db.prepare("DELETE FROM tester_matches WHERE job_id = ?").run(id);
  db.prepare("DELETE FROM tester_jobs WHERE id = ?").run(id);
}

export function clearAllTesterData(): { deletedMatches: number; deletedJobs: number } {
  const db = getTesterDb();
  const matchResult = db.prepare("DELETE FROM tester_matches").run();
  const jobResult   = db.prepare("DELETE FROM tester_jobs").run();
  return { deletedMatches: matchResult.changes, deletedJobs: jobResult.changes };
}

// ── Match helpers ─────────────────────────────────────────────────────────────

export function insertTesterMatch(m: Omit<TesterMatch, "id" | "created_at">): { id: string; inserted: boolean } {
  const db = getTesterDb();
  const id = `tm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const now = Date.now();
  const result = db.prepare(`
    INSERT OR IGNORE INTO tester_matches
    (id, job_id, date, home_team, away_team, home_team_id, away_team_id,
     league_name, league_id, country_name, country_flag, kickoff_ts,
     data_source,
     home_team_stats_json, away_team_stats_json,
     home_player_stats_json, away_player_stats_json,
     be_home_stats_json, be_away_stats_json,
     po_1x2_json, po_ou_json, po_ah_json, po_btts_json,
     po_dc_json, po_dnb_json, bookie_count, created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    id, m.job_id, m.date, m.home_team, m.away_team,
    m.home_team_id ?? null, m.away_team_id ?? null,
    m.league_name ?? null, m.league_id ?? null,
    m.country_name ?? null, m.country_flag ?? null,
    m.kickoff_ts ?? null,
    m.data_source ?? "statshub",
    m.home_team_stats_json ?? null, m.away_team_stats_json ?? null,
    m.home_player_stats_json ?? null, m.away_player_stats_json ?? null,
    m.be_home_stats_json ?? null, m.be_away_stats_json ?? null,
    m.po_1x2_json ?? null, m.po_ou_json ?? null, m.po_ah_json ?? null,
    m.po_btts_json ?? null, m.po_dc_json ?? null, m.po_dnb_json ?? null,
    m.bookie_count ?? 0,
    now
  );
  return { id, inserted: result.changes > 0 };
}

export function listTesterMatches(opts: {
  date?: string; jobId?: string; limit?: number; offset?: number;
}): TesterMatch[] {
  const db = getTesterDb();
  const wheres: string[] = [];
  const params: unknown[] = [];
  if (opts.date)  { wheres.push("date = ?");   params.push(opts.date); }
  if (opts.jobId) { wheres.push("job_id = ?"); params.push(opts.jobId); }
  const where = wheres.length ? `WHERE ${wheres.join(" AND ")}` : "";
  params.push(opts.limit ?? 300, opts.offset ?? 0);
  return db.prepare(
    `SELECT * FROM tester_matches ${where} ORDER BY kickoff_ts ASC NULLS LAST, home_team ASC LIMIT ? OFFSET ?`
  ).all(...params) as TesterMatch[];
}

export function getTesterMatchById(id: string): TesterMatch | null {
  return getTesterDb().prepare("SELECT * FROM tester_matches WHERE id = ?").get(id) as TesterMatch | null;
}

export function getTesterDbStats() {
  const db = getTesterDb();
  const jobs    = db.prepare("SELECT COUNT(*) as n FROM tester_jobs").get() as { n: number };
  const matches = db.prepare("SELECT COUNT(*) as n FROM tester_matches").get() as { n: number };
  const withStats = db.prepare(
    "SELECT COUNT(*) as n FROM tester_matches WHERE home_team_stats_json IS NOT NULL OR be_home_stats_json IS NOT NULL"
  ).get() as { n: number };
  const withOdds  = db.prepare(
    "SELECT COUNT(*) as n FROM tester_matches WHERE po_1x2_json IS NOT NULL"
  ).get() as { n: number };
  const dates = db.prepare(
    "SELECT DISTINCT date FROM tester_matches ORDER BY date DESC LIMIT 30"
  ).all() as { date: string }[];
  return { jobs: jobs.n, matches: matches.n, withStats: withStats.n, withOdds: withOdds.n, dates: dates.map(d => d.date) };
}
