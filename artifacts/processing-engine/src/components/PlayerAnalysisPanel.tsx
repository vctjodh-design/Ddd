import React, { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { TrendingUp, TrendingDown, Minus, Info, ChevronDown, ChevronUp } from "lucide-react";

// ─── Types (mirrors fixture-detail.tsx) ──────────────────────────────────────

interface PlayerMatchStats {
  minutesPlayed: number; rating: number; matchPosition: string; isSubstitute: boolean;
  goals: number; assists: number; goalOrAssist: number;
  shots: number; shotsOnTarget: number; blockedShots: number;
  passes: number; accuratePasses: number;
  tackles: number; interceptions: number; fouls: number; foulsWon: number; foulInvolvements: number;
  yellowCard: boolean; redCard: boolean; saves: number;
  xG: number; xA: number; xGxA: number; keyPasses: number;
  clearances: number; aerialWon: number;
}

interface Player {
  playerId: number; name: string; position: string; jerseyNo: number; appearances: number;
  matchStats: (PlayerMatchStats | null)[];
}

export interface TeamData {
  players: Player[];
  matches: { eventId: number; date: number; homeTeamName: string; awayTeamName: string; homeScore: number; awayScore: number; isHome: boolean; }[];
}

type PosGroup = "GK" | "DEF" | "MID" | "FWD";
type ProfileRating = "STRONG" | "MIXED" | "WEAK" | "LIMITED";

interface Signal { label: string; type: "strength" | "weakness" | "neutral"; }

interface AvgStats {
  apps: number; totalMatches: number; avgMins: number;
  avgGoals: number; avgAssists: number; avgGA: number;
  avgShots: number; avgSOT: number;
  avgPasses: number; avgTackles: number; avgInterceptions: number;
  avgFouls: number; avgFoulsWon: number;
  avgYellowCards: number; avgRedCards: number;
  avgSaves: number; avgClearances: number; avgKeyPasses: number;
  avgxG: number; avgxA: number;
  p90Shots: number; p90SOT: number; p90Passes: number;
  p90Tackles: number; p90Fouls: number; p90FoulsWon: number;
  p90Saves: number; p90Interceptions: number; p90xG: number;
  p90KeyPasses: number; p90Assists: number; p90Clearances: number;
}

// ─── Position Classification ──────────────────────────────────────────────────

function classifyPosition(pos: string): PosGroup {
  if (!pos) return "MID";
  const p = pos.toUpperCase().trim();
  if (["G", "GK", "GOALKEEPER"].includes(p)) return "GK";
  if (["D", "CB", "LB", "RB", "WB", "LWB", "RWB", "DEF", "DEFENDER"].includes(p) ||
      (p.startsWith("D") && p.length <= 3)) return "DEF";
  if (["F", "ST", "CF", "LW", "RW", "SS", "FWD", "FORWARD", "ATT", "W"].includes(p) ||
      (p.startsWith("F") && p.length <= 3)) return "FWD";
  return "MID";
}

const POS_LABELS: Record<PosGroup, string> = { GK: "Goalkeeper", DEF: "Defenders", MID: "Midfielders", FWD: "Forwards" };

// ─── Stats Computation ────────────────────────────────────────────────────────

function computeAvgStats(player: Player, totalMatches: number): AvgStats {
  const played = player.matchStats.filter((ms): ms is PlayerMatchStats => ms !== null);
  const n = played.length;
  const zero: AvgStats = {
    apps: n, totalMatches, avgMins: 0, avgGoals: 0, avgAssists: 0, avgGA: 0,
    avgShots: 0, avgSOT: 0, avgPasses: 0, avgTackles: 0, avgInterceptions: 0,
    avgFouls: 0, avgFoulsWon: 0, avgYellowCards: 0, avgRedCards: 0,
    avgSaves: 0, avgClearances: 0, avgKeyPasses: 0, avgxG: 0, avgxA: 0,
    p90Shots: 0, p90SOT: 0, p90Passes: 0, p90Tackles: 0, p90Fouls: 0, p90FoulsWon: 0,
    p90Saves: 0, p90Interceptions: 0, p90xG: 0, p90KeyPasses: 0, p90Assists: 0, p90Clearances: 0,
  };
  if (n === 0) return zero;

  const sum = (f: (ms: PlayerMatchStats) => number) => played.reduce((s, ms) => s + f(ms), 0);
  const totalMins = sum(ms => ms.minutesPlayed);
  const p90 = (v: number) => totalMins > 0 ? (v / totalMins) * 90 : 0;

  return {
    apps: n, totalMatches, avgMins: totalMins / n,
    avgGoals: sum(ms => ms.goals) / n,
    avgAssists: sum(ms => ms.assists) / n,
    avgGA: sum(ms => ms.goalOrAssist) / n,
    avgShots: sum(ms => ms.shots) / n,
    avgSOT: sum(ms => ms.shotsOnTarget) / n,
    avgPasses: sum(ms => ms.passes) / n,
    avgTackles: sum(ms => ms.tackles) / n,
    avgInterceptions: sum(ms => ms.interceptions) / n,
    avgFouls: sum(ms => ms.fouls) / n,
    avgFoulsWon: sum(ms => ms.foulsWon) / n,
    avgYellowCards: sum(ms => ms.yellowCard ? 1 : 0) / n,
    avgRedCards: sum(ms => ms.redCard ? 1 : 0) / n,
    avgSaves: sum(ms => ms.saves) / n,
    avgClearances: sum(ms => ms.clearances) / n,
    avgKeyPasses: sum(ms => ms.keyPasses) / n,
    avgxG: sum(ms => ms.xG) / n,
    avgxA: sum(ms => ms.xA) / n,
    p90Shots: p90(sum(ms => ms.shots)),
    p90SOT: p90(sum(ms => ms.shotsOnTarget)),
    p90Passes: p90(sum(ms => ms.passes)),
    p90Tackles: p90(sum(ms => ms.tackles)),
    p90Fouls: p90(sum(ms => ms.fouls)),
    p90FoulsWon: p90(sum(ms => ms.foulsWon)),
    p90Saves: p90(sum(ms => ms.saves)),
    p90Interceptions: p90(sum(ms => ms.interceptions)),
    p90xG: p90(sum(ms => ms.xG)),
    p90KeyPasses: p90(sum(ms => ms.keyPasses)),
    p90Assists: p90(sum(ms => ms.assists)),
    p90Clearances: p90(sum(ms => ms.clearances)),
  };
}

// ─── Profile Evaluation (position-specific) ───────────────────────────────────

function evaluateProfile(avg: AvgStats, pos: PosGroup): { rating: ProfileRating; signals: Signal[] } {
  if (avg.apps < 2) {
    return { rating: "LIMITED", signals: [{ label: "Too few appearances to assess", type: "neutral" }] };
  }

  const signals: Signal[] = [];
  let s = 0, w = 0;
  const S = (label: string) => { signals.push({ label, type: "strength" }); s++; };
  const W = (label: string) => { signals.push({ label, type: "weakness" }); w++; };
  const N = (label: string) => signals.push({ label, type: "neutral" });

  if (pos === "GK") {
    if (avg.p90Passes >= 35) S("High passes — builds play from the back");
    else if (avg.p90Passes >= 22) N("Moderate pass distribution");
    else if (avg.p90Passes < 15 && avg.apps >= 3) W("Low passes — limited in possession");

    if (avg.avgYellowCards > 0.3) W("High yellow card rate — disciplinary risk");
    else if (avg.avgYellowCards < 0.08 && avg.apps >= 4) S("Disciplined — rarely booked");

    if (avg.p90Saves >= 4) N("High saves — likely facing many shots (check defense)");
    else if (avg.p90Saves >= 2) S("Active saving — reliable in goal");

    if (avg.p90FoulsWon >= 0.6) S("Draws fouls — good claiming of contact");
    if (avg.p90Fouls >= 1.0) W("High fouls — rushing out or mistimed challenges");
  }

  if (pos === "DEF") {
    if (avg.p90Passes >= 60) S("High passes — dominant build-up contributor");
    else if (avg.p90Passes >= 35) N("Adequate passing involvement");
    else if (avg.p90Passes < 22 && avg.apps >= 3) W("Low passes — struggling in possession");

    if (avg.p90Tackles >= 3.0) S("High tackles — dominant defensive presence");
    else if (avg.p90Tackles >= 1.5) N("Solid defensive activity");
    else if (avg.p90Tackles < 0.8 && avg.apps >= 3) W("Low tackles — passive or poor positioning");

    if (avg.p90Fouls >= 2.5) W("High fouls — under pressure or poor positioning");
    else if (avg.p90Fouls >= 1.5) N("Moderate fouling");
    else if (avg.p90Fouls < 0.8 && avg.apps >= 3) S("Low fouls — disciplined and composed");

    if (avg.avgYellowCards > 0.35) W("High yellow card rate — disciplinary risk");
    else if (avg.avgYellowCards < 0.08 && avg.apps >= 4) S("Rarely booked — composed and secure");

    if (avg.p90FoulsWon >= 1.5) S("High fouls won — good at shielding the ball");
    if (avg.p90Interceptions >= 2.0) S("High interceptions — reads the game well");
    if (avg.p90Assists >= 0.25) S("Assists contribution — attacking full-back threat");
    if (avg.p90Clearances >= 5) S("High clearances — dominant aerial / last-ditch defender");
  }

  if (pos === "MID") {
    if (avg.p90Passes >= 70) S("High passes — controls midfield tempo");
    else if (avg.p90Passes >= 45) N("Solid passing involvement");
    else if (avg.p90Passes < 25 && avg.apps >= 3) W("Low passes — bypassed in midfield");

    if (avg.p90Tackles >= 2.5) S("High tackles — strong defensive contribution");
    else if (avg.p90Tackles >= 1.5) N("Good defensive activity");

    if (avg.p90Fouls >= 2.5) W("High fouls — reckless or losing midfield duels");
    else if (avg.p90Fouls < 0.8 && avg.apps >= 3) S("Low fouls — composed in duels");

    if (avg.avgYellowCards > 0.3) W("High yellow card rate — aggressive or frustrated");
    else if (avg.avgYellowCards < 0.08 && avg.apps >= 4) S("Rarely booked — disciplined midfielder");

    if (avg.p90FoulsWon >= 1.5) S("High fouls won — press-resistant, holds possession");
    if (avg.p90Interceptions >= 1.5) S("High interceptions — strong defensive awareness");
    if (avg.p90KeyPasses >= 1.5) S("High key passes — creative chance maker");
    if (avg.p90Assists >= 0.3) S("High assists — orchestrates attacks");
    if (avg.p90Shots >= 2.5) S("High shots — box-to-box attacking threat");
  }

  if (pos === "FWD") {
    if (avg.p90Shots >= 4.5) S("High shots — major goal threat");
    else if (avg.p90Shots >= 2.5) N("Regular shots — consistent attacker");
    else if (avg.p90Shots < 1.0 && avg.apps >= 3) W("Low shots — not getting into positions");

    if (avg.p90SOT >= 1.5) S("High shots on target — strong finishing quality");
    else if (avg.p90SOT < 0.5 && avg.p90Shots >= 1.0) W("Low shots on target — poor accuracy");

    if (avg.avgGoals > 0.5) S("High goal rate — proven finisher");
    else if (avg.avgGoals > 0.2) N("Occasional goals");

    if (avg.avgGA >= 0.6) S("High G+A — major attacking contributor");
    else if (avg.avgGA < 0.1 && avg.apps >= 4) W("Very low G+A — not impacting in the final third");

    if (avg.p90FoulsWon >= 2.5) S("High fouls won — dangerous dribbler, constantly troubles defenders");
    else if (avg.p90FoulsWon >= 1.0) N("Draws fouls regularly");

    if (avg.p90xG >= 0.5) S("High xG — consistently finding high-quality positions");
    else if (avg.p90xG < 0.1 && avg.apps >= 4) W("Very low xG — not accessing quality chances");

    if (avg.p90KeyPasses >= 1.5) S("High key passes — creator as well as scorer");
    if (avg.p90Assists >= 0.3) S("High assists — dual threat provider");
  }

  const rating: ProfileRating =
    s >= 3 && w === 0 ? "STRONG" :
    s >= 2 && w <= 1 ? "STRONG" :
    w >= 3 && s === 0 ? "WEAK" :
    w >= 2 && s <= 1 ? "WEAK" :
    (s === 0 && w === 0) ? "LIMITED" :
    "MIXED";

  return { rating, signals };
}

// ─── Team Insight Computation ─────────────────────────────────────────────────

type LineStatus = "solid" | "contested" | "vulnerable";

interface LineInsight {
  line: string;
  status: LineStatus;
  detail: string;
}

function computeTeamInsights(players: Player[], totalMatches: number): LineInsight[] {
  const groupStats = (pos: PosGroup) =>
    players
      .filter(p => classifyPosition(p.position) === pos && p.appearances >= 2)
      .map(p => computeAvgStats(p, totalMatches));

  const mean = (arr: number[]) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;

  const insights: LineInsight[] = [];

  const defStats = groupStats("DEF");
  if (defStats.length) {
    const avgFouls = mean(defStats.map(a => a.p90Fouls));
    const avgYC = mean(defStats.map(a => a.avgYellowCards));
    const avgPasses = mean(defStats.map(a => a.p90Passes));
    const avgTackles = mean(defStats.map(a => a.p90Tackles));
    const score = (avgPasses >= 40 ? 1 : avgPasses < 22 ? -1 : 0) +
      (avgTackles >= 2 ? 1 : avgTackles < 0.8 ? -1 : 0) +
      (avgFouls < 1 ? 1 : avgFouls >= 2.5 ? -1 : 0) +
      (avgYC < 0.1 ? 1 : avgYC >= 0.3 ? -1 : 0);
    const tags: string[] = [];
    if (avgFouls >= 2.5) tags.push("↑ fouls");
    if (avgYC >= 0.3) tags.push("↑ yellows");
    if (avgPasses < 22) tags.push("↓ passes");
    if (avgPasses >= 50) tags.push("↑ passes");
    if (avgTackles >= 2.5) tags.push("↑ tackles");
    insights.push({
      line: "Defense",
      status: score >= 2 ? "solid" : score <= -1 ? "vulnerable" : "contested",
      detail: tags.join(", ") || "Avg defensive metrics",
    });
  }

  const midStats = groupStats("MID");
  if (midStats.length) {
    const avgPasses = mean(midStats.map(a => a.p90Passes));
    const avgFoulsWon = mean(midStats.map(a => a.p90FoulsWon));
    const avgFouls = mean(midStats.map(a => a.p90Fouls));
    const avgYC = mean(midStats.map(a => a.avgYellowCards));
    const score = (avgPasses >= 55 ? 1 : avgPasses < 25 ? -1 : 0) +
      (avgFoulsWon >= 1.5 ? 1 : avgFoulsWon < 0.5 ? -1 : 0) +
      (avgFouls < 1 ? 1 : avgFouls >= 2.5 ? -1 : 0) +
      (avgYC < 0.1 ? 1 : avgYC >= 0.3 ? -1 : 0);
    const tags: string[] = [];
    if (avgPasses < 25) tags.push("↓ passes");
    if (avgFoulsWon < 0.5) tags.push("↓ fouls won");
    if (avgFouls >= 2.5) tags.push("↑ fouls");
    if (avgPasses >= 60) tags.push("↑ passes");
    if (avgFoulsWon >= 1.5) tags.push("↑ fouls won");
    insights.push({
      line: "Midfield",
      status: score >= 2 ? "solid" : score <= -1 ? "vulnerable" : "contested",
      detail: tags.join(", ") || "Avg midfield metrics",
    });
  }

  const fwdStats = groupStats("FWD");
  if (fwdStats.length) {
    const avgShots = mean(fwdStats.map(a => a.p90Shots));
    const avgSOT = mean(fwdStats.map(a => a.p90SOT));
    const avgFoulsWon = mean(fwdStats.map(a => a.p90FoulsWon));
    const score = (avgShots >= 3.5 ? 1 : avgShots < 1 ? -1 : 0) +
      (avgSOT >= 1.5 ? 1 : avgSOT < 0.5 ? -1 : 0) +
      (avgFoulsWon >= 2 ? 1 : 0);
    const tags: string[] = [];
    if (avgShots >= 3.5) tags.push("↑ shots");
    if (avgSOT >= 1.5) tags.push("↑ SOT");
    if (avgFoulsWon >= 2) tags.push("↑ fouls won");
    if (avgShots < 1) tags.push("↓ shots");
    if (avgSOT < 0.5) tags.push("↓ SOT");
    insights.push({
      line: "Attack",
      status: score >= 2 ? "solid" : score <= -1 ? "vulnerable" : "contested",
      detail: tags.join(", ") || "Avg attacking metrics",
    });
  }

  const gkStats = groupStats("GK");
  if (gkStats.length) {
    const avgPasses = mean(gkStats.map(a => a.p90Passes));
    const avgYC = mean(gkStats.map(a => a.avgYellowCards));
    const avgSaves = mean(gkStats.map(a => a.p90Saves));
    const tags: string[] = [];
    if (avgPasses >= 30) tags.push("↑ passes");
    if (avgSaves >= 4) tags.push("↑ saves");
    if (avgYC >= 0.3) tags.push("↑ cards");
    const score = (avgPasses >= 30 ? 1 : 0) - (avgYC >= 0.3 ? 1 : 0);
    if (tags.length) {
      insights.push({
        line: "Goalkeeper",
        status: score >= 1 ? "solid" : score < 0 ? "vulnerable" : "contested",
        detail: tags.join(", "),
      });
    }
  }

  return insights;
}

// ─── Key stats per position (displayed in card) ───────────────────────────────

interface StatRow { label: string; value: string; note: string; }

function getKeyStats(avg: AvgStats, pos: PosGroup): StatRow[] {
  const fmt = (v: number, d = 2) => v.toFixed(d);
  if (pos === "GK") return [
    { label: "Passes/90", value: fmt(avg.p90Passes, 1), note: "build-up" },
    { label: "Saves/90",  value: fmt(avg.p90Saves, 1),  note: "shot-stopping" },
    { label: "Fouls/90",  value: fmt(avg.p90Fouls, 2),  note: "challenges" },
    { label: "YC/G",      value: fmt(avg.avgYellowCards, 2), note: "discipline" },
  ];
  if (pos === "DEF") return [
    { label: "Passes/90",   value: fmt(avg.p90Passes, 1),       note: "build-up" },
    { label: "Tackles/90",  value: fmt(avg.p90Tackles, 2),      note: "defending" },
    { label: "Fouls/90",    value: fmt(avg.p90Fouls, 2),        note: "aggression" },
    { label: "FoulsW/90",   value: fmt(avg.p90FoulsWon, 2),     note: "ball-shielding" },
    { label: "Intcpt/90",   value: fmt(avg.p90Interceptions, 2), note: "reading" },
    { label: "YC/G",        value: fmt(avg.avgYellowCards, 2),  note: "discipline" },
  ];
  if (pos === "MID") return [
    { label: "Passes/90",  value: fmt(avg.p90Passes, 1),       note: "control" },
    { label: "Tackles/90", value: fmt(avg.p90Tackles, 2),      note: "defensive" },
    { label: "Fouls/90",   value: fmt(avg.p90Fouls, 2),        note: "duels" },
    { label: "FoulsW/90",  value: fmt(avg.p90FoulsWon, 2),     note: "press-resist" },
    { label: "KeyP/90",    value: fmt(avg.p90KeyPasses, 2),    note: "creativity" },
    { label: "Ast/90",     value: fmt(avg.p90Assists, 2),      note: "output" },
  ];
  return [
    { label: "Shots/90", value: fmt(avg.p90Shots, 2),     note: "threat" },
    { label: "SOT/90",   value: fmt(avg.p90SOT, 2),       note: "accuracy" },
    { label: "Goals/G",  value: fmt(avg.avgGoals, 2),     note: "finishing" },
    { label: "FoulsW/90",value: fmt(avg.p90FoulsWon, 2),  note: "dribbling" },
    { label: "xG/90",    value: fmt(avg.p90xG, 2),        note: "chance quality" },
    { label: "G+A/G",    value: fmt(avg.avgGA, 2),        note: "contribution" },
  ];
}

// ─── Profile Badge ────────────────────────────────────────────────────────────

const RATING_CONFIG: Record<ProfileRating, { color: string; bg: string; border: string; icon: React.ReactNode; }> = {
  STRONG:   { color: "text-green-400",          bg: "bg-green-500/8",   border: "border-green-500/30",  icon: <TrendingUp   className="w-3 h-3" /> },
  MIXED:    { color: "text-yellow-400",         bg: "bg-yellow-500/8",  border: "border-yellow-500/30", icon: <Minus        className="w-3 h-3" /> },
  WEAK:     { color: "text-red-400",            bg: "bg-red-500/8",     border: "border-red-500/30",    icon: <TrendingDown className="w-3 h-3" /> },
  LIMITED:  { color: "text-muted-foreground/50",bg: "bg-muted/5",       border: "border-border/20",     icon: <Info         className="w-3 h-3" /> },
};

const STATUS_CONFIG: Record<LineStatus, { color: string; label: string }> = {
  solid:      { color: "text-green-400",  label: "SOLID" },
  contested:  { color: "text-yellow-400", label: "CONTESTED" },
  vulnerable: { color: "text-red-400",    label: "VULNERABLE" },
};

// ─── Player Card ──────────────────────────────────────────────────────────────

function PlayerCard({ player, totalMatches, teamColor }: {
  player: Player; totalMatches: number; teamColor: string | null;
}) {
  const [expanded, setExpanded] = useState(false);
  const pos = classifyPosition(player.position);
  const avg = useMemo(() => computeAvgStats(player, totalMatches), [player, totalMatches]);
  const { rating, signals } = useMemo(() => evaluateProfile(avg, pos), [avg, pos]);
  const keyStats = useMemo(() => getKeyStats(avg, pos), [avg, pos]);
  const rc = RATING_CONFIG[rating];

  const strengths = signals.filter(s => s.type === "strength");
  const weaknesses = signals.filter(s => s.type === "weakness");
  const neutrals = signals.filter(s => s.type === "neutral");

  const accentColor = teamColor || "#00ffff";

  return (
    <div className={`border ${rc.border} ${rc.bg} overflow-hidden`}>
      {/* Header */}
      <div className="px-3 pt-2.5 pb-2 flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="text-[8px] font-mono text-muted-foreground/35 flex-shrink-0">
              #{player.jerseyNo || "—"}
            </span>
            <span className="text-[11px] font-mono font-semibold text-foreground/90 truncate">
              {player.name}
            </span>
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-[8px] font-mono px-1.5 py-0.5 border border-border/30 text-muted-foreground/50 uppercase tracking-wider">
              {pos}
            </span>
            <span className="text-[8px] font-mono text-muted-foreground/40">
              {avg.apps}/{totalMatches} apps
            </span>
            <span className="text-[8px] font-mono text-muted-foreground/30">
              ~{avg.avgMins.toFixed(0)}' avg
            </span>
          </div>
        </div>
        <div className={`flex items-center gap-1 px-2 py-1 border ${rc.border} ${rc.color} flex-shrink-0`}>
          {rc.icon}
          <span className="text-[8px] font-mono font-bold uppercase tracking-wider">{rating}</span>
        </div>
      </div>

      {/* Key stats grid */}
      <div className={`grid grid-cols-3 border-t border-b divide-x ${rc.border} border-border/15 divide-border/15`}>
        {keyStats.slice(0, 6).map(st => (
          <div key={st.label} className="px-2 py-1.5 text-center">
            <div className="text-[11px] font-mono font-bold" style={{ color: accentColor }}>
              {st.value}
            </div>
            <div className="text-[7px] font-mono text-muted-foreground/40 uppercase tracking-wide leading-tight mt-0.5">
              {st.label}
            </div>
          </div>
        ))}
      </div>

      {/* Signals summary */}
      <div className="px-3 py-2 space-y-1">
        {strengths.slice(0, expanded ? 999 : 2).map((sig, i) => (
          <div key={i} className="flex items-start gap-1.5">
            <span className="text-green-400 text-[9px] mt-px flex-shrink-0">✓</span>
            <span className="text-[9px] font-mono text-green-400/80 leading-tight">{sig.label}</span>
          </div>
        ))}
        {weaknesses.slice(0, expanded ? 999 : 2).map((sig, i) => (
          <div key={i} className="flex items-start gap-1.5">
            <span className="text-red-400 text-[9px] mt-px flex-shrink-0">✗</span>
            <span className="text-[9px] font-mono text-red-400/80 leading-tight">{sig.label}</span>
          </div>
        ))}
        {!expanded && neutrals.slice(0, 1).map((sig, i) => (
          <div key={i} className="flex items-start gap-1.5">
            <span className="text-muted-foreground/40 text-[9px] mt-px flex-shrink-0">·</span>
            <span className="text-[9px] font-mono text-muted-foreground/40 leading-tight">{sig.label}</span>
          </div>
        ))}
        {expanded && neutrals.map((sig, i) => (
          <div key={i} className="flex items-start gap-1.5">
            <span className="text-muted-foreground/40 text-[9px] mt-px flex-shrink-0">·</span>
            <span className="text-[9px] font-mono text-muted-foreground/40 leading-tight">{sig.label}</span>
          </div>
        ))}

        {signals.length === 0 && (
          <span className="text-[9px] font-mono text-muted-foreground/25 italic">No signals detected</span>
        )}
      </div>

      {/* Expand toggle */}
      {signals.length > 3 && (
        <button
          onClick={() => setExpanded(e => !e)}
          className="w-full px-3 py-1.5 border-t border-border/15 flex items-center justify-center gap-1 text-[8px] font-mono text-muted-foreground/35 hover:text-muted-foreground/60 transition-colors"
        >
          {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          {expanded ? "Less" : `+${signals.length - 3} more signals`}
        </button>
      )}
    </div>
  );
}

// ─── Team Insight Banner ──────────────────────────────────────────────────────

function TeamInsightBanner({ players, totalMatches, teamName, teamColor }: {
  players: Player[]; totalMatches: number; teamName: string; teamColor: string | null;
}) {
  const insights = useMemo(() => computeTeamInsights(players, totalMatches), [players, totalMatches]);

  if (!insights.length) return null;

  return (
    <div className="border border-border/40 bg-card/20 p-3 space-y-2">
      <div className="flex items-center gap-2">
        <div className="h-px flex-1 bg-border/20" />
        <span className="text-[8px] font-mono uppercase tracking-[0.2em] text-muted-foreground/40">
          Team Assessment
        </span>
        <div className="h-px flex-1 bg-border/20" />
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
        {insights.map(ins => {
          const sc = STATUS_CONFIG[ins.status];
          return (
            <div key={ins.line} className="border border-border/25 bg-card/30 p-2 space-y-1">
              <div className="flex items-center justify-between gap-1">
                <span className="text-[8px] font-mono text-muted-foreground/50 uppercase tracking-wider">{ins.line}</span>
                <span className={`text-[7px] font-mono font-bold uppercase tracking-wider ${sc.color}`}>{sc.label}</span>
              </div>
              <p className="text-[8px] font-mono text-muted-foreground/40 leading-tight">{ins.detail}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Position Group Section ───────────────────────────────────────────────────

function PositionSection({ pos, homePlayers, awayPlayers, homeTeam, awayTeam, totalMatches }: {
  pos: PosGroup;
  homePlayers: Player[]; awayPlayers: Player[];
  homeTeam: { name: string; colorPrimary: string | null };
  awayTeam: { name: string; colorPrimary: string | null };
  totalMatches: number;
}) {
  if (!homePlayers.length && !awayPlayers.length) return null;

  const profileCounts = (players: Player[]) => {
    const counts: Record<ProfileRating, number> = { STRONG: 0, MIXED: 0, WEAK: 0, LIMITED: 0 };
    players.forEach(p => {
      const avg = computeAvgStats(p, totalMatches);
      const { rating } = evaluateProfile(avg, pos);
      counts[rating]++;
    });
    return counts;
  };

  const homeCounts = profileCounts(homePlayers);
  const awayCounts = profileCounts(awayPlayers);

  return (
    <div className="space-y-3">
      {/* Position header with summary counts */}
      <div className="flex items-center gap-3">
        <div className="border border-border/50 px-2.5 py-1 text-[9px] font-mono uppercase tracking-[0.15em] text-muted-foreground">
          {POS_LABELS[pos]}
        </div>
        <div className="flex-1 h-px bg-border/20" />
        <div className="flex items-center gap-3 text-[8px] font-mono">
          {(["STRONG","MIXED","WEAK"] as ProfileRating[]).map(r => {
            const rc = RATING_CONFIG[r];
            const h = homeCounts[r], a = awayCounts[r];
            if (h + a === 0) return null;
            return (
              <div key={r} className={`flex items-center gap-1 ${rc.color} opacity-60`}>
                {rc.icon}<span>{r}: {h}/{a}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Side-by-side player lists */}
      <div className="grid grid-cols-2 gap-3">
        {/* Home team */}
        <div className="space-y-2">
          <div className="text-[8px] font-mono uppercase tracking-wider truncate"
            style={{ color: homeTeam.colorPrimary || "#00ffff" }}>
            {homeTeam.name}
          </div>
          {homePlayers.length === 0 ? (
            <div className="border border-dashed border-border/20 p-4 text-center">
              <span className="text-[9px] font-mono text-muted-foreground/25">No {POS_LABELS[pos].toLowerCase()} data</span>
            </div>
          ) : (
            homePlayers.map((p, i) => (
              <motion.div key={p.playerId}
                initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.04 }}>
                <PlayerCard player={p} totalMatches={totalMatches} teamColor={homeTeam.colorPrimary} />
              </motion.div>
            ))
          )}
        </div>

        {/* Away team */}
        <div className="space-y-2">
          <div className="text-[8px] font-mono uppercase tracking-wider truncate"
            style={{ color: awayTeam.colorPrimary || "#00ffff" }}>
            {awayTeam.name}
          </div>
          {awayPlayers.length === 0 ? (
            <div className="border border-dashed border-border/20 p-4 text-center">
              <span className="text-[9px] font-mono text-muted-foreground/25">No {POS_LABELS[pos].toLowerCase()} data</span>
            </div>
          ) : (
            awayPlayers.map((p, i) => (
              <motion.div key={p.playerId}
                initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.04 }}>
                <PlayerCard player={p} totalMatches={totalMatches} teamColor={awayTeam.colorPrimary} />
              </motion.div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Main Panel ───────────────────────────────────────────────────────────────

const POS_TABS: PosGroup[] = ["GK", "DEF", "MID", "FWD"];

export default function PlayerAnalysisPanel({
  home, away, fixture,
}: {
  home: TeamData;
  away: TeamData;
  fixture: {
    homeTeam: { name: string; colorPrimary: string | null };
    awayTeam: { name: string; colorPrimary: string | null };
  };
}) {
  const [posTab, setPosTab] = useState<PosGroup>("DEF");
  const [minApps, setMinApps] = useState(2);

  const totalMatchesHome = home.matches.length;
  const totalMatchesAway = away.matches.length;

  const filterAndSort = (players: Player[], pos: PosGroup, totalMatches: number) =>
    players
      .filter(p => classifyPosition(p.position) === pos && p.appearances >= minApps)
      .sort((a, b) => {
        const aMin = a.matchStats.reduce((s, ms) => s + (ms?.minutesPlayed ?? 0), 0);
        const bMin = b.matchStats.reduce((s, ms) => s + (ms?.minutesPlayed ?? 0), 0);
        return bMin - aMin;
      });

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="border border-border/30 bg-card/20 px-4 py-3 space-y-1">
        <div className="flex items-center gap-2">
          <div className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
          <span className="text-[10px] font-mono uppercase tracking-[0.25em] text-primary/70">
            Player Profile Analysis
          </span>
        </div>
        <p className="text-[9px] font-mono text-muted-foreground/45 leading-relaxed max-w-2xl">
          Position-specific strength & weakness profiling based on per-90 normalised stats across recent matches.
          Signals use position-dependent thresholds — a high tackle count means different things for a CB vs a ST.
        </p>
        <div className="flex items-center gap-3 pt-1">
          <span className="text-[8px] font-mono text-muted-foreground/35 uppercase tracking-wider">Min appearances:</span>
          {[1, 2, 3, 5].map(n => (
            <button key={n} onClick={() => setMinApps(n)}
              className={`px-2 py-0.5 text-[8px] font-mono border transition-all ${
                minApps === n
                  ? "border-primary/50 text-primary bg-primary/10"
                  : "border-border/30 text-muted-foreground/40 hover:text-muted-foreground/70"
              }`}>
              {n}+
            </button>
          ))}
        </div>
      </div>

      {/* Team insight banners */}
      <div className="grid grid-cols-2 gap-3">
        <TeamInsightBanner
          players={home.players}
          totalMatches={totalMatchesHome}
          teamName={fixture.homeTeam.name}
          teamColor={fixture.homeTeam.colorPrimary}
        />
        <TeamInsightBanner
          players={away.players}
          totalMatches={totalMatchesAway}
          teamName={fixture.awayTeam.name}
          teamColor={fixture.awayTeam.colorPrimary}
        />
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 text-[8px] font-mono">
        {(["STRONG","MIXED","WEAK","LIMITED"] as ProfileRating[]).map(r => {
          const rc = RATING_CONFIG[r];
          return (
            <div key={r} className={`flex items-center gap-1 ${rc.color}`}>
              {rc.icon}<span className="uppercase tracking-wider">{r}</span>
            </div>
          );
        })}
        <div className="flex-1" />
        <span className="text-muted-foreground/25">all values per 90 unless noted</span>
      </div>

      {/* Position tabs */}
      <div className="flex gap-0 border border-border/40">
        {POS_TABS.map(pt => {
          const hCount = home.players.filter(p => classifyPosition(p.position) === pt && p.appearances >= minApps).length;
          const aCount = away.players.filter(p => classifyPosition(p.position) === pt && p.appearances >= minApps).length;
          return (
            <button key={pt} onClick={() => setPosTab(pt)}
              className={`flex-1 py-2 text-[10px] font-mono uppercase tracking-widest transition-all border-r border-border/30 last:border-r-0 ${
                posTab === pt ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground"
              }`}>
              <div>{pt}</div>
              <div className="text-[7px] mt-0.5 opacity-60">{hCount}/{aCount}</div>
            </button>
          );
        })}
      </div>

      {/* Position section */}
      <AnimatePresence mode="wait">
        <motion.div key={posTab}
          initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}>
          <PositionSection
            pos={posTab}
            homePlayers={filterAndSort(home.players, posTab, totalMatchesHome)}
            awayPlayers={filterAndSort(away.players, posTab, totalMatchesAway)}
            homeTeam={fixture.homeTeam}
            awayTeam={fixture.awayTeam}
            totalMatches={Math.max(totalMatchesHome, totalMatchesAway)}
          />
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
