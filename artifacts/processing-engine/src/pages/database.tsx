import React, { useState, useEffect, useCallback, useMemo } from "react";
import { useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import {
  Activity, Database, ChevronLeft, ChevronRight,
  Trash2, RefreshCw, X, BarChart2, Shield, Users, LayoutList,
  Brain, Zap, Star, TrendingUp,
} from "lucide-react";

function apiUrl(path: string) {
  return `/api${path}`;
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface DbStats {
  matches: number;
  withStats: number;
  withOdds: number;
  leagues: { odds_portal_path: string; league_name: string; country_name: string }[];
}

interface MatchSummary {
  id: string;
  source: "stored" | "processing";
  leagueName: string;
  countryName: string;
  date: string;
  homeTeam: string;
  awayTeam: string;
  homeScore: number | null;
  awayScore: number | null;
  hasHomeStats: boolean;
  hasAwayStats: boolean;
  hasPlayer: boolean;
  hasOdds: boolean;
  dataSource?: string | null;
  createdAt: number;
}

interface MatchDetail {
  id: string;
  source: "stored" | "processing";
  leagueName: string;
  date: string;
  homeTeam: string;
  awayTeam: string;
  homeScore: number | null;
  awayScore: number | null;
  kickoffTs?: number | null;
  homeStats: unknown;
  awayStats: unknown;
  homePlayerStats: unknown;
  awayPlayerStats: unknown;
  dataSource?: string | null;
  beHomeStats?: unknown;
  beAwayStats?: unknown;
  odds: Record<string, unknown>;
}

// ── Prediction types ──────────────────────────────────────────────────────────

interface PredictionScore { home: number; away: number; prob: number; }

interface PredictionOutput {
  method: string;
  nSamples: number;
  accuracy1x2: number;
  accuracyBtts: number;
  trainedAt: number;
  featureQuality: "full" | "partial" | "minimal";
  lambdaHome: number;
  lambdaAway: number;
  onex2: { H: number; D: number; A: number };
  dc: { "1X": number; "12": number; X2: number };
  btts: { yes: number; no: number };
  corners: { predicted: number; stdDev: number; over85: number; over95: number; over105: number };
  correctScores: PredictionScore[];
  bestOdds: {
    onex2: { H: number | null; D: number | null; A: number | null };
    btts: { yes: number | null; no: number | null };
    dc: { "1X": number | null; "12": number | null; X2: number | null };
    ou: { over85: number | null; under85: number | null; over95: number | null; under95: number | null; over105: number | null; under105: number | null };
  };
  impliedProbs: {
    onex2: { H: number; D: number; A: number };
    btts: { yes: number; no: number };
    dc: { "1X": number; "12": number; X2: number };
  };
  valueBets: Array<{ market: string; outcome: string; modelProb: number; impliedProb: number; edge: number; bestOdds: number | null }>;
}

interface ModelStatus {
  trained: boolean;
  nSamples: number;
  accuracy1x2: number;
  accuracyBtts: number;
  trainedAt: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function apiFetch<T>(path: string, opts?: RequestInit): Promise<T> {
  const r = await fetch(apiUrl(path), opts);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json() as Promise<T>;
}

function dot(has: boolean) {
  return (
    <span className={`inline-block w-2 h-2 rounded-full ${has ? "bg-green-400" : "bg-border"}`} />
  );
}

// ── Analytics utilities ───────────────────────────────────────────────────────

function calcMean(vals: number[]): number {
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
}

function calcStdDev(vals: number[]): number {
  if (vals.length < 2) return 0;
  const m = calcMean(vals);
  return Math.sqrt(vals.reduce((a, b) => a + (b - m) ** 2, 0) / vals.length);
}

function calcConsistency(vals: number[]): number {
  if (vals.length === 0) return 0;
  if (vals.length === 1) return 100;
  const m = calcMean(vals);
  const sd = calcStdDev(vals);
  const cov = sd / (Math.abs(m) + 0.5);
  return Math.max(0, Math.min(100, (1 - cov) * 100));
}

const LOWER_IS_BETTER = new Set([
  "Fouls", "Yellow Cards", "Red Cards", "Cards",
  "Dispossessed", "Errors Lead To Shot", "Errors Lead To Goal", "Offsides",
  "Total Tackles", "Big Chance Missed",
]);

function consistencyColor(pct: number): string {
  if (pct >= 80) return "text-green-400";
  if (pct >= 60) return "text-lime-400";
  if (pct >= 40) return "text-yellow-400";
  if (pct >= 20) return "text-orange-400";
  return "text-red-400";
}

function consistencyBg(pct: number): string {
  if (pct >= 80) return "bg-green-400";
  if (pct >= 60) return "bg-lime-400";
  if (pct >= 40) return "bg-yellow-400";
  if (pct >= 20) return "bg-orange-400";
  return "bg-red-400";
}

// ── Team analytics types & computation ────────────────────────────────────────

interface SHMatchRow {
  date: string;
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
  myValue: number;
  opponentValue: number;
  result: "W" | "D" | "L";
}

interface SHStatHistory {
  key: string;
  label: string;
  matches: SHMatchRow[];
}

interface SHTeamStats {
  teamId: number;
  possession: number;
  statHistory: SHStatHistory[];
}

interface StatAnalytic {
  label: string;
  allAvg: number;
  last5Avg: number;
  consistency: number;
  matchCount: number;
  lowerIsBetter: boolean;
}

interface TeamAnalytic {
  form: Array<"W" | "D" | "L">;
  stats: StatAnalytic[];
}

function computeTeamAnalytic(teamStats: SHTeamStats | null): TeamAnalytic {
  const empty: TeamAnalytic = { form: [], stats: [] };
  if (!teamStats?.statHistory?.length) return empty;

  const form: Array<"W" | "D" | "L"> = [];
  const formSrc = teamStats.statHistory.find(s => s.matches.length > 0);
  if (formSrc) {
    formSrc.matches.slice(0, 5).forEach(m => form.push(m.result));
  }

  const stats: StatAnalytic[] = teamStats.statHistory.map(sh => {
    const vals = sh.matches.map(m => m.myValue);
    const last5 = vals.slice(0, 5);
    return {
      label: sh.label,
      allAvg: calcMean(vals),
      last5Avg: calcMean(last5),
      consistency: calcConsistency(vals),
      matchCount: vals.length,
      lowerIsBetter: LOWER_IS_BETTER.has(sh.label),
    };
  });

  return { form, stats };
}

// ── BetExplorer team stats panel ──────────────────────────────────────────────

interface BETeamStatsData {
  avgGoalsScored: number;
  avgGoalsConceded: number;
  avgGoalsScoredL5: number;
  avgGoalsConcededL5: number;
  form: Array<"W" | "D" | "L">;
  totalGames: number;
}

function BETeamStatsPanel({
  homeTeam, awayTeam, homeBeStats, awayBeStats,
}: {
  homeTeam: string;
  awayTeam: string;
  homeBeStats: BETeamStatsData | null;
  awayBeStats: BETeamStatsData | null;
}) {
  function TeamPanel({ team, stats }: { team: string; stats: BETeamStatsData | null }) {
    return (
      <div className="p-4 space-y-4">
        <div className="text-[9px] font-mono text-primary/60 uppercase tracking-widest border-b border-border/20 pb-2">
          {team}{stats ? ` · last ${stats.totalGames} games` : ""}
        </div>
        {!stats ? (
          <div className="text-[10px] font-mono text-muted-foreground/30 italic">No data available</div>
        ) : (
          <>
            <div className="space-y-3">
              {[
                { label: "Avg Goals Scored",   all: stats.avgGoalsScored,   l5: stats.avgGoalsScoredL5 },
                { label: "Avg Goals Conceded", all: stats.avgGoalsConceded, l5: stats.avgGoalsConcededL5 },
              ].map(({ label, all, l5 }) => (
                <div key={label} className="flex items-center gap-3">
                  <span className="text-[9px] font-mono text-muted-foreground/50 w-36 uppercase tracking-wide shrink-0">{label}</span>
                  <span className="text-[14px] font-mono font-bold text-foreground">{all.toFixed(2)}</span>
                  <span className="text-[9px] font-mono text-primary/50">L5: {l5.toFixed(2)}</span>
                </div>
              ))}
            </div>
            <div>
              <div className="text-[8px] font-mono text-muted-foreground/40 uppercase tracking-widest mb-1.5">
                Recent Form ({stats.form.length} games)
              </div>
              <div className="flex flex-wrap gap-1">
                {stats.form.slice(0, 15).map((r, i) => <ResultBadge key={i} r={r} />)}
              </div>
              <div className="mt-1.5 text-[9px] font-mono text-muted-foreground/40">
                <span className="text-green-400">{stats.form.filter(r => r === "W").length}W</span>
                <span className="mx-1 text-muted-foreground/20">·</span>
                <span className="text-yellow-400">{stats.form.filter(r => r === "D").length}D</span>
                <span className="mx-1 text-muted-foreground/20">·</span>
                <span className="text-red-400">{stats.form.filter(r => r === "L").length}L</span>
              </div>
            </div>
          </>
        )}
      </div>
    );
  }

  if (!homeBeStats && !awayBeStats) {
    return (
      <div className="flex items-center justify-center h-32 text-muted-foreground/40 text-xs font-mono">
        No BetExplorer team stats available for this match
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="text-[9px] font-mono text-muted-foreground/30 px-4 py-2 border-b border-border/20 bg-orange-500/3">
        <span className="text-orange-400/60">BE Source</span>
        <span className="ml-2">· Goals & form data sourced from BetExplorer team pages</span>
      </div>
      <div className="grid grid-cols-2 divide-x divide-border/30">
        <TeamPanel team={homeTeam} stats={homeBeStats} />
        <TeamPanel team={awayTeam} stats={awayBeStats} />
      </div>
    </div>
  );
}

// ── Odds types ────────────────────────────────────────────────────────────────

interface OddsEntry {
  bookmaker: string;
  odds: (number | null)[];
  line?: number;
}

const MARKET_COLS: Record<string, string[]> = {
  "1x2":  ["1",    "X",     "2"],
  "ou":   ["Over", "Under"],
  "ah":   ["1",    "2"],
  "dnb":  ["1",    "2"],
  "dc":   ["1X",   "12",    "X2"],
  "btts": ["Yes",  "No"],
};

// ── ResultBadge ───────────────────────────────────────────────────────────────

function ResultBadge({ r }: { r: "W" | "D" | "L" }) {
  const cls = r === "W"
    ? "bg-green-500/20 text-green-400 border-green-500/30"
    : r === "D"
    ? "bg-yellow-500/20 text-yellow-400 border-yellow-500/30"
    : "bg-red-500/20 text-red-400 border-red-500/30";
  return (
    <span className={`inline-flex items-center justify-center w-5 h-5 text-[9px] font-bold border font-mono ${cls}`}>
      {r}
    </span>
  );
}

// ── FormBar ───────────────────────────────────────────────────────────────────

function FormBar({ form, teamName }: { form: Array<"W"|"D"|"L">; teamName: string }) {
  const W = form.filter(r => r === "W").length;
  const D = form.filter(r => r === "D").length;
  const L = form.filter(r => r === "L").length;
  return (
    <div className="flex flex-col gap-1 py-3 px-4">
      <div className="text-[9px] font-mono text-muted-foreground/50 uppercase tracking-widest truncate mb-1">
        {teamName} · last {form.length || 5}
      </div>
      {form.length > 0 ? (
        <>
          <div className="flex gap-1">
            {form.map((r, i) => <ResultBadge key={i} r={r} />)}
          </div>
          <div className="text-[9px] font-mono text-muted-foreground/40 mt-0.5">
            <span className="text-green-400">{W}W</span>
            <span className="mx-1 text-muted-foreground/20">·</span>
            <span className="text-yellow-400">{D}D</span>
            <span className="mx-1 text-muted-foreground/20">·</span>
            <span className="text-red-400">{L}L</span>
          </div>
        </>
      ) : (
        <div className="text-[9px] font-mono text-muted-foreground/25 italic">No form data</div>
      )}
    </div>
  );
}

// ── StatComparisonTable ────────────────────────────────────────────────────────

interface StatDetailProps {
  homeStats: SHTeamStats | null;
  awayStats: SHTeamStats | null;
  label: string;
  homeTeam: string;
  awayTeam: string;
}

function StatDetailSection({ homeStats, awayStats, label, homeTeam, awayTeam }: StatDetailProps) {
  const homeStat = homeStats?.statHistory.find(s => s.label === label);
  const awayStat = awayStats?.statHistory.find(s => s.label === label);

  function MatchHistory({ hist, teamName }: { hist: SHStatHistory | undefined; teamName: string }) {
    if (!hist?.matches.length) return (
      <div className="text-[9px] font-mono text-muted-foreground/30 italic p-2">No data</div>
    );
    return (
      <div>
        <div className="text-[9px] font-mono text-muted-foreground/40 uppercase tracking-widest px-2 py-1 border-b border-border/20">
          {teamName}
        </div>
        <div className="overflow-y-auto max-h-40">
          <table className="w-full text-[9px] font-mono">
            <thead className="sticky top-0 bg-card/90">
              <tr className="border-b border-border/20">
                <th className="text-left px-2 py-1 text-muted-foreground/40 font-normal">Date</th>
                <th className="text-left px-2 py-1 text-muted-foreground/40 font-normal">vs</th>
                <th className="text-center px-1 py-1 text-muted-foreground/40 font-normal">Sc</th>
                <th className="text-center px-1 py-1 text-muted-foreground/40 font-normal">R</th>
                <th className="text-center px-1 py-1 text-primary/50 font-normal">Val</th>
              </tr>
            </thead>
            <tbody>
              {hist.matches.map((m, i) => {
                const isHome = m.homeTeam === teamName;
                const opp = isHome ? m.awayTeam : m.homeTeam;
                return (
                  <tr key={i} className="border-b border-border/10 hover:bg-white/[0.02]">
                    <td className="px-2 py-1 text-muted-foreground/40">{m.date}</td>
                    <td className="px-2 py-1 text-foreground/50 truncate max-w-[80px]">{opp}</td>
                    <td className="px-1 py-1 text-center text-muted-foreground/40">{m.homeScore}–{m.awayScore}</td>
                    <td className="px-1 py-1 text-center"><ResultBadge r={m.result} /></td>
                    <td className="px-1 py-1 text-center text-primary font-bold">
                      {m.myValue % 1 === 0 ? m.myValue : m.myValue.toFixed(2)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  return (
    <div className="border-t border-primary/20 bg-primary/3 mt-0">
      <div className="text-[9px] font-mono text-primary/60 uppercase tracking-widest px-4 py-1.5 border-b border-border/20">
        {label} — match history
      </div>
      <div className="grid grid-cols-2 divide-x divide-border/20">
        <MatchHistory hist={homeStat} teamName={homeTeam} />
        <MatchHistory hist={awayStat} teamName={awayTeam} />
      </div>
    </div>
  );
}

function StatComparisonTable({
  homeTeam, awayTeam, homeStats, awayStats, homeAnalytic, awayAnalytic,
}: {
  homeTeam: string;
  awayTeam: string;
  homeStats: SHTeamStats | null;
  awayStats: SHTeamStats | null;
  homeAnalytic: TeamAnalytic;
  awayAnalytic: TeamAnalytic;
}) {
  const [selectedStat, setSelectedStat] = useState<string | null>(null);

  const allLabels = useMemo(() => Array.from(new Set([
    ...homeAnalytic.stats.map(s => s.label),
    ...awayAnalytic.stats.map(s => s.label),
  ])), [homeAnalytic, awayAnalytic]);

  if (!allLabels.length) {
    return (
      <div className="flex items-center justify-center h-32 text-muted-foreground/40 text-xs font-mono">
        No team stats stored for this match
      </div>
    );
  }

  function ConsistencyCell({ pct, matchCount }: { pct: number; matchCount: number }) {
    if (matchCount === 0) return <td className="px-2 py-2 text-center text-muted-foreground/20 text-[9px]">—</td>;
    return (
      <td className="px-2 py-2">
        <div className="flex items-center gap-1.5">
          <div className="w-12 h-1.5 bg-border/20 rounded-full overflow-hidden flex-shrink-0">
            <div
              className={`h-full rounded-full ${consistencyBg(pct)}`}
              style={{ width: `${pct}%`, opacity: 0.7 }}
            />
          </div>
          <span className={`text-[9px] font-mono tabular-nums ${consistencyColor(pct)}`}>
            {pct.toFixed(0)}%
          </span>
        </div>
      </td>
    );
  }

  function AvgCell({ analytic, side }: { analytic: StatAnalytic | undefined; side: "home" | "away" }) {
    if (!analytic || analytic.matchCount === 0) {
      return <td className="px-2 py-2 text-center text-muted-foreground/20 text-[9px]">—</td>;
    }
    const align = side === "home" ? "text-right" : "text-left";
    return (
      <td className={`px-2 py-2 ${align}`}>
        <div className={`flex flex-col ${side === "home" ? "items-end" : "items-start"}`}>
          <span className="text-[10px] font-mono font-bold text-foreground/80 tabular-nums">
            {analytic.allAvg % 1 === 0 ? analytic.allAvg.toFixed(0) : analytic.allAvg.toFixed(2)}
            {analytic.matchCount >= 5 && (
              <span className="ml-1 text-primary/50 font-normal text-[8px]">
                L5:{analytic.last5Avg % 1 === 0 ? analytic.last5Avg.toFixed(0) : analytic.last5Avg.toFixed(2)}
              </span>
            )}
          </span>
          <span className="text-[8px] font-mono text-muted-foreground/30">{analytic.matchCount}m</span>
        </div>
      </td>
    );
  }

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* Form row */}
      <div className="grid grid-cols-2 divide-x divide-border/30 border-b border-border/30 flex-shrink-0">
        <FormBar form={homeAnalytic.form} teamName={homeTeam} />
        <FormBar form={awayAnalytic.form} teamName={awayTeam} />
      </div>

      {/* Comparison table */}
      <div className="flex-1 overflow-y-auto">
        <table className="w-full text-[10px] font-mono border-collapse">
          <thead className="sticky top-0 bg-[#0a0f1a]/95 z-10">
            <tr className="border-b border-border/30">
              <th className="text-right px-2 py-2 text-muted-foreground/40 font-normal w-1/4">
                <span className="text-primary/60">← {homeTeam.split(" ").pop()}</span>
              </th>
              <th className="text-right px-2 py-2 text-muted-foreground/25 font-normal w-[80px]">
                Cons%
              </th>
              <th className="text-center px-2 py-2 text-muted-foreground/50 font-normal text-[9px] uppercase tracking-wider">
                Stat
              </th>
              <th className="text-left px-2 py-2 text-muted-foreground/25 font-normal w-[80px]">
                Cons%
              </th>
              <th className="text-left px-2 py-2 text-muted-foreground/40 font-normal w-1/4">
                <span className="text-primary/60">{awayTeam.split(" ").pop()} →</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {allLabels.map(label => {
              const home = homeAnalytic.stats.find(s => s.label === label);
              const away = awayAnalytic.stats.find(s => s.label === label);
              const lowerIsBetter = home?.lowerIsBetter || away?.lowerIsBetter || LOWER_IS_BETTER.has(label);
              const isSelected = selectedStat === label;

              let homeEdge = false;
              let awayEdge = false;
              if (home && away && home.matchCount > 0 && away.matchCount > 0) {
                if (lowerIsBetter) {
                  homeEdge = home.allAvg < away.allAvg;
                  awayEdge = away.allAvg < home.allAvg;
                } else {
                  homeEdge = home.allAvg > away.allAvg;
                  awayEdge = away.allAvg > home.allAvg;
                }
              }

              return (
                <React.Fragment key={label}>
                  <tr
                    onClick={() => setSelectedStat(isSelected ? null : label)}
                    className={`border-b border-border/15 cursor-pointer transition-colors ${
                      isSelected
                        ? "bg-primary/8 border-primary/20"
                        : "hover:bg-white/[0.02]"
                    }`}
                  >
                    <AvgCell analytic={home} side="home" />
                    <ConsistencyCell pct={home?.consistency ?? 0} matchCount={home?.matchCount ?? 0} />
                    <td className="px-2 py-2 text-center">
                      <span className={`text-[9px] uppercase tracking-wide ${
                        isSelected ? "text-primary" : "text-muted-foreground/50"
                      }`}>
                        {label}
                      </span>
                      {lowerIsBetter && (
                        <span className="ml-1 text-[7px] text-muted-foreground/25">↓</span>
                      )}
                    </td>
                    <ConsistencyCell pct={away?.consistency ?? 0} matchCount={away?.matchCount ?? 0} />
                    <AvgCell analytic={away} side="away" />
                  </tr>
                  {isSelected && (
                    <tr>
                      <td colSpan={5} className="p-0">
                        <StatDetailSection
                          homeStats={homeStats}
                          awayStats={awayStats}
                          label={label}
                          homeTeam={homeTeam}
                          awayTeam={awayTeam}
                        />
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Player analytics ──────────────────────────────────────────────────────────

interface ParsedPlayer {
  playerId: number; name: string; jerseyNo: number; position: string;
  isSubstitute: boolean; minutesPlayed: number; rating: number;
  goals: number; assists: number; shots: number; shotsOnTarget: number;
  passes: number; accuratePasses: number; tackles: number;
  interceptions: number; fouls: number; yellowCard: boolean; redCard: boolean;
  saves: number; xG: number; xA: number;
}

interface PlayerGame {
  eventId: number; date: number;
  homeTeam: string; awayTeam: string;
  homeScore: number; awayScore: number;
  isHome: boolean;
  players: ParsedPlayer[];
}

interface PlayerSummary {
  playerId: number; name: string; jerseyNo: number; position: string;
  isSubstitute: boolean;
  gamesPlayed: number;
  avgMinutes: number;
  avgRating: number; ratingConsistency: number;
  avgGoals: number; avgAssists: number;
  avgShots: number; avgXG: number; avgXA: number;
  avgTackles: number; avgInterceptions: number; avgFouls: number;
  avgPasses: number; avgSaves: number;
  avgYellowCards: number; avgRedCards: number;
}

type PosGroup = "GK" | "DEF" | "MID" | "FWD";

function classifyPos(pos: string): PosGroup {
  if (!pos) return "MID";
  const p = pos.toUpperCase().trim();
  if (["G", "GK", "GOALKEEPER"].includes(p)) return "GK";
  if (["D", "CB", "LB", "RB", "WB", "LWB", "RWB", "DEF", "DEFENDER"].includes(p) ||
      (p.startsWith("D") && p.length <= 3)) return "DEF";
  if (["F", "ST", "CF", "LW", "RW", "SS", "FWD", "FORWARD", "ATT", "W"].includes(p) ||
      (p.startsWith("F") && p.length <= 3)) return "FWD";
  return "MID";
}

const POS_ORDER: PosGroup[] = ["GK", "DEF", "MID", "FWD"];
const POS_LABELS: Record<PosGroup, string> = { GK: "Goalkeepers", DEF: "Defenders", MID: "Midfielders", FWD: "Forwards" };

function aggregatePlayers(games: PlayerGame[], kickoffTs: number | null): PlayerSummary[] {
  const filtered = kickoffTs != null
    ? games.filter(g => g.date < kickoffTs)
    : games;

  const map = new Map<number, {
    info: { name: string; jerseyNo: number; position: string; isSubstitute: boolean };
    appearances: number;
    mins: number[];
    ratings: number[];
    goals: number; assists: number; shots: number; xG: number; xA: number;
    tackles: number; interceptions: number; fouls: number;
    passes: number; saves: number; yellowCards: number; redCards: number;
  }>();

  for (const game of filtered) {
    for (const p of game.players) {
      if (!map.has(p.playerId)) {
        map.set(p.playerId, {
          info: { name: p.name, jerseyNo: p.jerseyNo, position: p.position, isSubstitute: p.isSubstitute },
          appearances: 0, mins: [], ratings: [],
          goals: 0, assists: 0, shots: 0, xG: 0, xA: 0,
          tackles: 0, interceptions: 0, fouls: 0, passes: 0, saves: 0,
          yellowCards: 0, redCards: 0,
        });
      }
      const e = map.get(p.playerId)!;
      e.appearances++;
      if (p.minutesPlayed > 0) e.mins.push(p.minutesPlayed);
      if (p.rating > 0) e.ratings.push(p.rating);
      e.goals += p.goals || 0;
      e.assists += p.assists || 0;
      e.shots += p.shots || 0;
      e.xG += p.xG || 0;
      e.xA += p.xA || 0;
      e.tackles += p.tackles || 0;
      e.interceptions += p.interceptions || 0;
      e.fouls += p.fouls || 0;
      e.passes += p.passes || 0;
      e.saves += p.saves || 0;
      e.yellowCards += p.yellowCard ? 1 : 0;
      e.redCards += p.redCard ? 1 : 0;
    }
  }

  const results: PlayerSummary[] = [];
  for (const [pid, e] of map) {
    const n = e.appearances;
    if (n === 0) continue;
    results.push({
      playerId: pid,
      name: e.info.name,
      jerseyNo: e.info.jerseyNo,
      position: e.info.position,
      isSubstitute: e.info.isSubstitute,
      gamesPlayed: n,
      avgMinutes: e.mins.length ? calcMean(e.mins) : 0,
      avgRating: e.ratings.length ? calcMean(e.ratings) : 0,
      ratingConsistency: calcConsistency(e.ratings),
      avgGoals: e.goals / n,
      avgAssists: e.assists / n,
      avgShots: e.shots / n,
      avgXG: e.xG / n,
      avgXA: e.xA / n,
      avgTackles: e.tackles / n,
      avgInterceptions: e.interceptions / n,
      avgFouls: e.fouls / n,
      avgPasses: e.passes / n,
      avgSaves: e.saves / n,
      avgYellowCards: e.yellowCards / n,
      avgRedCards: e.redCards / n,
    });
  }

  return results.sort((a, b) => {
    const pa = POS_ORDER.indexOf(classifyPos(a.position));
    const pb = POS_ORDER.indexOf(classifyPos(b.position));
    if (pa !== pb) return pa - pb;
    return (b.avgRating || 0) - (a.avgRating || 0);
  });
}

function playerRating(s: PlayerSummary): { rating: "STRONG"|"MIXED"|"WEAK"|"LIMITED"; color: string } {
  if (s.gamesPlayed < 2) return { rating: "LIMITED", color: "text-muted-foreground/40" };
  const pos = classifyPos(s.position);
  const avgMins = s.avgMinutes || 90;
  const p90 = (total: number) => (total / (avgMins * s.gamesPlayed)) * 90;

  let strengths = 0;
  let weaknesses = 0;

  if (pos === "GK") {
    if (s.avgRating >= 7.2) strengths++;
    else if (s.avgRating < 6.5 && s.avgRating > 0) weaknesses++;
    if (s.avgYellowCards > 0.3) weaknesses++;
    if (s.ratingConsistency >= 75) strengths++;
  } else if (pos === "DEF") {
    const p90Tackles = p90(s.avgTackles * s.gamesPlayed);
    const p90Fouls = p90(s.avgFouls * s.gamesPlayed);
    if (p90Tackles >= 2.5) strengths++;
    else if (p90Tackles < 0.8 && s.gamesPlayed >= 3) weaknesses++;
    if (p90Fouls >= 2.5) weaknesses++;
    else if (p90Fouls < 0.8 && s.gamesPlayed >= 3) strengths++;
    if (s.avgYellowCards > 0.35) weaknesses++;
    else if (s.avgYellowCards < 0.08 && s.gamesPlayed >= 4) strengths++;
    if (s.ratingConsistency >= 75) strengths++;
  } else if (pos === "MID") {
    const p90Passes = p90(s.avgPasses * s.gamesPlayed);
    const p90Tackles = p90(s.avgTackles * s.gamesPlayed);
    const p90Fouls = p90(s.avgFouls * s.gamesPlayed);
    if (p90Passes >= 55) strengths++;
    else if (p90Passes < 25 && s.gamesPlayed >= 3) weaknesses++;
    if (p90Tackles >= 2.0) strengths++;
    if (p90Fouls >= 2.5) weaknesses++;
    else if (p90Fouls < 0.8 && s.gamesPlayed >= 3) strengths++;
    if (s.avgYellowCards > 0.3) weaknesses++;
    if (s.ratingConsistency >= 75) strengths++;
  } else {
    const p90Shots = p90(s.avgShots * s.gamesPlayed);
    if (p90Shots >= 3.5) strengths++;
    else if (p90Shots < 1.0 && s.gamesPlayed >= 3) weaknesses++;
    if (s.avgGoals > 0.4) strengths++;
    else if (s.avgGoals < 0.1 && s.gamesPlayed >= 4) weaknesses++;
    if (s.avgXG > 0.3) strengths++;
    else if (s.avgXG < 0.05 && s.gamesPlayed >= 4) weaknesses++;
    if (s.ratingConsistency >= 75) strengths++;
  }

  const rating =
    strengths >= 2 && weaknesses === 0 ? "STRONG" :
    weaknesses >= 2 && strengths === 0 ? "WEAK" :
    (strengths === 0 && weaknesses === 0) ? "LIMITED" :
    "MIXED";

  const color =
    rating === "STRONG" ? "text-green-400" :
    rating === "WEAK" ? "text-red-400" :
    rating === "MIXED" ? "text-yellow-400" :
    "text-muted-foreground/40";

  return { rating, color };
}

function PlayerSummaryTable({ teamName, summaries, gamesTotal }: {
  teamName: string;
  summaries: PlayerSummary[];
  gamesTotal: number;
}) {
  const byPos = useMemo(() => {
    const groups: Partial<Record<PosGroup, PlayerSummary[]>> = {};
    for (const s of summaries) {
      const pos = classifyPos(s.position);
      if (!groups[pos]) groups[pos] = [];
      groups[pos]!.push(s);
    }
    return groups;
  }, [summaries]);

  if (!summaries.length) return (
    <div className="flex items-center justify-center h-24 text-muted-foreground/30 text-xs font-mono">
      No player history data
    </div>
  );

  return (
    <div>
      <div className="text-[9px] font-mono text-primary/60 uppercase tracking-widest px-3 py-1.5 border-b border-border/20">
        {teamName}
        <span className="ml-2 text-muted-foreground/30">· {gamesTotal} games in history</span>
      </div>
      <table className="w-full text-[9px] font-mono">
        <thead className="sticky top-0 bg-[#0a0f1a]/95 z-10">
          <tr className="border-b border-border/25">
            <th className="text-left px-2 py-1.5 text-muted-foreground/35 font-normal">#</th>
            <th className="text-left px-2 py-1.5 text-muted-foreground/35 font-normal">Name</th>
            <th className="text-center px-1 py-1.5 text-muted-foreground/35 font-normal">Apps</th>
            <th className="text-center px-1 py-1.5 text-muted-foreground/35 font-normal">Min</th>
            <th className="text-center px-1 py-1.5 text-primary/40 font-normal">Rtg</th>
            <th className="text-center px-1 py-1.5 text-muted-foreground/25 font-normal" title="Rating consistency">Con%</th>
            <th className="text-center px-1 py-1.5 text-muted-foreground/35 font-normal">G</th>
            <th className="text-center px-1 py-1.5 text-muted-foreground/35 font-normal">A</th>
            <th className="text-center px-1 py-1.5 text-muted-foreground/35 font-normal">Sh</th>
            <th className="text-center px-1 py-1.5 text-muted-foreground/35 font-normal">xG</th>
            <th className="text-center px-1 py-1.5 text-muted-foreground/35 font-normal">Tkl</th>
            <th className="text-center px-1 py-1.5 text-muted-foreground/35 font-normal">Fls</th>
            <th className="text-center px-1 py-1.5 text-muted-foreground/35 font-normal">Rating</th>
          </tr>
        </thead>
        <tbody>
          {POS_ORDER.filter(pos => byPos[pos]?.length).map(pos => (
            <React.Fragment key={pos}>
              <tr className="bg-card/30">
                <td colSpan={13} className="px-2 py-1 text-[8px] font-mono text-muted-foreground/30 uppercase tracking-widest border-b border-border/15">
                  {POS_LABELS[pos]}
                </td>
              </tr>
              {byPos[pos]!.map(s => {
                const { rating, color } = playerRating(s);
                const fmt1 = (v: number) => v > 0 ? v.toFixed(1) : "—";
                const fmt2 = (v: number) => v > 0 ? v.toFixed(2) : "—";
                return (
                  <tr key={s.playerId} className={`border-b border-border/10 hover:bg-white/[0.02] ${s.isSubstitute ? "opacity-60" : ""}`}>
                    <td className="px-2 py-1.5 text-muted-foreground/30">{s.jerseyNo || "—"}</td>
                    <td className="px-2 py-1.5 text-foreground/70 max-w-[90px] truncate">{s.name}</td>
                    <td className="px-1 py-1.5 text-center text-muted-foreground/50">{s.gamesPlayed}/{gamesTotal}</td>
                    <td className="px-1 py-1.5 text-center text-muted-foreground/40">{s.avgMinutes > 0 ? s.avgMinutes.toFixed(0) : "—"}′</td>
                    <td className="px-1 py-1.5 text-center text-primary font-bold">
                      {s.avgRating > 0 ? s.avgRating.toFixed(1) : "—"}
                    </td>
                    <td className="px-1 py-1.5 text-center">
                      {s.gamesPlayed >= 2 ? (
                        <span className={`${consistencyColor(s.ratingConsistency)}`}>
                          {s.ratingConsistency.toFixed(0)}%
                        </span>
                      ) : <span className="text-muted-foreground/20">—</span>}
                    </td>
                    <td className="px-1 py-1.5 text-center text-green-400/70">{fmt2(s.avgGoals)}</td>
                    <td className="px-1 py-1.5 text-center text-blue-400/70">{fmt2(s.avgAssists)}</td>
                    <td className="px-1 py-1.5 text-center text-muted-foreground/50">{fmt1(s.avgShots)}</td>
                    <td className="px-1 py-1.5 text-center text-muted-foreground/50">{fmt2(s.avgXG)}</td>
                    <td className="px-1 py-1.5 text-center text-muted-foreground/50">{fmt1(s.avgTackles)}</td>
                    <td className="px-1 py-1.5 text-center text-muted-foreground/50">{fmt1(s.avgFouls)}</td>
                    <td className={`px-1 py-1.5 text-center font-bold text-[8px] ${color}`}>{rating}</td>
                  </tr>
                );
              })}
            </React.Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PlayerPerGamePanel({ teamName, playerStats }: { teamName: string; playerStats: PlayerGame[] | null }) {
  const [gameIdx, setGameIdx] = useState(0);

  if (!playerStats || playerStats.length === 0) {
    return (
      <div className="flex items-center justify-center h-32 text-muted-foreground/40 text-xs font-mono">
        No player data
      </div>
    );
  }

  const game = playerStats[gameIdx];
  const starters = game.players.filter(p => !p.isSubstitute);
  const subs     = game.players.filter(p => p.isSubstitute);
  const d = new Date(game.date * 1000);
  const dateStr = `${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")}/${d.getFullYear()}`;
  const opp = game.isHome ? game.awayTeam : game.homeTeam;

  return (
    <div>
      <div className="text-[9px] font-mono font-bold text-primary/60 tracking-widest uppercase mb-2 truncate px-2">
        {teamName}
      </div>
      <div className="flex items-center gap-1 mb-2 overflow-x-auto px-2">
        {playerStats.map((g, i) => {
          const gd = new Date(g.date * 1000);
          return (
            <button
              key={g.eventId}
              onClick={() => setGameIdx(i)}
              className={`flex-shrink-0 px-2 py-1 text-[8px] font-mono border transition-all ${
                i === gameIdx ? "border-primary bg-primary/10 text-primary" : "border-border/40 text-muted-foreground hover:text-foreground"
              }`}
            >
              {String(gd.getDate()).padStart(2,"0")}/{String(gd.getMonth()+1).padStart(2,"0")}
            </button>
          );
        })}
      </div>
      <div className="text-[8px] font-mono text-muted-foreground/40 mb-2 px-2">
        vs {opp} · {dateStr} · {game.homeScore}–{game.awayScore}
      </div>
      <div className="overflow-y-auto max-h-52 border border-border/30">
        <table className="w-full text-[9px] font-mono">
          <thead className="sticky top-0 bg-card/90">
            <tr className="border-b border-border/30">
              <th className="text-left px-2 py-1 text-muted-foreground/40 font-normal">#</th>
              <th className="text-left px-2 py-1 text-muted-foreground/40 font-normal">Name</th>
              <th className="text-center px-1 py-1 text-muted-foreground/40 font-normal">Min</th>
              <th className="text-center px-1 py-1 text-primary/50 font-normal">Rtg</th>
              <th className="text-center px-1 py-1 text-muted-foreground/40 font-normal">G</th>
              <th className="text-center px-1 py-1 text-muted-foreground/40 font-normal">A</th>
              <th className="text-center px-1 py-1 text-muted-foreground/40 font-normal">Sh</th>
              <th className="text-center px-1 py-1 text-muted-foreground/40 font-normal">xG</th>
              <th className="text-center px-1 py-1 text-muted-foreground/40 font-normal">Tkl</th>
              <th className="text-center px-1 py-1 text-muted-foreground/40 font-normal">Cd</th>
            </tr>
          </thead>
          <tbody>
            {[...starters, ...subs].map((p, i) => (
              <tr key={p.playerId} className={`border-b border-border/10 hover:bg-white/[0.02] ${p.isSubstitute ? "opacity-50" : ""}`}>
                <td className="px-2 py-1 text-muted-foreground/30">{p.jerseyNo || i+1}</td>
                <td className="px-2 py-1 text-foreground/70 max-w-[80px] truncate">{p.name}</td>
                <td className="px-1 py-1 text-center text-muted-foreground/50">{p.minutesPlayed || "—"}</td>
                <td className="px-1 py-1 text-center text-primary font-bold">
                  {p.rating > 0 ? p.rating.toFixed(1) : "—"}
                </td>
                <td className="px-1 py-1 text-center text-green-400/70">{p.goals || "—"}</td>
                <td className="px-1 py-1 text-center text-blue-400/70">{p.assists || "—"}</td>
                <td className="px-1 py-1 text-center text-muted-foreground/50">{p.shots || "—"}</td>
                <td className="px-1 py-1 text-center text-muted-foreground/50">{p.xG > 0 ? p.xG.toFixed(2) : "—"}</td>
                <td className="px-1 py-1 text-center text-muted-foreground/50">{p.tackles || "—"}</td>
                <td className="px-1 py-1 text-center">
                  {p.redCard ? <span className="text-red-500">●</span>
                    : p.yellowCard ? <span className="text-yellow-400">●</span>
                    : <span className="text-muted-foreground/20">—</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Prediction Panel ──────────────────────────────────────────────────────────

function PredictionPanel({ matchId }: { matchId: string }) {
  const [prediction, setPrediction] = useState<PredictionOutput | null>(null);
  const [modelSt, setModelSt] = useState<ModelStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [training, setTraining] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<ModelStatus>("/model/status").then(setModelSt).catch(() => {});
  }, []);

  const runPrediction = async () => {
    setLoading(true); setError(null);
    try {
      const r = await apiFetch<PredictionOutput>("/model/predict", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ matchId }),
      });
      setPrediction(r);
    } catch { setError("Prediction failed"); }
    finally { setLoading(false); }
  };

  const handleTrain = async () => {
    setTraining(true);
    try {
      await apiFetch("/model/train", { method: "POST" });
      const s = await apiFetch<ModelStatus>("/model/status");
      setModelSt(s);
    } catch {} finally { setTraining(false); }
  };

  function ProbRow({ label, modelProb, impliedProb, bestOddsVal, isValue }: {
    label: string; modelProb: number; impliedProb: number;
    bestOddsVal: number | null; isValue: boolean;
  }) {
    const pct = Math.round(modelProb * 100);
    const impPct = Math.round(impliedProb * 100);
    const edgePct = Math.round((modelProb - impliedProb) * 100);
    return (
      <div className={`px-4 py-2 flex items-center gap-3 ${isValue ? "bg-green-500/5 border-l-2 border-green-500/50" : ""}`}>
        <div className="w-16 text-[10px] font-mono text-foreground/80 shrink-0">{label}</div>
        <div className="flex-1 relative h-3.5 bg-white/5 overflow-hidden rounded-sm">
          <div
            className={`absolute left-0 top-0 h-full ${isValue ? "bg-green-500/50" : "bg-primary/40"}`}
            style={{ width: `${pct}%` }}
          />
        </div>
        <div className="w-8 text-[10px] font-mono font-bold tabular-nums text-right">{pct}%</div>
        <div className="w-10 text-[10px] font-mono text-primary/70 tabular-nums text-right">
          {bestOddsVal !== null ? bestOddsVal.toFixed(2) : <span className="text-muted-foreground/30">—</span>}
        </div>
        <div className="w-10 text-[9px] font-mono tabular-nums text-muted-foreground/40 text-right">{impPct}%</div>
        <div className={`w-12 text-[9px] font-mono tabular-nums text-right font-bold ${edgePct > 0 ? "text-green-400" : edgePct < -5 ? "text-red-400/50" : "text-muted-foreground/30"}`}>
          {edgePct > 0 ? "+" : ""}{edgePct}%
        </div>
        <div className="w-3.5">{isValue && <Star className="w-3 h-3 text-yellow-400" />}</div>
      </div>
    );
  }

  if (!prediction) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-5 p-6">
        {modelSt && (
          <div className="text-center space-y-1">
            {modelSt.trained ? (
              <div className="text-[10px] font-mono text-green-400/70">
                ✓ Model trained · {modelSt.nSamples} samples · 1X2: {modelSt.accuracy1x2}% · BTTS: {modelSt.accuracyBtts}%
              </div>
            ) : (
              <div className="text-[10px] font-mono text-yellow-400/60">
                No ML model trained · statistical predictions (Poisson) will be used
              </div>
            )}
          </div>
        )}
        <div className="flex gap-2">
          <button
            onClick={runPrediction}
            disabled={loading}
            className="flex items-center gap-2 px-5 py-2.5 text-[10px] font-mono uppercase tracking-widest border border-primary/60 text-primary hover:bg-primary/10 transition-all disabled:opacity-50"
          >
            <Zap className={`w-3.5 h-3.5 ${loading ? "animate-pulse" : ""}`} />
            {loading ? "Running…" : "Run Prediction"}
          </button>
          <button
            onClick={handleTrain}
            disabled={training}
            className="flex items-center gap-2 px-4 py-2.5 text-[10px] font-mono uppercase tracking-widest border border-border/40 text-muted-foreground hover:border-primary/30 hover:text-foreground transition-all disabled:opacity-50"
          >
            <Brain className={`w-3.5 h-3.5 ${training ? "animate-pulse" : ""}`} />
            {training ? "Training…" : modelSt?.trained ? "Retrain Model" : "Train Model"}
          </button>
        </div>
        {error && <div className="text-[10px] font-mono text-destructive">{error}</div>}
        <div className="text-[9px] font-mono text-muted-foreground/30 text-center max-w-xs">
          Predictions use Poisson distribution + Random Forest ensemble trained on all stored match data
        </div>
      </div>
    );
  }

  const isVal = (m: string, o: string) => prediction.valueBets.some(v => v.market === m && v.outcome === o);

  return (
    <div className="flex-1 overflow-y-auto">
      {/* Model info bar */}
      <div className="px-4 py-2 border-b border-border/30 flex items-center justify-between text-[9px] font-mono">
        <div className="flex items-center gap-3 text-muted-foreground/50">
          <span className="text-primary/70">{prediction.method}</span>
          {prediction.nSamples > 0 && <span>· {prediction.nSamples} samples</span>}
          {prediction.accuracy1x2 > 0 && <span>· 1X2 acc {prediction.accuracy1x2}%</span>}
          <span className={
            prediction.featureQuality === "full" ? "text-green-400/60" :
            prediction.featureQuality === "partial" ? "text-yellow-400/60" : "text-red-400/60"
          }>
            · {prediction.featureQuality} data
          </span>
        </div>
        <button
          onClick={() => setPrediction(null)}
          className="text-muted-foreground/30 hover:text-foreground border border-border/20 px-2 py-0.5 transition-colors"
        >
          Reset
        </button>
      </div>

      {/* Value bets */}
      {prediction.valueBets.length > 0 && (
        <div className="mx-4 mt-3 border border-yellow-500/30 bg-yellow-500/5 p-3 space-y-1.5">
          <div className="text-[9px] font-mono uppercase tracking-widest text-yellow-400/80 flex items-center gap-1.5">
            <Star className="w-3 h-3" /> Value Bets Found ({prediction.valueBets.length})
          </div>
          {prediction.valueBets.map((v, i) => (
            <div key={i} className="flex items-center gap-2 text-[10px] font-mono flex-wrap">
              <span className="text-yellow-300 font-bold">{v.market} {v.outcome}</span>
              <span className="text-foreground/70">{Math.round(v.modelProb * 100)}% model</span>
              <span className="text-muted-foreground/40">vs {Math.round(v.impliedProb * 100)}% bookie</span>
              <span className="text-green-400 font-bold">+{Math.round(v.edge * 100)}% edge</span>
              {v.bestOdds && <span className="text-primary ml-1">@ {v.bestOdds.toFixed(2)}</span>}
            </div>
          ))}
        </div>
      )}

      {/* Poisson params */}
      <div className="px-4 pt-3 pb-1 text-[9px] font-mono text-muted-foreground/35">
        λ Home = {prediction.lambdaHome} · λ Away = {prediction.lambdaAway}
      </div>

      {/* Column header */}
      <div className="px-4 pb-1 flex items-center gap-3 text-[8px] font-mono uppercase tracking-widest text-muted-foreground/25">
        <div className="w-16">Outcome</div>
        <div className="flex-1">Confidence</div>
        <div className="w-8 text-right">Model</div>
        <div className="w-10 text-right">Odds</div>
        <div className="w-10 text-right">Implied</div>
        <div className="w-12 text-right">Edge</div>
        <div className="w-3.5" />
      </div>

      {/* 1X2 */}
      <section className="border-b border-border/20">
        <div className="px-4 py-1.5 text-[9px] font-mono uppercase tracking-widest text-muted-foreground/35 bg-card/30">1X2</div>
        <ProbRow label="Home Win" modelProb={prediction.onex2.H} impliedProb={prediction.impliedProbs.onex2.H} bestOddsVal={prediction.bestOdds.onex2.H} isValue={isVal("1X2","Home")} />
        <ProbRow label="Draw"     modelProb={prediction.onex2.D} impliedProb={prediction.impliedProbs.onex2.D} bestOddsVal={prediction.bestOdds.onex2.D} isValue={isVal("1X2","Draw")} />
        <ProbRow label="Away Win" modelProb={prediction.onex2.A} impliedProb={prediction.impliedProbs.onex2.A} bestOddsVal={prediction.bestOdds.onex2.A} isValue={isVal("1X2","Away")} />
      </section>

      {/* BTTS */}
      <section className="border-b border-border/20">
        <div className="px-4 py-1.5 text-[9px] font-mono uppercase tracking-widest text-muted-foreground/35 bg-card/30">Both Teams To Score</div>
        <ProbRow label="Yes" modelProb={prediction.btts.yes} impliedProb={prediction.impliedProbs.btts.yes} bestOddsVal={prediction.bestOdds.btts.yes} isValue={isVal("BTTS","Yes")} />
        <ProbRow label="No"  modelProb={prediction.btts.no}  impliedProb={prediction.impliedProbs.btts.no}  bestOddsVal={prediction.bestOdds.btts.no}  isValue={isVal("BTTS","No")} />
      </section>

      {/* Double Chance */}
      <section className="border-b border-border/20">
        <div className="px-4 py-1.5 text-[9px] font-mono uppercase tracking-widest text-muted-foreground/35 bg-card/30">Double Chance</div>
        <ProbRow label="1X (1 or X)" modelProb={prediction.dc["1X"]} impliedProb={prediction.impliedProbs.dc["1X"]} bestOddsVal={prediction.bestOdds.dc["1X"]} isValue={isVal("DC","1X")} />
        <ProbRow label="12 (1 or 2)" modelProb={prediction.dc["12"]} impliedProb={prediction.impliedProbs.dc["12"]} bestOddsVal={prediction.bestOdds.dc["12"]} isValue={isVal("DC","12")} />
        <ProbRow label="X2 (X or 2)" modelProb={prediction.dc.X2}    impliedProb={prediction.impliedProbs.dc.X2}    bestOddsVal={prediction.bestOdds.dc.X2}    isValue={isVal("DC","X2")} />
      </section>

      {/* Correct Score */}
      <section className="border-b border-border/20">
        <div className="px-4 py-1.5 text-[9px] font-mono uppercase tracking-widest text-muted-foreground/35 bg-card/30">
          Correct Score <span className="text-muted-foreground/25 normal-case font-normal tracking-normal">· Poisson distribution</span>
        </div>
        <div className="px-4 py-3 grid grid-cols-4 gap-2">
          {prediction.correctScores.slice(0, 8).map((s, i) => (
            <div key={i} className={`border p-2 text-center ${i === 0 ? "border-primary/50 bg-primary/8" : "border-border/30 bg-card/20"}`}>
              <div className="text-[13px] font-mono font-bold text-foreground">{s.home}–{s.away}</div>
              <div className="text-[9px] font-mono text-muted-foreground/50 mt-0.5">{Math.round(s.prob * 100)}%</div>
            </div>
          ))}
        </div>
      </section>

      {/* Total Corners */}
      <section>
        <div className="px-4 py-1.5 text-[9px] font-mono uppercase tracking-widest text-muted-foreground/35 bg-card/30">
          Total Corners <span className="text-muted-foreground/25 normal-case font-normal tracking-normal">· statistical</span>
        </div>
        <div className="px-4 py-3 space-y-2.5">
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-mono font-bold text-primary">{prediction.corners.predicted}</span>
            <span className="text-[10px] font-mono text-muted-foreground/50">predicted corners  (σ = {prediction.corners.stdDev})</span>
          </div>
          <div className="flex gap-5 text-[10px] font-mono">
            <span>Over 8.5 <span className="font-bold text-foreground">{prediction.corners.over85}%</span></span>
            <span>Over 9.5 <span className="font-bold text-foreground">{prediction.corners.over95}%</span></span>
            <span>Over 10.5 <span className="font-bold text-foreground">{prediction.corners.over105}%</span></span>
          </div>
        </div>
      </section>
    </div>
  );
}

// ── Match detail modal ────────────────────────────────────────────────────────

const MARKETS: Array<[string, string]> = [
  ["1x2","1X2"], ["ou","O/U"], ["ah","AH"], ["btts","BTTS"],
  ["dc","DC"], ["dnb","DNB"],
];

function MatchDetailModal({ matchId, onClose }: { matchId: string; onClose: () => void }) {
  const [match, setMatch] = useState<MatchDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"odds" | "stats" | "bestats" | "players">("odds");
  const [selectedMarket, setSelectedMarket] = useState("1x2");
  const [playerView, setPlayerView] = useState<"summary" | "games">("summary");

  useEffect(() => {
    apiFetch<MatchDetail>(`/db/match/${matchId}`)
      .then(d => {
        setMatch(d);
        for (const [key] of MARKETS) {
          const data = (d.odds as Record<string, unknown>)[key];
          if (Array.isArray(data) && data.length > 0) { setSelectedMarket(key); break; }
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [matchId]);

  const availableMarkets = MARKETS.filter(([key]) => {
    const d = match ? (match.odds as Record<string, unknown>)[key] : null;
    return Array.isArray(d) && d.length > 0;
  });

  const homeStats = match?.homeStats as SHTeamStats | null;
  const awayStats = match?.awayStats as SHTeamStats | null;
  const beHomeStats = match?.beHomeStats as BETeamStatsData | null;
  const beAwayStats = match?.beAwayStats as BETeamStatsData | null;
  const isBESource = match?.dataSource === "betexplorer";

  const homeAnalytic = useMemo(() => computeTeamAnalytic(homeStats), [homeStats]);
  const awayAnalytic = useMemo(() => computeTeamAnalytic(awayStats), [awayStats]);

  const homePlayerGames = match?.homePlayerStats as PlayerGame[] | null;
  const awayPlayerGames = match?.awayPlayerStats as PlayerGame[] | null;
  const kickoffTs = match?.kickoffTs ?? null;

  const homeSummaries = useMemo(
    () => homePlayerGames ? aggregatePlayers(homePlayerGames, kickoffTs) : [],
    [homePlayerGames, kickoffTs]
  );
  const awaySummaries = useMemo(
    () => awayPlayerGames ? aggregatePlayers(awayPlayerGames, kickoffTs) : [],
    [awayPlayerGames, kickoffTs]
  );

  const activeMarketData = match
    ? ((match.odds as Record<string, unknown>)[selectedMarket] as OddsEntry[] | null)
    : null;
  const oddsColLabels = MARKET_COLS[selectedMarket] ?? [];
  const hasLine = selectedMarket === "ou" || selectedMarket === "ah";

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-[#0a0f1a] border border-primary/50 shadow-[0_0_40px_rgba(0,255,255,0.15)] w-full max-w-5xl max-h-[90vh] flex flex-col"
      >
        {/* Header */}
        <div className="border-b border-border/50 px-5 py-4 flex items-center justify-between flex-shrink-0">
          <div>
            {match && (
              <div className="text-sm font-mono font-bold text-foreground">
                {match.homeTeam}
                {match.homeScore !== null && (
                  <span className="mx-2 text-primary">{match.homeScore} – {match.awayScore}</span>
                )}
                {match.homeScore === null && <span className="text-primary mx-2">vs</span>}
                {match.awayTeam}
              </div>
            )}
            {match && (
              <div className="text-[10px] text-muted-foreground font-mono mt-0.5">
                {match.leagueName} · {match.date}
              </div>
            )}
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {loading ? (
          <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm font-mono animate-pulse">
            Loading…
          </div>
        ) : !match ? (
          <div className="flex-1 flex items-center justify-center text-destructive text-sm font-mono">
            Failed to load match
          </div>
        ) : (
          <>
            {/* Tab bar */}
            <div className="flex border-b border-border/30 flex-shrink-0">
              {([
                ["odds",    `Bookmaker Odds${availableMarkets.length ? ` (${availableMarkets.length})` : ""}`],
                ...(isBESource
                  ? [["bestats", "BE Stats"]]
                  : [["stats", "Team Stats"]]),
                ...(match.homePlayerStats || match.awayPlayerStats ? [["players", "Players"]] : []),
              ] as [string, string][]).map(([t, label]) => (
                <button
                  key={t}
                  onClick={() => setTab(t as "odds" | "stats" | "bestats" | "players")}
                  className={`px-6 py-2.5 text-[10px] font-mono uppercase tracking-widest border-b-2 transition-all ${
                    tab === t
                      ? "border-primary text-primary bg-primary/5"
                      : "border-transparent text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="flex-1 overflow-hidden flex flex-col">

              {/* ── ODDS TAB ── */}
              {tab === "odds" && (
                <div className="flex flex-col flex-1 overflow-hidden">
                  <div className="px-4 py-3 flex flex-wrap gap-1.5 border-b border-border/30 flex-shrink-0">
                    {MARKETS.map(([key, label]) => {
                      const hasData = availableMarkets.some(([k]) => k === key);
                      const isActive = selectedMarket === key;
                      return (
                        <button
                          key={key}
                          onClick={() => hasData && setSelectedMarket(key)}
                          disabled={!hasData}
                          className={`px-3 py-1 text-[10px] font-mono uppercase tracking-widest border transition-all ${
                            isActive
                              ? "border-primary bg-primary/10 text-primary"
                              : hasData
                              ? "border-border/60 text-muted-foreground hover:border-primary/50 hover:text-foreground"
                              : "border-border/20 text-muted-foreground/25 cursor-not-allowed"
                          }`}
                        >
                          {label}
                          {!hasData && <span className="ml-1 text-[8px] opacity-50">—</span>}
                        </button>
                      );
                    })}
                  </div>

                  <div className="flex-1 overflow-y-auto p-4">
                    {!activeMarketData || activeMarketData.length === 0 ? (
                      <div className="flex items-center justify-center h-32 text-muted-foreground/40 text-xs font-mono">
                        No odds data for this market
                      </div>
                    ) : (
                      <div className="overflow-x-auto border border-border/30">
                        <table className="w-full text-[11px] font-mono">
                          <thead className="sticky top-0 bg-card/90">
                            <tr className="border-b border-border/40">
                              <th className="text-left px-4 py-2 text-muted-foreground/60 font-normal w-48">
                                Bookmaker
                              </th>
                              {hasLine && (
                                <th className="text-center px-3 py-2 text-muted-foreground/40 font-normal min-w-[64px]">
                                  {selectedMarket === "ah" ? "Handicap" : "Line"}
                                </th>
                              )}
                              {oddsColLabels.map(label => (
                                <th key={label} className="text-center px-3 py-2 text-muted-foreground/60 font-normal uppercase min-w-[64px]">
                                  {label}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {activeMarketData.map((e, i) => (
                              <tr key={i} className={`border-b border-border/20 hover:bg-white/[0.02] ${i === 0 ? "bg-primary/5" : ""}`}>
                                <td className="px-4 py-2 text-foreground/80 truncate max-w-[180px]">
                                  {i === 0 && (
                                    <span className="inline-block mr-1.5 text-[8px] bg-primary/20 text-primary border border-primary/30 px-1 py-0.5 uppercase tracking-widest">
                                      Best
                                    </span>
                                  )}
                                  {e.bookmaker}
                                </td>
                                {hasLine && (
                                  <td className="text-center px-3 py-2 text-muted-foreground/50 tabular-nums">
                                    {e.line != null ? e.line : "—"}
                                  </td>
                                )}
                                {oddsColLabels.map((label, idx) => {
                                  const val = e.odds[idx];
                                  return (
                                    <td key={label} className="text-center px-3 py-2 text-primary/90 font-bold tabular-nums">
                                      {val != null ? val.toFixed(2) : <span className="text-muted-foreground/30">—</span>}
                                    </td>
                                  );
                                })}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* ── STATS TAB (StatsHub) ── */}
              {tab === "stats" && (
                <div className="flex flex-col flex-1 overflow-hidden">
                  <StatComparisonTable
                    homeTeam={match.homeTeam}
                    awayTeam={match.awayTeam}
                    homeStats={homeStats}
                    awayStats={awayStats}
                    homeAnalytic={homeAnalytic}
                    awayAnalytic={awayAnalytic}
                  />
                </div>
              )}

              {/* ── BE STATS TAB (BetExplorer) ── */}
              {tab === "bestats" && (
                <div className="flex flex-col flex-1 overflow-hidden">
                  <BETeamStatsPanel
                    homeTeam={match.homeTeam}
                    awayTeam={match.awayTeam}
                    homeBeStats={beHomeStats}
                    awayBeStats={beAwayStats}
                  />
                </div>
              )}

              {/* ── PLAYERS TAB ── */}
              {tab === "players" && (
                <div className="flex flex-col flex-1 overflow-hidden">
                  {/* View toggle */}
                  <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border/30 flex-shrink-0">
                    <button
                      onClick={() => setPlayerView("summary")}
                      className={`flex items-center gap-1.5 px-3 py-1 text-[9px] font-mono uppercase tracking-widest border transition-all ${
                        playerView === "summary"
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border/40 text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      <BarChart2 className="w-3 h-3" />
                      Analysis
                    </button>
                    <button
                      onClick={() => setPlayerView("games")}
                      className={`flex items-center gap-1.5 px-3 py-1 text-[9px] font-mono uppercase tracking-widest border transition-all ${
                        playerView === "games"
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border/40 text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      <LayoutList className="w-3 h-3" />
                      Per Game
                    </button>
                    {kickoffTs && (
                      <span className="ml-auto text-[8px] font-mono text-muted-foreground/25">
                        Analysis excludes current match
                      </span>
                    )}
                  </div>

                  {playerView === "summary" ? (
                    <div className="flex-1 overflow-y-auto">
                      <div className="grid grid-cols-2 divide-x divide-border/30 min-h-full">
                        <div className="overflow-x-auto">
                          <PlayerSummaryTable
                            teamName={match.homeTeam}
                            summaries={homeSummaries}
                            gamesTotal={homePlayerGames?.length ?? 0}
                          />
                        </div>
                        <div className="overflow-x-auto">
                          <PlayerSummaryTable
                            teamName={match.awayTeam}
                            summaries={awaySummaries}
                            gamesTotal={awayPlayerGames?.length ?? 0}
                          />
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="flex-1 overflow-y-auto">
                      <div className="grid grid-cols-2 gap-0 divide-x divide-border/30 h-full">
                        <div className="p-3">
                          <PlayerPerGamePanel
                            teamName={match.homeTeam}
                            playerStats={homePlayerGames}
                          />
                        </div>
                        <div className="p-3">
                          <PlayerPerGamePanel
                            teamName={match.awayTeam}
                            playerStats={awayPlayerGames}
                          />
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}

            </div>
          </>
        )}
      </motion.div>
    </div>
  );
}

// ── Model Training Card ───────────────────────────────────────────────────────

function ModelTrainingCard({ totalMatches }: { totalMatches: number }) {
  const [status, setStatus] = useState<ModelStatus | null>(null);
  const [training, setTraining] = useState(false);
  const [done, setDone] = useState<{ nSamples: number; accuracy1x2: number; accuracyBtts: number } | null>(null);

  useEffect(() => {
    apiFetch<ModelStatus>("/model/status").then(setStatus).catch(() => {});
  }, []);

  const train = async () => {
    setTraining(true); setDone(null);
    try {
      const r = await apiFetch<{ ok: boolean; nSamples: number; accuracy1x2: number; accuracyBtts: number }>("/model/train", { method: "POST" });
      setDone(r);
      const s = await apiFetch<ModelStatus>("/model/status");
      setStatus(s);
    } catch {} finally { setTraining(false); }
  };

  return (
    <div className="border border-border/40 bg-card/30 p-4 flex items-center gap-5">
      <div className="text-primary/50 shrink-0">
        <Brain className="w-7 h-7" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground/60 mb-1 flex items-center gap-2">
          <TrendingUp className="w-3 h-3" /> ML Prediction Model
        </div>
        {status ? (
          status.trained ? (
            <div className="text-[11px] font-mono space-x-3 text-foreground/70">
              <span className="text-green-400">✓ Trained</span>
              <span>· {status.nSamples} samples</span>
              <span>· 1X2 acc: <span className="text-foreground font-bold">{status.accuracy1x2}%</span></span>
              <span>· BTTS acc: <span className="text-foreground font-bold">{status.accuracyBtts}%</span></span>
              {status.trainedAt > 0 && (
                <span className="text-muted-foreground/40">· {new Date(status.trainedAt).toLocaleDateString()}</span>
              )}
            </div>
          ) : (
            <div className="text-[11px] font-mono text-muted-foreground/50">
              Not trained · {totalMatches} matches available · click Train to build the model
            </div>
          )
        ) : (
          <div className="text-[11px] font-mono text-muted-foreground/30 animate-pulse">Loading…</div>
        )}
        {done && (
          <div className="text-[10px] font-mono text-green-400/80 mt-1">
            ✓ Trained on {done.nSamples} samples — 1X2: {done.accuracy1x2}% · BTTS: {done.accuracyBtts}%
          </div>
        )}
      </div>
      <button
        onClick={train}
        disabled={training}
        className="flex items-center gap-2 px-4 py-2 text-[10px] font-mono uppercase tracking-widest border border-primary/50 text-primary hover:bg-primary/10 transition-all disabled:opacity-50 shrink-0"
      >
        <Brain className={`w-3 h-3 ${training ? "animate-pulse" : ""}`} />
        {training ? "Training…" : status?.trained ? "Retrain" : "Train Model"}
      </button>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function DatabasePage() {
  const [, navigate] = useLocation();

  const [stats, setStats] = useState<DbStats | null>(null);
  const [matches, setMatches] = useState<MatchSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const LIMIT = 50;

  const [selectedMatchId, setSelectedMatchId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const [s, mResp] = await Promise.all([
        apiFetch<DbStats>("/db/stats"),
        apiFetch<{ total: number; matches: MatchSummary[] }>(
          `/db/matches?limit=${LIMIT}&offset=${offset}`
        ),
      ]);
      setStats(s);
      setMatches(mResp.matches);
      setTotal(mResp.total);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [offset]);

  useEffect(() => { load(); }, [load]);

  const handleDeleteMatch = async (matchId: string) => {
    if (!matchId.startsWith("match_")) return;
    try {
      await apiFetch(`/db/match/${matchId}`, { method: "DELETE" });
      setMatches(ms => ms.filter(m => m.id !== matchId));
      setTotal(t => t - 1);
    } catch {}
  };

  return (
    <div className="min-h-screen bg-background text-foreground font-sans dark">
      <header className="border-b border-border/50 bg-card/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate("/")}
              className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <Activity className="w-6 h-6 text-primary" />
            <h1 className="text-2xl font-bold tracking-widest uppercase text-primary drop-shadow-[0_0_8px_rgba(0,255,255,0.5)]">
              Nexus Fixtures
            </h1>
            <span className="text-muted-foreground">/</span>
            <span className="text-sm font-mono uppercase tracking-widest text-foreground/70 flex items-center gap-1.5">
              <Database className="w-4 h-4" /> Database
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => navigate("/tester")}
              className="text-[10px] font-mono uppercase tracking-widest px-2 py-1 border border-transparent text-muted-foreground hover:text-primary hover:border-border transition-all"
            >Tester</button>
            <button
              onClick={load}
              disabled={refreshing}
              className="w-8 h-8 flex items-center justify-center text-muted-foreground hover:text-primary transition-colors"
              title="Refresh"
            >
              <RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} />
            </button>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-6 space-y-6">
        {stats && (
          <div className="grid grid-cols-3 gap-3">
            {[
              { icon: <Database className="w-4 h-4" />, label: "Total Matches", value: stats.matches },
              { icon: <BarChart2 className="w-4 h-4" />, label: "With Stats", value: stats.withStats },
              { icon: <Shield className="w-4 h-4" />, label: "With Odds", value: stats.withOdds },
            ].map(({ icon, label, value }) => (
              <div key={label} className="border border-border/50 bg-card/40 p-3 flex items-center gap-3">
                <div className="text-primary/60">{icon}</div>
                <div>
                  <div className="text-xl font-mono font-bold text-foreground">{value}</div>
                  <div className="text-[10px] text-muted-foreground font-mono uppercase tracking-widest">{label}</div>
                </div>
              </div>
            ))}
          </div>
        )}

        <ModelTrainingCard totalMatches={stats?.matches ?? 0} />

        <div>
          <div className="flex items-center gap-3 mb-3">
            <div className="text-xs font-mono uppercase tracking-widest text-muted-foreground flex-1">
              All Matches {total > 0 && `(${total})`}
            </div>
          </div>

          {loading ? (
            <div className="border border-border/50 p-8 text-center text-muted-foreground text-sm font-mono animate-pulse">
              Scanning database…
            </div>
          ) : matches.length === 0 ? (
            <div className="border border-border/50 bg-card/20 p-12 text-center">
              <Database className="w-10 h-10 mx-auto mb-3 text-muted-foreground/30" />
              <div className="text-sm font-mono text-muted-foreground/60 uppercase tracking-widest">
                No matches stored
              </div>
              <div className="text-xs text-muted-foreground/40 mt-1">
                Use the ⬆ Upload button on the Fixtures page to import data
              </div>
            </div>
          ) : (
            <>
              <div className="border border-border/50 overflow-x-auto">
                <table className="w-full text-[11px] font-mono">
                  <thead>
                    <tr className="border-b border-border/50 bg-card/60">
                      <th className="text-left px-3 py-2 text-muted-foreground/70 font-normal uppercase tracking-widest">Date</th>
                      <th className="text-left px-3 py-2 text-muted-foreground/70 font-normal uppercase tracking-widest">Match</th>
                      <th className="text-center px-3 py-2 text-muted-foreground/70 font-normal uppercase tracking-widest">Score</th>
                      <th className="text-left px-3 py-2 text-muted-foreground/70 font-normal uppercase tracking-widest">League</th>
                      <th className="text-center px-2 py-2 text-muted-foreground/70 font-normal" title="Team stats">Stats</th>
                      <th className="text-center px-2 py-2 text-muted-foreground/70 font-normal" title="Player stats">Players</th>
                      <th className="text-center px-2 py-2 text-muted-foreground/70 font-normal" title="Bookmaker odds">Odds</th>
                      <th className="text-center px-2 py-2 text-muted-foreground/70 font-normal" title="Source">Src</th>
                      <th className="text-right px-3 py-2"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {matches.map(m => (
                      <tr
                        key={m.id}
                        className="border-b border-border/20 hover:bg-white/[0.02] cursor-pointer transition-colors"
                        onClick={() => setSelectedMatchId(m.id)}
                      >
                        <td className="px-3 py-2 text-muted-foreground/60">{m.date}</td>
                        <td className="px-3 py-2 text-foreground/80">
                          <span className="truncate block max-w-[180px]">
                            {m.homeTeam} <span className="text-muted-foreground/50">vs</span> {m.awayTeam}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-center text-foreground/70">
                          {m.homeScore !== null ? `${m.homeScore} – ${m.awayScore}` : "—"}
                        </td>
                        <td className="px-3 py-2 text-muted-foreground/50 truncate max-w-[120px]">
                          {m.leagueName}
                        </td>
                        <td className="px-2 py-2 text-center">{dot(m.hasHomeStats)}</td>
                        <td className="px-2 py-2 text-center">{dot(m.hasPlayer)}</td>
                        <td className="px-2 py-2 text-center">{dot(m.hasOdds)}</td>
                        <td className="px-2 py-2 text-center">
                          <span className={`text-[8px] font-mono uppercase px-1 border ${
                            m.dataSource === "betexplorer"
                              ? "border-orange-500/40 text-orange-400/60"
                              : m.source === "processing"
                              ? "border-primary/30 text-primary/50"
                              : "border-border/40 text-muted-foreground/40"
                          }`}>
                            {m.dataSource === "betexplorer" ? "be" : m.source === "processing" ? "live" : "bulk"}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-right" onClick={e => e.stopPropagation()}>
                          {m.source === "stored" && (
                            <button
                              onClick={() => handleDeleteMatch(m.id)}
                              className="text-muted-foreground/30 hover:text-destructive transition-colors"
                              title="Delete match"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {total > LIMIT && (
                <div className="flex items-center justify-between mt-3 text-xs font-mono text-muted-foreground">
                  <span>{offset + 1}–{Math.min(offset + LIMIT, total)} of {total}</span>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setOffset(o => Math.max(0, o - LIMIT))}
                      disabled={offset === 0}
                      className="w-7 h-7 flex items-center justify-center border border-border hover:border-primary/50 disabled:opacity-30 transition-all"
                    >
                      <ChevronLeft className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => setOffset(o => o + LIMIT)}
                      disabled={offset + LIMIT >= total}
                      className="w-7 h-7 flex items-center justify-center border border-border hover:border-primary/50 disabled:opacity-30 transition-all"
                    >
                      <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </main>

      <AnimatePresence>
        {selectedMatchId && (
          <MatchDetailModal
            matchId={selectedMatchId}
            onClose={() => setSelectedMatchId(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
