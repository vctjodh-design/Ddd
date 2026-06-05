/**
 * Bulk upload job runner.
 * Orchestrates: OddsPortal match list → StatsHub team stats → SQLite storage.
 */
import {
  getJob, updateJob, appendJobLog, insertMatch,
  createJob, type BulkJob,
} from "./db.js";
import { fetchMatchList, fetchMatchOdds, type OPMatch } from "./oddsPortal.js";
import { fetchStatsHubTeamHistory } from "./statsHub.js";
import { findTeamId, clearSearchCache } from "./statsHubSearch.js";
import { resetOddsContext } from "./browserScraper.js";

const MIN_MATCH_HISTORY = 20;

// In-memory set of running job IDs to avoid duplicate runs
const runningJobs = new Set<string>();

export interface StartJobParams {
  leagueName: string;
  countryName: string;
  oddsPortalPath: string;
  year: number;
}

export function startBulkJob(params: StartJobParams): BulkJob {
  const job = createJob({
    league_name:      params.leagueName,
    country_name:     params.countryName,
    odds_portal_path: params.oddsPortalPath,
    year:             params.year,
  });

  // Run async without blocking the HTTP response
  setImmediate(() => runJob(job.id, params));
  return job;
}

async function runJob(jobId: string, params: StartJobParams) {
  if (runningJobs.has(jobId)) return;
  runningJobs.add(jobId);

  const log = (msg: string) => {
    console.log(`[BulkJob ${jobId}]`, msg);
    appendJobLog(jobId, msg);
  };

  try {
    updateJob(jobId, { status: "running" });
    log(`Starting bulk upload: ${params.oddsPortalPath} ${params.year}`);
    clearSearchCache();

    // ── Stage 1: Fetch match list from OddsPortal ─────────────────────────
    let matches: OPMatch[] = [];
    try {
      matches = await fetchMatchList(
        params.oddsPortalPath,
        params.year,
        log
      );
    } catch (e) {
      log(`⚠ OddsPortal fetch failed: ${e}. Continuing without match list.`);
    }

    if (matches.length === 0) {
      log("No matches found from OddsPortal. Job complete with 0 stored.");
      updateJob(jobId, { status: "complete", total_matches: 0 });
      return;
    }

    updateJob(jobId, { total_matches: matches.length });
    log(`Total matches to process: ${matches.length}`);

    // ── Stage 2: Process each match ───────────────────────────────────────
    let processed = 0;
    let stored    = 0;
    let skipped   = 0;

    for (const match of matches) {
      processed++;
      const label = `${match.homeTeam} vs ${match.awayTeam} (${match.date})`;
      updateJob(jobId, {
        processed,
        stored,
        skipped,
        current_match: label,
      });
      log(`[${processed}/${matches.length}] ${label}`);

      // Lookup team IDs via StatsHub search (optional — missing IDs don't block odds)
      const [homeId, awayId] = await Promise.all([
        findTeamId(match.homeTeam),
        findTeamId(match.awayTeam),
      ]);

      if (!homeId || !awayId) {
        log(`  ↳ StatsHub: team IDs not found (home=${homeId}, away=${awayId}) — continuing without stats`);
      }

      // Fetch team history if IDs are available (optional enrichment)
      const matchTs = match.date ? Math.floor(new Date(match.date).getTime() / 1000) : undefined;
      const [homeStats, awayStats] = homeId && awayId
        ? await Promise.all([
            fetchStatsHubTeamHistory(homeId, matchTs),
            fetchStatsHubTeamHistory(awayId, matchTs),
          ])
        : [null, null];

      const homeMatches = homeStats?.statHistory?.[0]?.matches?.length ?? 0;
      const awayMatches = awayStats?.statHistory?.[0]?.matches?.length ?? 0;

      if (homeId && awayId) {
        if (homeMatches < MIN_MATCH_HISTORY || awayMatches < MIN_MATCH_HISTORY) {
          log(`  ↳ StatsHub: insufficient history (home=${homeMatches}, away=${awayMatches}, min=${MIN_MATCH_HISTORY}) — continuing without stats`);
        } else {
          log(`  ↳ StatsHub OK (home=${homeMatches}, away=${awayMatches})`);
        }
      }

      log(`  ↳ Fetching odds…`);

      // Fetch bookmaker odds from OddsPortal match page
      let matchOdds: Awaited<ReturnType<typeof fetchMatchOdds>> = {};
      try {
        matchOdds = await fetchMatchOdds(match, params.oddsPortalPath, log);
      } catch (e) {
        log(`  ↳ ⚠ Odds fetch error: ${e}`);
      }

      const oddsKeys: Array<[keyof typeof matchOdds, string]> = [
        ["1x2","odds_1x2_json"], ["ou","odds_ou_json"], ["ah","odds_ah_json"],
        ["btts","odds_btts_json"], ["dc","odds_dc_json"], ["eh","odds_eh_json"],
        ["dnb","odds_dnb_json"], ["cs","odds_cs_json"], ["htft","odds_htft_json"],
        ["oe","odds_oe_json"],
      ];

      const oddsJsonMap: Record<string, string | null> = {};
      for (const [key, dbCol] of oddsKeys) {
        const data = matchOdds[key];
        oddsJsonMap[dbCol] = data && (data as unknown[]).length > 0
          ? JSON.stringify(data)
          : null;
      }

      // Store in DB
      insertMatch({
        job_id:           jobId,
        league_name:      params.leagueName,
        country_name:     params.countryName,
        odds_portal_path: params.oddsPortalPath,
        year:             params.year,
        match_date:       match.date,
        home_team:        match.homeTeam,
        away_team:        match.awayTeam,
        home_score:       match.homeScore,
        away_score:       match.awayScore,
        home_team_id:     homeId,
        away_team_id:     awayId,
        home_stats_json:  homeStats ? JSON.stringify(homeStats) : null,
        away_stats_json:  awayStats ? JSON.stringify(awayStats) : null,
        odds_1x2_json:    oddsJsonMap["odds_1x2_json"] ?? null,
        odds_ou_json:     oddsJsonMap["odds_ou_json"] ?? null,
        odds_ah_json:     oddsJsonMap["odds_ah_json"] ?? null,
        odds_btts_json:   oddsJsonMap["odds_btts_json"] ?? null,
        odds_dc_json:     oddsJsonMap["odds_dc_json"] ?? null,
        odds_eh_json:     oddsJsonMap["odds_eh_json"] ?? null,
        odds_dnb_json:    oddsJsonMap["odds_dnb_json"] ?? null,
        odds_cs_json:     oddsJsonMap["odds_cs_json"] ?? null,
        odds_htft_json:   oddsJsonMap["odds_htft_json"] ?? null,
        odds_oe_json:     oddsJsonMap["odds_oe_json"] ?? null,
      });

      stored++;
      const oddsCount = Object.values(oddsJsonMap).filter(Boolean).length;
      log(`  ↳ ✓ Stored (odds markets: ${oddsCount}/10)`);

      // Polite rate limiting
      await new Promise(r => setTimeout(r, 800));
    }

    updateJob(jobId, {
      status:        "complete",
      processed,
      stored,
      skipped,
      current_match: null,
    });
    log(`✅ Job complete. Stored: ${stored}, Skipped: ${skipped}, Total: ${matches.length}`);

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log(`❌ Fatal error: ${msg}`);
    updateJob(jobId, { status: "failed", error_message: msg, current_match: null });
  } finally {
    runningJobs.delete(jobId);
    // Release the persistent browser context so cookies don't carry over between jobs
    await resetOddsContext().catch(() => {});
  }
}
