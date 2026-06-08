import { Router } from "express";
import { trainModel, predictMatch, predictByTeams, modelStatus } from "../lib/mlModel.js";
import { getProcessingMatchById, getDb } from "../lib/db.js";

const router = Router();

router.get("/model/status", (_req, res) => {
  res.json(modelStatus());
});

router.post("/model/train", (_req, res) => {
  try {
    const result = trainModel();
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) });
  }
});

router.post("/model/predict", (req, res) => {
  const { matchId } = req.body as { matchId?: string };
  if (!matchId) return void res.status(400).json({ error: "matchId required" });

  const db = getDb();

  // Try processing_matches first, then stored_matches
  let row: Record<string, unknown> | null = getProcessingMatchById(matchId) as Record<string, unknown> | null;

  if (!row) {
    row = db.prepare("SELECT * FROM stored_matches WHERE id = ?").get(matchId) as Record<string, unknown> | null;
  }

  if (!row) return void res.status(404).json({ error: "Match not found" });

  try {
    const prediction = predictMatch(row as Parameters<typeof predictMatch>[0]);
    res.json(prediction);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.post("/model/predict-by-teams", (req, res) => {
  const { homeTeam, awayTeam, kickoffTs } = req.body as {
    homeTeam?: string; awayTeam?: string; kickoffTs?: number;
  };
  if (!homeTeam || !awayTeam || !kickoffTs) {
    return void res.status(400).json({ error: "homeTeam, awayTeam, kickoffTs required" });
  }
  try {
    const prediction = predictByTeams(homeTeam, awayTeam, kickoffTs);
    if (!prediction) return void res.status(404).json({ error: "no_data" });
    res.json(prediction);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

export default router;
