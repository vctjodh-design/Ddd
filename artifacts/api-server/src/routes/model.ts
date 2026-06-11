import { Router } from "express";
import { trainModel, predictMatch, predictByTeams, modelStatus } from "../lib/mlModel.js";
import { getProcessingMatchById, getDb } from "../lib/db.js";
import { fetchStatsHubTeamHistory } from "../lib/statsHub.js";
import { fetchPlayerStats } from "../lib/processingJob.js";
import { fetchBetExplorerMatches, fetchKeyMarketsLive, findBestBEMatch } from "../lib/betExplorer.js";

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

/**
 * Live prediction: scrape StatsHub + BetExplorer on-demand, then predict.
 * Checks the DB first (fast path). Falls back to live scraping if not found.
 */
router.post("/model/predict-live", async (req, res) => {
  const { homeTeamId, awayTeamId, homeTeam, awayTeam, kickoffTs } = req.body as {
    homeTeamId?: number; awayTeamId?: number;
    homeTeam?: string; awayTeam?: string; kickoffTs?: number;
  };
  if (!homeTeamId || !awayTeamId || !homeTeam || !awayTeam || !kickoffTs) {
    return void res.status(400).json({ error: "homeTeamId, awayTeamId, homeTeam, awayTeam, kickoffTs required" });
  }

  // Always scrape live — DB matches are training data only, not prediction source.
  // Live scrape — fetch team stats, player stats, and BetExplorer results in parallel
  try {
    const dateStr = new Date(kickoffTs * 1000).toISOString().slice(0, 10);
    const beLog = (msg: string) => console.log(msg);
    beLog(`[predict-live] ${homeTeam} vs ${awayTeam} — date=${dateStr} kickoffTs=${kickoffTs}`);
    const [homeStats, awayStats, homePlayers, awayPlayers, beMatches] = await Promise.allSettled([
      fetchStatsHubTeamHistory(homeTeamId, kickoffTs),
      fetchStatsHubTeamHistory(awayTeamId, kickoffTs),
      fetchPlayerStats(homeTeamId),
      fetchPlayerStats(awayTeamId),
      fetchBetExplorerMatches(dateStr, beLog),
    ]);

    const matchLike: Record<string, string | null> = {
      home_team_stats_json: homeStats.status === "fulfilled" && homeStats.value ? JSON.stringify(homeStats.value) : null,
      away_team_stats_json: awayStats.status === "fulfilled" && awayStats.value ? JSON.stringify(awayStats.value) : null,
      home_player_stats_json: homePlayers.status === "fulfilled" && homePlayers.value.length ? JSON.stringify(homePlayers.value) : null,
      away_player_stats_json: awayPlayers.status === "fulfilled" && awayPlayers.value.length ? JSON.stringify(awayPlayers.value) : null,
      po_1x2_json: null, po_btts_json: null, po_ou_json: null, po_dc_json: null,
    };

    // Try BetExplorer odds — fast concurrent fetch (no delays, no retry)
    if (beMatches.status === "fulfilled") {
      beLog(`[BetExplorer] Total matches fetched: ${beMatches.value.length}`);
      const beMatch = findBestBEMatch(homeTeam, awayTeam, beMatches.value);
      beLog(`[BetExplorer] Match lookup for "${homeTeam}" vs "${awayTeam}": ${beMatch ? `FOUND matchId=${beMatch.matchId}` : "NOT FOUND"}`);
      if (beMatch) {
        // Seed best 1x2 from results page immediately
        matchLike.po_1x2_json = JSON.stringify([{
          bookmaker: "best",
          odds: [beMatch.bestHomeOdds, beMatch.bestDrawOdds, beMatch.bestAwayOdds],
        }]);
        // Concurrently fetch per-bookmaker markets (no delays — may 429, that's OK)
        try {
          const markets = await fetchKeyMarketsLive(beMatch.matchId, beMatch.matchUrl);
          if (markets["1x2"]?.length) matchLike.po_1x2_json = JSON.stringify(markets["1x2"]);
          if (markets.btts?.length)    matchLike.po_btts_json = JSON.stringify(markets.btts);
          if (markets.ou?.length)      matchLike.po_ou_json   = JSON.stringify(markets.ou);
          if (markets.dc?.length)      matchLike.po_dc_json   = JSON.stringify(markets.dc);
        } catch { /* leave with results-page best odds */ }
      }
    }

    const prediction = predictMatch(matchLike as Parameters<typeof predictMatch>[0]);
    res.json({ ...prediction, source: "live" });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

/**
 * Live BE prediction: accepts pre-fetched BETeamStats + scrapes market odds on-demand.
 * Used for BetExplorer-only fixtures that have no StatsHub team IDs.
 */
router.post("/model/predict-be", async (req, res) => {
  const { homeTeam, awayTeam, matchId, matchUrl, kickoffTs, homeBeStats, awayBeStats } = req.body as {
    homeTeam?: string; awayTeam?: string;
    matchId?: string; matchUrl?: string; kickoffTs?: number;
    homeBeStats?: object; awayBeStats?: object;
  };
  if (!homeTeam || !awayTeam || !matchId || !matchUrl || !kickoffTs) {
    return void res.status(400).json({ error: "homeTeam, awayTeam, matchId, matchUrl, kickoffTs required" });
  }
  try {
    const beLog = (msg: string) => console.log(msg);
    beLog(`[predict-be] ${homeTeam} vs ${awayTeam} matchId=${matchId}`);

    const matchLike: Record<string, string | null> = {
      be_home_stats_json: homeBeStats ? JSON.stringify(homeBeStats) : null,
      be_away_stats_json: awayBeStats ? JSON.stringify(awayBeStats) : null,
      home_team_stats_json: null,
      away_team_stats_json: null,
      home_player_stats_json: null,
      away_player_stats_json: null,
      po_1x2_json: null, po_btts_json: null, po_ou_json: null, po_dc_json: null,
    };

    try {
      const markets = await fetchKeyMarketsLive(matchId, matchUrl);
      if (markets["1x2"]?.length) matchLike.po_1x2_json = JSON.stringify(markets["1x2"]);
      if (markets.btts?.length)   matchLike.po_btts_json = JSON.stringify(markets.btts);
      if (markets.ou?.length)     matchLike.po_ou_json   = JSON.stringify(markets.ou);
      if (markets.dc?.length)     matchLike.po_dc_json   = JSON.stringify(markets.dc);
    } catch (e) {
      beLog(`[predict-be] odds fetch error (using no odds): ${e}`);
    }

    const prediction = predictMatch(matchLike as Parameters<typeof predictMatch>[0]);
    res.json({ ...prediction, source: "be-live" });
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
