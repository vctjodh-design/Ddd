import { Router } from "express";
import { startTesterJob } from "../lib/testerJob.js";
import {
  getTesterJob, listTesterJobs, deleteTesterJob,
  listTesterMatches, getTesterMatchById,
  getTesterDbStats, clearAllTesterData,
} from "../lib/testerDb.js";
import { predictMatch } from "../lib/mlModel.js";

const router = Router();

/** POST /api/tester/start */
router.post("/tester/start", (req, res) => {
  const { date } = req.body as Record<string, unknown>;
  if (!date || typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    res.status(400).json({ error: "date is required in YYYY-MM-DD format" });
    return;
  }
  const job = startTesterJob({ date });
  res.status(201).json({ jobId: job.id, status: job.status, date: job.date });
});

/** GET /api/tester/status/:id */
router.get("/tester/status/:id", (req, res) => {
  const job = getTesterJob(req.params.id);
  if (!job) { res.status(404).json({ error: "Job not found" }); return; }
  let logs: string[] = [];
  try { logs = JSON.parse(job.log_json || "[]"); } catch {}
  res.json({
    id: job.id, status: job.status, date: job.date,
    totalMatches: job.total_matches, processed: job.processed,
    stored: job.stored, currentMatch: job.current_match,
    errorMessage: job.error_message,
    logs: logs.slice(-150),
    createdAt: job.created_at, updatedAt: job.updated_at,
  });
});

/** GET /api/tester/list */
router.get("/tester/list", (_req, res) => {
  const jobs = listTesterJobs();
  res.json(jobs.map(j => {
    let logs: string[] = [];
    try { logs = JSON.parse(j.log_json || "[]"); } catch {}
    return {
      id: j.id, status: j.status, date: j.date,
      totalMatches: j.total_matches, processed: j.processed, stored: j.stored,
      currentMatch: j.current_match, errorMessage: j.error_message,
      lastLog: logs[logs.length - 1] ?? null,
      createdAt: j.created_at,
    };
  }));
});

/** GET /api/tester/matches?date=YYYY-MM-DD */
router.get("/tester/matches", (req, res) => {
  const date   = typeof req.query.date === "string" ? req.query.date : undefined;
  const limit  = Math.min(parseInt(String(req.query.limit ?? "300")), 500);
  const offset = parseInt(String(req.query.offset ?? "0"));
  const matches = listTesterMatches({ date, limit, offset });
  res.json(matches.map(m => ({
    id: m.id, jobId: m.job_id, date: m.date,
    homeTeam: m.home_team, awayTeam: m.away_team,
    leagueName: m.league_name, countryName: m.country_name,
    kickoffTs: m.kickoff_ts,
    dataSource: m.data_source,
    hasHomeStats:  !!(m.home_team_stats_json || m.be_home_stats_json),
    hasAwayStats:  !!(m.away_team_stats_json || m.be_away_stats_json),
    hasOdds:       !!m.po_1x2_json,
    bookieCount:   m.bookie_count,
    createdAt: m.created_at,
  })));
});

/** GET /api/tester/stats */
router.get("/tester/stats", (_req, res) => {
  res.json(getTesterDbStats());
});

/** POST /api/tester/predict/:id — predict from stored tester data, no re-scraping */
router.post("/tester/predict/:id", (req, res) => {
  const match = getTesterMatchById(req.params.id);
  if (!match) { res.status(404).json({ error: "Match not found" }); return; }
  try {
    const prediction = predictMatch({
      home_team_stats_json:   match.home_team_stats_json,
      away_team_stats_json:   match.away_team_stats_json,
      home_player_stats_json: match.home_player_stats_json,
      away_player_stats_json: match.away_player_stats_json,
      be_home_stats_json:     match.be_home_stats_json,
      be_away_stats_json:     match.be_away_stats_json,
      po_1x2_json:  match.po_1x2_json,
      po_btts_json: match.po_btts_json,
      po_ou_json:   match.po_ou_json,
      po_dc_json:   match.po_dc_json,
    });
    res.json({ ...prediction, bookieCount: match.bookie_count, dataSource: match.data_source });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

/** DELETE /api/tester/matches/all — wipe entire tester DB */
router.delete("/tester/matches/all", (_req, res) => {
  const result = clearAllTesterData();
  res.json({ deleted: true, deletedMatches: result.deletedMatches, deletedJobs: result.deletedJobs });
});

/** DELETE /api/tester/:id */
router.delete("/tester/:id", (req, res) => {
  const job = getTesterJob(req.params.id);
  if (!job) { res.status(404).json({ error: "Job not found" }); return; }
  deleteTesterJob(req.params.id);
  res.json({ deleted: true });
});

export default router;
