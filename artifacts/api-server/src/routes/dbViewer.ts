import { Router } from "express";
import {
  listAllMatchesForViewer, countAllMatchesForViewer,
  getMatch, getProcessingMatchById, getProcessingMatchByTeams,
  deleteMatch, dbStats,
} from "../lib/db.js";
import { getTesterMatchByTeams } from "../lib/testerDb.js";
import { analyzeMatch } from "../lib/wizardAnalysis.js";

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
      dataSource:   m.data_source ?? null,
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
      kickoffTs:       m.kickoff_ts ?? null,
      homeStats:       parseJson(m.home_team_stats_json),
      awayStats:       parseJson(m.away_team_stats_json),
      homePlayerStats: parseJson(m.home_player_stats_json),
      awayPlayerStats: parseJson(m.away_player_stats_json),
      dataSource:      m.data_source ?? "statshub",
      beHomeStats:     parseJson(m.be_home_stats_json),
      beAwayStats:     parseJson(m.be_away_stats_json),
      odds: {
        "1x2":  parseJson(m.po_1x2_json),
        "ou":   parseJson(m.po_ou_json),
        "ah":   parseJson(m.po_ah_json),
        "btts": parseJson(m.po_btts_json),
        "dc":   parseJson(m.po_dc_json),
        "dnb":  parseJson(m.po_dnb_json),
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
    dataSource:      "statshub",
    beHomeStats:     null,
    beAwayStats:     null,
    odds: {
      "1x2":  parseJson(m.odds_1x2_json),
      "ou":   parseJson(m.odds_ou_json),
      "ah":   parseJson(m.odds_ah_json),
      "btts": parseJson(m.odds_btts_json),
      "dc":   parseJson(m.odds_dc_json),
      "dnb":  parseJson(m.odds_dnb_json),
    },
    createdAt: m.created_at,
  });
});

/** GET /api/db/wizard — wizard analysis for a fixtures-tab match.
 *  Checks main processing DB first, then falls back to tester DB. */
router.get("/db/wizard", (req, res) => {
  const home = String(req.query["home"] ?? "").trim();
  const away = String(req.query["away"] ?? "").trim();
  const date = String(req.query["date"] ?? "").trim();
  if (!home || !away || !date) {
    res.status(400).json({ error: "home, away, date query params required" });
    return;
  }

  // Try main DB first, then tester DB
  const pm = getProcessingMatchByTeams(home, away, date);
  const tm = pm ? null : getTesterMatchByTeams(home, away, date);
  const m  = pm ?? tm;

  if (!m) {
    res.status(404).json({
      error: `No processed data found for "${home}" vs "${away}" on ${date}. Process this fixture in the Tester tab first to generate stats.`,
    });
    return;
  }

  try {
    const output = analyzeMatch({
      homeName:          m.home_team,
      awayName:          m.away_team,
      homeTeamStatsJson: m.home_team_stats_json,
      awayTeamStatsJson: m.away_team_stats_json,
      beHomeStatsJson:   (m as { be_home_stats_json?: string | null }).be_home_stats_json ?? null,
      beAwayStatsJson:   (m as { be_away_stats_json?: string | null }).be_away_stats_json ?? null,
    });
    res.json(output);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

/** DELETE /api/db/match/:id — remove a single stored match (processing matches not deletable via this route) */
router.delete("/db/match/:id", (req, res) => {
  const m = getMatch(req.params.id);
  if (!m) { res.status(404).json({ error: "Match not found" }); return; }
  deleteMatch(req.params.id);
  res.json({ deleted: true });
});

export default router;
