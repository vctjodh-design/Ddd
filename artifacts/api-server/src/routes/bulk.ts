import { Router } from "express";
import { startBulkJob } from "../lib/bulkJob.js";
import { getJob, listJobs, deleteJob } from "../lib/db.js";

const router = Router();

/** POST /api/bulk/start — kick off a new bulk upload job */
router.post("/bulk/start", (req, res) => {
  const { leagueName, countryName, oddsPortalPath, year } = req.body as Record<string, unknown>;

  if (!oddsPortalPath || typeof oddsPortalPath !== "string") {
    res.status(400).json({ error: "oddsPortalPath is required (e.g. 'england/premier-league')" });
    return;
  }
  if (!year || typeof year !== "number" || year < 1990 || year > 2030) {
    res.status(400).json({ error: "year must be a number between 1990 and 2030" });
    return;
  }

  const job = startBulkJob({
    leagueName:      String(leagueName ?? "Unknown League"),
    countryName:     String(countryName ?? "Unknown Country"),
    oddsPortalPath:  oddsPortalPath.trim().replace(/^\/|\/$/g, ""),
    year:            year,
  });

  res.status(201).json({ jobId: job.id, status: job.status });
});

/** GET /api/bulk/status/:id — poll job progress */
router.get("/bulk/status/:id", (req, res) => {
  const job = getJob(req.params.id);
  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }
  let logs: string[] = [];
  try { logs = JSON.parse(job.log_json || "[]"); } catch {}
  res.json({
    id:             job.id,
    status:         job.status,
    leagueName:     job.league_name,
    countryName:    job.country_name,
    oddsPortalPath: job.odds_portal_path,
    year:           job.year,
    totalMatches:   job.total_matches,
    processed:      job.processed,
    stored:         job.stored,
    skipped:        job.skipped,
    currentMatch:   job.current_match,
    errorMessage:   job.error_message,
    logs:           logs.slice(-100),
    createdAt:      job.created_at,
    updatedAt:      job.updated_at,
  });
});

/** GET /api/bulk/list — list all jobs */
router.get("/bulk/list", (_req, res) => {
  const jobs = listJobs();
  res.json(jobs.map(j => {
    let logs: string[] = [];
    try { logs = JSON.parse(j.log_json || "[]"); } catch {}
    return {
      id:             j.id,
      status:         j.status,
      leagueName:     j.league_name,
      countryName:    j.country_name,
      oddsPortalPath: j.odds_portal_path,
      year:           j.year,
      totalMatches:   j.total_matches,
      processed:      j.processed,
      stored:         j.stored,
      skipped:        j.skipped,
      currentMatch:   j.current_match,
      errorMessage:   j.error_message,
      lastLog:        logs[logs.length - 1] ?? null,
      createdAt:      j.created_at,
    };
  }));
});

/** DELETE /api/bulk/:id — delete a job and its matches */
router.delete("/bulk/:id", (req, res) => {
  const job = getJob(req.params.id);
  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }
  deleteJob(req.params.id);
  res.json({ deleted: true });
});

export default router;
