import { Router } from "express";
import { listMatches, countMatches, getMatch, deleteMatch, dbStats } from "../lib/db.js";

const router = Router();

/** GET /api/db/stats — overall database summary */
router.get("/db/stats", (_req, res) => {
  res.json(dbStats());
});

/** GET /api/db/matches — paginated match list */
router.get("/db/matches", (req, res) => {
  const limit  = Math.min(parseInt(String(req.query["limit"]  ?? "50")), 200);
  const offset = Math.max(parseInt(String(req.query["offset"] ?? "0")),  0);
  const jobId          = req.query["jobId"]          as string | undefined;
  const oddsPortalPath = req.query["oddsPortalPath"] as string | undefined;
  const year = req.query["year"] ? parseInt(String(req.query["year"])) : undefined;

  const opts = { limit, offset, jobId, oddsPortalPath, year };
  const matches = listMatches(opts);
  const total   = countMatches({ jobId, oddsPortalPath, year });

  res.json({
    total,
    limit,
    offset,
    matches: matches.map(m => ({
      id:             m.id,
      jobId:          m.job_id,
      leagueName:     m.league_name,
      countryName:    m.country_name,
      oddsPortalPath: m.odds_portal_path,
      year:           m.year,
      date:           m.match_date,
      homeTeam:       m.home_team,
      awayTeam:       m.away_team,
      homeScore:      m.home_score,
      awayScore:      m.away_score,
      hasHomeStats:   !!m.home_stats_json,
      hasAwayStats:   !!m.away_stats_json,
      has1x2:         !!m.odds_1x2_json,
      hasOU:          !!m.odds_ou_json,
      hasAH:          !!m.odds_ah_json,
      hasBTTS:        !!m.odds_btts_json,
      hasDC:          !!m.odds_dc_json,
      hasCS:          !!m.odds_cs_json,
      hasHTFT:        !!m.odds_htft_json,
      createdAt:      m.created_at,
    })),
  });
});

/** GET /api/db/match/:id — full match detail including all JSON blobs */
router.get("/db/match/:id", (req, res) => {
  const m = getMatch(req.params.id);
  if (!m) {
    res.status(404).json({ error: "Match not found" });
    return;
  }

  const parseJson = (s: string | null) => {
    if (!s) return null;
    try { return JSON.parse(s); } catch { return null; }
  };

  res.json({
    id:             m.id,
    jobId:          m.job_id,
    leagueName:     m.league_name,
    countryName:    m.country_name,
    oddsPortalPath: m.odds_portal_path,
    year:           m.year,
    date:           m.match_date,
    homeTeam:       m.home_team,
    awayTeam:       m.away_team,
    homeScore:      m.home_score,
    awayScore:      m.away_score,
    homeTeamId:     m.home_team_id,
    awayTeamId:     m.away_team_id,
    homeStats:      parseJson(m.home_stats_json),
    awayStats:      parseJson(m.away_stats_json),
    odds: {
      "1x2":  parseJson(m.odds_1x2_json),
      "ou":   parseJson(m.odds_ou_json),
      "ah":   parseJson(m.odds_ah_json),
      "btts": parseJson(m.odds_btts_json),
      "dc":   parseJson(m.odds_dc_json),
      "eh":   parseJson(m.odds_eh_json),
      "dnb":  parseJson(m.odds_dnb_json),
      "cs":   parseJson(m.odds_cs_json),
      "htft": parseJson(m.odds_htft_json),
      "oe":   parseJson(m.odds_oe_json),
    },
    createdAt: m.created_at,
  });
});

/** DELETE /api/db/match/:id — remove a single stored match */
router.delete("/db/match/:id", (req, res) => {
  const m = getMatch(req.params.id);
  if (!m) {
    res.status(404).json({ error: "Match not found" });
    return;
  }
  deleteMatch(req.params.id);
  res.json({ deleted: true });
});

export default router;
