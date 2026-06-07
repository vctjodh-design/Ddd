import { Router } from "express";
import { startProcessingJob } from "../lib/processingJob.js";
import {
  getProcessingJob, listProcessingJobs, deleteProcessingJob,
  listProcessingMatches, getProcessingDbStats,
} from "../lib/db.js";

const router = Router();

/** POST /api/processing/start */
router.post("/processing/start", (req, res) => {
  const { date } = req.body as Record<string, unknown>;
  if (!date || typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    res.status(400).json({ error: "date is required in YYYY-MM-DD format" });
    return;
  }
  const job = startProcessingJob({ date });
  res.status(201).json({ jobId: job.id, status: job.status, date: job.date });
});

/** GET /api/processing/status/:id */
router.get("/processing/status/:id", (req, res) => {
  const job = getProcessingJob(req.params.id);
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

/** GET /api/processing/list */
router.get("/processing/list", (_req, res) => {
  const jobs = listProcessingJobs();
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

/** GET /api/processing/matches?date=YYYY-MM-DD */
router.get("/processing/matches", (req, res) => {
  const date = typeof req.query.date === "string" ? req.query.date : undefined;
  const limit = Math.min(parseInt(String(req.query.limit ?? "200")), 500);
  const offset = parseInt(String(req.query.offset ?? "0"));
  const matches = listProcessingMatches({ date, limit, offset });
  res.json(matches.map(m => ({
    id: m.id, jobId: m.job_id, date: m.date,
    homeTeam: m.home_team, awayTeam: m.away_team,
    homeScore: m.home_score, awayScore: m.away_score,
    status: m.status, leagueName: m.league_name, countryName: m.country_name,
    kickoffTs: m.kickoff_ts,
    hasHomeStats:   !!m.home_team_stats_json,
    hasAwayStats:   !!m.away_team_stats_json,
    hasHomePlayer:  !!m.home_player_stats_json,
    hasAwayPlayer:  !!m.away_player_stats_json,
    hasPo1x2:   !!m.po_1x2_json,
    hasPoOU:    !!m.po_ou_json,
    hasPoAH:    !!m.po_ah_json,
    hasPoAll:   !!(m.po_1x2_json && m.po_ou_json),
    createdAt: m.created_at,
  })));
});

/** GET /api/processing/stats */
router.get("/processing/stats", (_req, res) => {
  res.json(getProcessingDbStats());
});

/** DELETE /api/processing/:id */
router.delete("/processing/:id", (req, res) => {
  const job = getProcessingJob(req.params.id);
  if (!job) { res.status(404).json({ error: "Job not found" }); return; }
  deleteProcessingJob(req.params.id);
  res.json({ deleted: true });
});

export default router;
