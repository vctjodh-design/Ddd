import { Router } from "express";
import {
  listAllMatchesForViewer, countAllMatchesForViewer,
  getMatch, getProcessingMatchById,
  deleteMatch, dbStats,
} from "../lib/db.js";

const router = Router();

/** GET /api/db/stats — overall database summary */
router.get("/db/stats", (_req, res) => {
  res.json(dbStats());
});

/** GET /api/db/matches — paginated match list (union of stored + processing) */
router.get("/db/matches", (req, res) => {
  const limit  = Math.min(parseInt(String(req.query["limit"]  ?? "50")), 200);
  const offset = Math.max(parseInt(String(req.query["offset"] ?? "0")),  0);

  const matches = listAllMatchesForViewer({ limit, offset });
  const total   = countAllMatchesForViewer();

  res.json({
    total,
    limit,
    offset,
    matches: matches.map(m => ({
      id:           m.id,
      source:       m.source,
      leagueName:   m.league_name ?? "",
      countryName:  m.country_name ?? "",
      date:         m.date,
      homeTeam:     m.home_team,
      awayTeam:     m.away_team,
      homeScore:    m.home_score,
      awayScore:    m.away_score,
      hasHomeStats: !!m.has_stats,
      hasAwayStats: !!m.has_stats,
      hasPlayer:    !!m.has_player,
      hasOdds:      !!m.has_odds,
      createdAt:    m.created_at,
    })),
  });
});

/** GET /api/db/match/:id — full match detail; supports both stored (match_) and processing (pm_) IDs */
router.get("/db/match/:id", (req, res) => {
  const id = req.params.id;
  const parseJson = (s: string | null) => {
    if (!s) return null;
    try { return JSON.parse(s); } catch { return null; }
  };

  if (id.startsWith("pm_")) {
    const m = getProcessingMatchById(id);
    if (!m) { res.status(404).json({ error: "Match not found" }); return; }
    res.json({
      id:              m.id,
      source:          "processing",
      leagueName:      m.league_name ?? "",
      countryName:     m.country_name ?? "",
      date:            m.date,
      homeTeam:        m.home_team,
      awayTeam:        m.away_team,
      homeScore:       m.home_score,
      awayScore:       m.away_score,
      homeStats:       parseJson(m.home_team_stats_json),
      awayStats:       parseJson(m.away_team_stats_json),
      homePlayerStats: parseJson(m.home_player_stats_json),
      awayPlayerStats: parseJson(m.away_player_stats_json),
      odds: {
        "1x2":  parseJson(m.po_1x2_json),
        "ou":   parseJson(m.po_ou_json),
        "ah":   parseJson(m.po_ah_json),
        "btts": parseJson(m.po_btts_json),
        "dc":   parseJson(m.po_dc_json),
        "eh":   parseJson(m.po_eh_json),
        "dnb":  parseJson(m.po_dnb_json),
        "cs":   parseJson(m.po_cs_json),
        "htft": parseJson(m.po_htft_json),
        "oe":   parseJson(m.po_oe_json),
      },
      createdAt: m.created_at,
    });
    return;
  }

  const m = getMatch(id);
  if (!m) { res.status(404).json({ error: "Match not found" }); return; }
  res.json({
    id:              m.id,
    source:          "stored",
    leagueName:      m.league_name,
    countryName:     m.country_name,
    date:            m.match_date,
    homeTeam:        m.home_team,
    awayTeam:        m.away_team,
    homeScore:       m.home_score,
    awayScore:       m.away_score,
    homeStats:       parseJson(m.home_stats_json),
    awayStats:       parseJson(m.away_stats_json),
    homePlayerStats: null,
    awayPlayerStats: null,
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

/** DELETE /api/db/match/:id — remove a single stored match (processing matches not deletable via this route) */
router.delete("/db/match/:id", (req, res) => {
  const m = getMatch(req.params.id);
  if (!m) { res.status(404).json({ error: "Match not found" }); return; }
  deleteMatch(req.params.id);
  res.json({ deleted: true });
});

export default router;
