/**
 * Futuristic Data Wizard Analysis Modal
 * Pure data interpretation — no odds, no ML.
 * Inspired by the "Futuristic Data Wizard Analysis & Prediction Engine" design.
 */
import React, { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  X, TrendingUp, TrendingDown, Minus,
  Star, Shield, Zap, Target, BarChart3,
  ChevronUp, ChevronDown, Activity,
} from "lucide-react";

// ── Types (mirror backend WizardOutput) ───────────────────────────────────────

interface DnaScan {
  formRating: number; attackPower: number; defensiveStability: number;
  momentumIndex: number; adaptationScore: number; recoveryAfterDefeat: number;
  goalThreatIndex: number; matchControlRating: number;
}
interface GoalInsight {
  allTimeAvg: number; last5Avg: number;
  trend: "above" | "below" | "stable"; trendPct: number; prediction: string;
}
interface GoalImpact {
  scored: number; scoredPg: number; conceded: number; concededPg: number;
  cleanSheets: number; cleanSheetPct: number;
  btts: number; bttsPct: number; over25: number; over25Pct: number; totalGames: number;
}
interface GoalEvolution {
  goalsScored: number; goalsConceded: number;
  attackEvolution: number; defenseEvolution: number;
  netTrend: "improving" | "declining" | "stable";
}
interface OvertuneEngine {
  adaptationLevel: number; overtuneCapacity: number; undertuneRisk: number; notes: string[];
}
interface StatRow { label: string; allAvg: number; last5Avg: number; rating: number; impact: number; adjustment: number; }
interface DynamicRating { overall: number; form: number; attack: number; defense: number; psychology: number; momentum: number; adaptation: number; recovery: number; }
interface WizardTeam {
  name: string; formRating: number; form: ("W"|"D"|"L")[];
  dnaScan: DnaScan; goalInsight: GoalInsight; goalImpact: GoalImpact;
  goalEvolution: GoalEvolution; overtuneEngine: OvertuneEngine; pressureScore: number;
  dynamicRating: DynamicRating; statRows: StatRow[];
  strengths: string[]; weaknesses: string[];
}
interface SimulationResult {
  homeWin: number; draw: number; awayWin: number; bttsYes: number;
  over25: number; under35: number; doubleChanceX2: number; doubleChance1X: number; sims: number;
}
interface WizardVerdict {
  recommendation: string; edge: "home"|"away"|"draw"|"x2"; confidenceLevel: number;
  advantages: Array<{ team: "home"|"away"; label: string }>;
  wizardPrediction: string;
}
interface WizardMatchup {
  simulation: SimulationResult; mostLikelyScores: Array<{home: number; away: number; prob: number}>;
  lambdaHome: number; lambdaAway: number; verdict: WizardVerdict;
}
interface WizardOutput {
  dataSource: "statshub"|"betexplorer"|"minimal";
  homeTeam: WizardTeam; awayTeam: WizardTeam; matchup: WizardMatchup; generatedAt: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function pct(v: number) { return `${Math.round(v * 100)}%`; }
function sgn(v: number) { return v > 0 ? `+${v.toFixed(1)}` : `${v.toFixed(1)}`; }

// ── Sub-components ────────────────────────────────────────────────────────────

function FormBadge({ r }: { r: "W"|"D"|"L" }) {
  const cfg = r === "W" ? "bg-green-500 text-white" : r === "D" ? "bg-yellow-500 text-black" : "bg-red-500 text-white";
  return <span className={`w-5 h-5 flex items-center justify-center text-[9px] font-bold font-mono ${cfg}`}>{r}</span>;
}

function CircleGauge({ value, size = 96, primary = "#00ffff" }: { value: number; size?: number; primary?: string }) {
  const clamped = Math.min(100, Math.max(0, value));
  const deg = Math.round((clamped / 100) * 360);
  const inner = size - 14;
  return (
    <div
      className="rounded-full flex-shrink-0 relative"
      style={{ width: size, height: size, background: `conic-gradient(${primary} ${deg}deg, #0f172a ${deg}deg)` }}
    >
      <div
        className="rounded-full absolute inset-[7px] bg-[#020810] flex items-center justify-center flex-col"
        style={{ boxShadow: "inset 0 0 8px rgba(0,0,0,0.8)" }}
      >
        <span className="text-white font-bold font-mono leading-none" style={{ fontSize: Math.round(inner * 0.28) }}>
          {Math.round(value)}
        </span>
        <span style={{ fontSize: 8, color: primary, fontFamily: "monospace" }}>/100</span>
      </div>
    </div>
  );
}

function DnaBar({ label, value, color = "#00ffff" }: { label: string; value: number; color?: string }) {
  return (
    <div className="flex items-center gap-2 py-0.5">
      <span className="text-[9px] font-mono text-slate-400 uppercase tracking-wide w-36 truncate flex-shrink-0">{label}</span>
      <div className="flex-1 h-2 bg-slate-800 relative overflow-hidden">
        <div className="absolute inset-y-0 left-0 transition-all" style={{ width: `${value}%`, background: color }} />
      </div>
      <span className="text-[10px] font-mono font-bold w-6 text-right" style={{ color }}>{Math.round(value)}</span>
    </div>
  );
}

function ImpactBar({ value, max = 100 }: { value: number; max?: number }) {
  const norm = Math.abs(value / max) * 100;
  const color = value > 0 ? "#22c55e" : value < 0 ? "#ef4444" : "#64748b";
  return (
    <div className="flex items-center gap-1">
      {value < 0 && <div className="h-1.5 transition-all" style={{ width: `${Math.min(norm, 50)}%`, background: color }} />}
      <div className="w-px h-2 bg-slate-600" />
      {value > 0 && <div className="h-1.5 transition-all" style={{ width: `${Math.min(norm, 50)}%`, background: color }} />}
    </div>
  );
}

function TrendIcon({ v }: { v: number }) {
  if (v > 5)  return <TrendingUp  className="w-3 h-3 text-green-400" />;
  if (v < -5) return <TrendingDown className="w-3 h-3 text-red-400" />;
  return <Minus className="w-3 h-3 text-slate-500" />;
}

// Hexagonal SVG radar
function RadarHex({ data, labels, color, size = 120 }: {
  data: number[]; labels: string[]; color: string; size?: number;
}) {
  const n = data.length;
  const cx = size / 2, cy = size / 2, r = size * 0.42;
  const angle = (i: number) => (i / n) * 2 * Math.PI - Math.PI / 2;
  const pt = (val: number, i: number) => ({
    x: cx + (val / 100) * r * Math.cos(angle(i)),
    y: cy + (val / 100) * r * Math.sin(angle(i)),
  });
  const bgPt = (i: number) => ({ x: cx + r * Math.cos(angle(i)), y: cy + r * Math.sin(angle(i)) });
  const toStr = (pts: {x:number;y:number}[]) => pts.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const dataPoints = data.map((v, i) => pt(v, i));
  const bgPoints  = Array.from({ length: n }, (_, i) => bgPt(i));
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="overflow-visible">
      {[0.33, 0.67, 1].map(s => (
        <polygon key={s} points={toStr(bgPoints.map(p => ({ x: cx + (p.x-cx)*s, y: cy + (p.y-cy)*s })))}
          fill="none" stroke="rgba(0,255,255,0.08)" strokeWidth={0.8} />
      ))}
      {bgPoints.map((p, i) => (
        <line key={i} x1={cx} y1={cy} x2={p.x} y2={p.y} stroke="rgba(0,255,255,0.08)" strokeWidth={0.8} />
      ))}
      <polygon points={toStr(dataPoints)} fill={`${color}22`} stroke={color} strokeWidth={1.5} />
      {dataPoints.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r={2} fill={color} />)}
      {labels.map((lbl, i) => {
        const bp = bgPt(i);
        const ox = (bp.x - cx) * 0.25, oy = (bp.y - cy) * 0.25;
        return (
          <text key={i} x={bp.x + ox} y={bp.y + oy + 1}
            textAnchor="middle" dominantBaseline="middle"
            fontSize={7} fill="rgba(148,163,184,0.8)" fontFamily="monospace">
            {lbl}
          </text>
        );
      })}
    </svg>
  );
}

function GoalInsightBadge({ insight, side }: { insight: GoalInsight; side: "left"|"right" }) {
  const trendColor = insight.trend === "above" ? "#22c55e" : insight.trend === "below" ? "#ef4444" : "#94a3b8";
  const trendBg    = insight.trend === "above" ? "rgba(34,197,94,0.08)" : insight.trend === "below" ? "rgba(239,68,68,0.08)" : "rgba(148,163,184,0.05)";
  const arrow      = insight.trend === "above" ? "↑" : insight.trend === "below" ? "↓" : "→";
  return (
    <div className="border p-2 space-y-1.5" style={{ borderColor: trendColor + "40", background: trendBg }}>
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[8px] font-mono text-slate-500 uppercase tracking-widest">Goal Output</span>
        <span className="text-[9px] font-mono font-bold" style={{ color: trendColor }}>
          {arrow} {sgn(insight.trendPct)}%
        </span>
      </div>
      <div className="flex items-center gap-3 flex-wrap">
        <div>
          <div className="text-[8px] text-slate-600 font-mono">ALL-TIME</div>
          <div className="text-base font-bold font-mono text-white">{insight.allTimeAvg.toFixed(2)}</div>
        </div>
        <div className="text-[10px] text-slate-600">→</div>
        <div>
          <div className="text-[8px] text-slate-600 font-mono">LAST 5</div>
          <div className="text-base font-bold font-mono" style={{ color: trendColor }}>{insight.last5Avg.toFixed(2)}</div>
        </div>
      </div>
      <p className="text-[8px] font-mono leading-tight" style={{ color: trendColor }}>
        {insight.prediction}
      </p>
    </div>
  );
}

// ── Team panel ────────────────────────────────────────────────────────────────

function TeamPanel({ team, color, side }: { team: WizardTeam; color: string; side: "left"|"right" }) {
  const isSH = team.statRows.length > 3;
  const dnaTrait = (label: string, val: number) => {
    const col = val >= 65 ? "#22c55e" : val >= 45 ? "#f59e0b" : "#ef4444";
    const delta = val - 50;
    return { label, val, col, delta };
  };

  const traits = [
    dnaTrait("Attack Trend",      team.dnaScan.attackPower),
    dnaTrait("Defense Trend",     team.dnaScan.defensiveStability),
    dnaTrait("Consistency",       team.dnaScan.adaptationScore),
    dnaTrait("Comeback Ability",  team.dnaScan.recoveryAfterDefeat),
    dnaTrait("Big Match Impact",  team.dnaScan.goalThreatIndex),
    dnaTrait("Momentum",          team.dnaScan.momentumIndex),
  ];

  return (
    <div className="flex flex-col gap-3 min-w-0">
      {/* Form rating + traits */}
      <div className="border border-cyan-500/15 bg-slate-900/60 p-3 space-y-3">
        <div className="text-[8px] font-mono text-cyan-400/70 uppercase tracking-[0.2em] text-center">Team Form Rating</div>
        <div className="flex items-center gap-3">
          <CircleGauge value={team.formRating} size={80} primary={color} />
          <div className="flex-1 space-y-1">
            {traits.map(t => (
              <div key={t.label} className="flex items-center gap-1.5">
                <Star className="w-2.5 h-2.5 flex-shrink-0" style={{ color }} />
                <span className="text-[8px] font-mono text-slate-400 flex-1 truncate">{t.label}</span>
                <span className="text-[9px] font-mono font-bold" style={{ color: t.col }}>{Math.round(t.val)}</span>
                <span className="text-[8px] font-mono" style={{ color: t.delta > 0 ? "#22c55e" : "#ef4444" }}>
                  {t.delta > 0 ? "+" : ""}{Math.round(t.delta)}
                </span>
              </div>
            ))}
          </div>
        </div>
        {/* Form badges */}
        <div>
          <div className="text-[8px] font-mono text-slate-600 uppercase mb-1">Last {team.form.length} Matches</div>
          <div className="flex gap-1 flex-wrap">
            {team.form.map((r, i) => <FormBadge key={i} r={r} />)}
          </div>
        </div>
      </div>

      {/* Goal insight */}
      <GoalInsightBadge insight={team.goalInsight} side={side} />

      {/* Goal impact */}
      <div className="border border-slate-700/50 bg-slate-900/40 p-2 space-y-1">
        <div className="text-[8px] font-mono text-slate-500 uppercase tracking-widest mb-1.5">Goal Impact</div>
        {[
          { label: "Scored", val: `${team.goalImpact.scored} (${team.goalImpact.scoredPg.toFixed(2)}p/g)`, positive: true },
          { label: "Conceded", val: `${team.goalImpact.conceded} (${team.goalImpact.concededPg.toFixed(2)}p/g)`, positive: false },
          { label: "Clean Sheets", val: `${team.goalImpact.cleanSheets} (${team.goalImpact.cleanSheetPct}%)`, positive: team.goalImpact.cleanSheetPct >= 25 },
          { label: "BTTS", val: `${team.goalImpact.btts}/${team.goalImpact.totalGames} (${team.goalImpact.bttsPct}%)`, positive: false },
          { label: "Over 2.5", val: `${team.goalImpact.over25}/${team.goalImpact.totalGames} (${team.goalImpact.over25Pct}%)`, positive: null },
        ].map(row => (
          <div key={row.label} className="flex justify-between items-center">
            <span className="text-[8px] font-mono text-slate-500">{row.label}</span>
            <span className="text-[9px] font-mono" style={{
              color: row.positive === true ? "#22c55e" : row.positive === false ? "#ef4444" : "#94a3b8"
            }}>{row.val}</span>
          </div>
        ))}
      </div>

      {/* Strengths / Weaknesses */}
      <div className="border border-slate-700/50 bg-slate-900/40 p-2 space-y-2">
        <div className="grid grid-cols-2 gap-2">
          <div>
            <div className="text-[8px] font-mono text-green-400/70 uppercase tracking-widest mb-1">Strengths</div>
            {team.strengths.map((s, i) => (
              <div key={i} className="flex items-start gap-1 mb-0.5">
                <span className="text-green-400 text-[8px] mt-0.5">✓</span>
                <span className="text-[8px] font-mono text-slate-400 leading-tight">{s}</span>
              </div>
            ))}
            {!team.strengths.length && <span className="text-[8px] text-slate-600 font-mono">—</span>}
          </div>
          <div>
            <div className="text-[8px] font-mono text-red-400/70 uppercase tracking-widest mb-1">Weaknesses</div>
            {team.weaknesses.map((w, i) => (
              <div key={i} className="flex items-start gap-1 mb-0.5">
                <span className="text-red-400 text-[8px] mt-0.5">✗</span>
                <span className="text-[8px] font-mono text-slate-400 leading-tight">{w}</span>
              </div>
            ))}
            {!team.weaknesses.length && <span className="text-[8px] text-slate-600 font-mono">—</span>}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Center panel ──────────────────────────────────────────────────────────────

function CenterPanel({ output }: { output: WizardOutput }) {
  const { homeTeam: h, awayTeam: a, matchup: m } = output;
  const sim = m.simulation;

  // Build merged stat rows (pair by label)
  const homeMap = new Map(h.statRows.map(r => [r.label.toLowerCase(), r]));
  const awayMap = new Map(a.statRows.map(r => [r.label.toLowerCase(), r]));
  const allLabels = Array.from(new Set([...homeMap.keys(), ...awayMap.keys()])).slice(0, 14);

  return (
    <div className="flex flex-col gap-3 min-w-0">
      {/* Performance scores */}
      <div className="border border-cyan-500/15 bg-slate-900/60 p-2">
        <div className="text-[8px] font-mono text-cyan-400/60 uppercase tracking-widest text-center mb-2">Key Performance Stats (avg per game)</div>
        <div className="grid grid-cols-3 gap-1 text-[8px] font-mono text-slate-500 mb-1 px-1">
          <span className="text-cyan-400/60 font-bold">{h.name.slice(0,12)}</span>
          <span className="text-center uppercase tracking-widest">Stat Category</span>
          <span className="text-right text-cyan-400/60 font-bold">{a.name.slice(0,12)}</span>
        </div>
        <div className="space-y-0.5 max-h-52 overflow-y-auto scrollbar-thin">
          {allLabels.map(lbl => {
            const hr = homeMap.get(lbl);
            const ar = awayMap.get(lbl);
            const hv = hr?.allAvg ?? 0;
            const av = ar?.allAvg ?? 0;
            const hBetter = hv > av;
            return (
              <div key={lbl} className="grid grid-cols-3 gap-1 items-center py-0.5 border-b border-slate-800/50">
                <div className="flex items-center gap-1">
                  <span className={`text-[9px] font-mono font-bold ${hBetter ? "text-cyan-300" : "text-slate-400"}`}>{hv.toFixed(2)}</span>
                  {hr && <span className="text-[7px]" style={{ color: hr.impact > 0 ? "#22c55e" : hr.impact < 0 ? "#ef4444" : "#475569" }}>
                    {hr.impact > 0 ? "▲" : hr.impact < 0 ? "▼" : "—"}
                  </span>}
                </div>
                <span className="text-[7px] font-mono text-slate-500 text-center uppercase leading-tight">{lbl}</span>
                <div className="flex items-center gap-1 justify-end">
                  {ar && <span className="text-[7px]" style={{ color: ar.impact > 0 ? "#22c55e" : ar.impact < 0 ? "#ef4444" : "#475569" }}>
                    {ar.impact > 0 ? "▲" : ar.impact < 0 ? "▼" : "—"}
                  </span>}
                  <span className={`text-[9px] font-mono font-bold ${!hBetter && av > 0 ? "text-cyan-300" : "text-slate-400"}`}>{av.toFixed(2)}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Expected goals */}
      <div className="border border-slate-700/50 bg-slate-900/40 p-2">
        <div className="text-[8px] font-mono text-slate-500 uppercase tracking-widest mb-1.5 text-center">Expected Goals (Poisson)</div>
        <div className="flex justify-around items-center">
          <div className="text-center">
            <div className="text-xl font-bold font-mono text-cyan-300">{m.lambdaHome.toFixed(2)}</div>
            <div className="text-[7px] text-slate-500 font-mono">λ Home</div>
          </div>
          <div className="text-slate-600 font-mono">vs</div>
          <div className="text-center">
            <div className="text-xl font-bold font-mono text-cyan-300">{m.lambdaAway.toFixed(2)}</div>
            <div className="text-[7px] text-slate-500 font-mono">λ Away</div>
          </div>
        </div>
      </div>

      {/* AI Match Simulation */}
      <div className="border border-cyan-500/15 bg-slate-900/60 p-2">
        <div className="text-[8px] font-mono text-cyan-400/60 uppercase tracking-widest text-center mb-2">
          AI Match Simulation ({(sim.sims / 1000).toFixed(0)}k sims)
        </div>
        <div className="flex justify-around items-end gap-1">
          <div className="text-center">
            <div className="text-2xl font-bold font-mono text-cyan-400">{Math.round(sim.homeWin * 100)}%</div>
            <div className="text-[7px] text-slate-500 font-mono uppercase tracking-widest mt-0.5">{h.name.slice(0,8)}</div>
            <div className="text-[7px] text-cyan-400/60 font-mono">WIN</div>
          </div>
          <div className="text-center">
            <div className="text-xl font-bold font-mono text-yellow-400">{Math.round(sim.draw * 100)}%</div>
            <div className="text-[7px] text-slate-500 font-mono uppercase tracking-widest mt-0.5">Draw</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold font-mono text-purple-400">{Math.round(sim.awayWin * 100)}%</div>
            <div className="text-[7px] text-slate-500 font-mono uppercase tracking-widest mt-0.5">{a.name.slice(0,8)}</div>
            <div className="text-[7px] text-purple-400/60 font-mono">WIN</div>
          </div>
        </div>
        {/* Sim bar */}
        <div className="mt-2 h-3 flex rounded-sm overflow-hidden">
          <div className="bg-cyan-400/80" style={{ width: pct(sim.homeWin) }} />
          <div className="bg-yellow-400/80" style={{ width: pct(sim.draw) }} />
          <div className="bg-purple-400/80" style={{ width: pct(sim.awayWin) }} />
        </div>
      </div>

      {/* Most likely scores */}
      <div className="border border-slate-700/50 bg-slate-900/40 p-2">
        <div className="text-[8px] font-mono text-slate-500 uppercase tracking-widest mb-1.5">Most Likely Scores</div>
        <div className="space-y-0.5">
          {m.mostLikelyScores.slice(0, 6).map((s, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="text-[8px] font-mono text-slate-600 w-3">{i+1}.</span>
              <span className="text-[10px] font-mono font-bold text-white w-8">{s.home} – {s.away}</span>
              <div className="flex-1 h-1 bg-slate-800 overflow-hidden">
                <div className="h-full bg-cyan-400/60" style={{ width: `${Math.min(s.prob * 800, 100)}%` }} />
              </div>
              <span className="text-[8px] font-mono text-slate-400 w-10 text-right">({(s.prob * 100).toFixed(1)}%)</span>
            </div>
          ))}
        </div>
      </div>

      {/* Betting-style insights (data-derived, no odds) */}
      <div className="border border-slate-700/50 bg-slate-900/40 p-2">
        <div className="text-[8px] font-mono text-slate-500 uppercase tracking-widest mb-1.5">Data Insights</div>
        {[
          { label: "BTTS YES", val: Math.round(sim.bttsYes * 100), threshold: 55, positive: true },
          { label: "OVER 2.5 Goals", val: Math.round(sim.over25 * 100), threshold: 52, positive: true },
          { label: "UNDER 3.5 Goals", val: Math.round(sim.under35 * 100), threshold: 55, positive: true },
          { label: "Double Chance X2", val: Math.round(sim.doubleChanceX2 * 100), threshold: 65, positive: true },
          { label: "Double Chance 1X", val: Math.round(sim.doubleChance1X * 100), threshold: 65, positive: true },
        ].map(row => (
          <div key={row.label} className="flex justify-between items-center py-0.5">
            <span className="text-[8px] font-mono text-slate-500">{row.label}</span>
            <div className="flex items-center gap-1.5">
              <span className="text-[9px] font-mono font-bold text-slate-300">{row.val}%</span>
              <span className={`text-[7px] font-mono font-bold px-1 ${row.val >= row.threshold ? "bg-green-500/20 text-green-400" : "bg-red-500/10 text-red-400/60"}`}>
                {row.val >= row.threshold ? "YES" : "NO"}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Bottom: DNA scan, overtune, pressure, radar, verdict ─────────────────────

function BottomSection({ output }: { output: WizardOutput }) {
  const { homeTeam: h, awayTeam: a, matchup: m } = output;
  const v = m.verdict;

  const verdictColor = v.edge === "home" ? "#00ffff" : v.edge === "away" ? "#a855f7" : "#f59e0b";
  const edgeTeam = v.edge === "home" ? h.name : v.edge === "away" ? a.name : "Draw";

  const radarH = [h.dynamicRating.form, h.dynamicRating.attack, h.dynamicRating.defense, h.dynamicRating.psychology, h.dynamicRating.momentum, h.dynamicRating.adaptation];
  const radarA = [a.dynamicRating.form, a.dynamicRating.attack, a.dynamicRating.defense, a.dynamicRating.psychology, a.dynamicRating.momentum, a.dynamicRating.adaptation];
  const radarLabels = ["FORM", "ATTACK", "DEF", "PSYCH", "MOM", "ADAPT"];

  const dnaH: Array<[string, number]> = [
    ["Form Rating",         h.dnaScan.formRating],
    ["Attack Power",        h.dnaScan.attackPower],
    ["Def. Stability",      h.dnaScan.defensiveStability],
    ["Momentum Index",      h.dnaScan.momentumIndex],
    ["Adaptation Score",    h.dnaScan.adaptationScore],
    ["Recovery / Defeat",   h.dnaScan.recoveryAfterDefeat],
    ["Goal Threat Index",   h.dnaScan.goalThreatIndex],
    ["Match Control",       h.dnaScan.matchControlRating],
  ];
  const dnaA: Array<[string, number]> = [
    ["Form Rating",         a.dnaScan.formRating],
    ["Attack Power",        a.dnaScan.attackPower],
    ["Def. Stability",      a.dnaScan.defensiveStability],
    ["Momentum Index",      a.dnaScan.momentumIndex],
    ["Adaptation Score",    a.dnaScan.adaptationScore],
    ["Recovery / Defeat",   a.dnaScan.recoveryAfterDefeat],
    ["Goal Threat Index",   a.dnaScan.goalThreatIndex],
    ["Match Control",       a.dnaScan.matchControlRating],
  ];

  const confidenceStars = Math.round((v.confidenceLevel / 100) * 5);

  return (
    <div className="space-y-4">
      {/* DNA Scan + Overtune side-by-side */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {/* Home DNA */}
        <div className="border border-cyan-500/15 bg-slate-900/60 p-3">
          <div className="text-[8px] font-mono text-cyan-400/60 uppercase tracking-widest mb-2">
            Team DNA Scan — {h.name}
          </div>
          {dnaH.map(([lbl, v]) => <DnaBar key={lbl} label={lbl} value={v} color="#00e5ff" />)}
        </div>
        {/* Away DNA */}
        <div className="border border-purple-500/15 bg-slate-900/60 p-3">
          <div className="text-[8px] font-mono text-purple-400/60 uppercase tracking-widest mb-2">
            Team DNA Scan — {a.name}
          </div>
          {dnaA.map(([lbl, v]) => <DnaBar key={lbl} label={lbl} value={v} color="#a855f7" />)}
        </div>
      </div>

      {/* Overtune + Pressure + Radar + Verdict */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-3">
        {/* Home overtune */}
        <div className="border border-cyan-500/15 bg-slate-900/60 p-3 space-y-2">
          <div className="text-[8px] font-mono text-cyan-400/60 uppercase tracking-widest">Overtune/Undertune Engine</div>
          <div className="flex items-center gap-2">
            <CircleGauge value={h.overtuneEngine.adaptationLevel} size={56} primary="#00e5ff" />
            <div className="flex-1 space-y-0.5">
              {h.overtuneEngine.notes.slice(0, 4).map((n, i) => (
                <div key={i} className="flex items-start gap-1">
                  <span className="text-[8px]" style={{ color: i < 2 ? "#22c55e" : "#ef4444" }}>{i < 2 ? "✓" : "✗"}</span>
                  <span className="text-[7px] font-mono text-slate-400 leading-tight">{n}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-1 text-center">
            <div>
              <div className="text-[7px] text-slate-600 font-mono">OVERTUNE CAP</div>
              <div className="text-[10px] font-bold font-mono text-green-400">{h.overtuneEngine.overtuneCapacity}%</div>
            </div>
            <div>
              <div className="text-[7px] text-slate-600 font-mono">UNDERTUNE RISK</div>
              <div className="text-[10px] font-bold font-mono text-red-400">{h.overtuneEngine.undertuneRisk}%</div>
            </div>
          </div>
        </div>

        {/* Away overtune */}
        <div className="border border-purple-500/15 bg-slate-900/60 p-3 space-y-2">
          <div className="text-[8px] font-mono text-purple-400/60 uppercase tracking-widest">Overtune/Undertune Engine</div>
          <div className="flex items-center gap-2">
            <CircleGauge value={a.overtuneEngine.adaptationLevel} size={56} primary="#a855f7" />
            <div className="flex-1 space-y-0.5">
              {a.overtuneEngine.notes.slice(0, 4).map((n, i) => (
                <div key={i} className="flex items-start gap-1">
                  <span className="text-[8px]" style={{ color: i < 2 ? "#22c55e" : "#ef4444" }}>{i < 2 ? "✓" : "✗"}</span>
                  <span className="text-[7px] font-mono text-slate-400 leading-tight">{n}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-1 text-center">
            <div>
              <div className="text-[7px] text-slate-600 font-mono">OVERTUNE CAP</div>
              <div className="text-[10px] font-bold font-mono text-green-400">{a.overtuneEngine.overtuneCapacity}%</div>
            </div>
            <div>
              <div className="text-[7px] text-slate-600 font-mono">UNDERTUNE RISK</div>
              <div className="text-[10px] font-bold font-mono text-red-400">{a.overtuneEngine.undertuneRisk}%</div>
            </div>
          </div>
        </div>

        {/* Dynamic rating radar */}
        <div className="border border-slate-700/50 bg-slate-900/40 p-3 space-y-2">
          <div className="text-[8px] font-mono text-slate-500 uppercase tracking-widest text-center">Dynamic Match Rating</div>
          <div className="flex justify-around items-center">
            <div className="text-center">
              <div className="text-lg font-bold font-mono text-cyan-400">{h.dynamicRating.overall}</div>
              <div className="text-[7px] text-slate-600 font-mono">/100</div>
              <RadarHex data={radarH} labels={radarLabels} color="#00e5ff" size={100} />
              <div className="text-[7px] text-slate-500 font-mono mt-0.5">{h.name.slice(0,10)}</div>
            </div>
            <div className="text-center">
              <div className="text-lg font-bold font-mono text-purple-400">{a.dynamicRating.overall}</div>
              <div className="text-[7px] text-slate-600 font-mono">/100</div>
              <RadarHex data={radarA} labels={radarLabels} color="#a855f7" size={100} />
              <div className="text-[7px] text-slate-500 font-mono mt-0.5">{a.name.slice(0,10)}</div>
            </div>
          </div>
        </div>

        {/* Wizard verdict */}
        <div className="border bg-slate-900/60 p-3 space-y-2" style={{ borderColor: verdictColor + "40" }}>
          <div className="text-[8px] font-mono uppercase tracking-widest" style={{ color: verdictColor }}>
            Data Wizard Verdict
          </div>
          <div className="space-y-1">
            {v.advantages.slice(0, 4).map((adv, i) => (
              <div key={i} className="flex items-center justify-between">
                <span className="text-[8px] font-mono text-slate-500">{adv.label}</span>
                <span className="text-[8px] font-mono font-bold"
                  style={{ color: adv.team === "home" ? "#00e5ff" : "#a855f7" }}>
                  {adv.team === "home" ? h.name.slice(0, 10) : a.name.slice(0, 10)}
                </span>
              </div>
            ))}
            {v.advantages.length === 0 && (
              <div className="text-[8px] font-mono text-slate-600">Evenly matched on all dimensions</div>
            )}
          </div>
          <div className="border-t border-slate-700/50 pt-2 space-y-1">
            <div className="text-[8px] font-mono text-slate-500">Overall Data Wizard Rating</div>
            <div className="flex items-center justify-around">
              <div className="text-center">
                <div className="text-base font-bold font-mono text-cyan-400">{h.dynamicRating.overall}</div>
                <div className="text-[7px] text-slate-600 font-mono">/100</div>
              </div>
              <div className="text-[8px] text-slate-600 font-mono">vs</div>
              <div className="text-center">
                <div className="text-base font-bold font-mono text-purple-400">{a.dynamicRating.overall}</div>
                <div className="text-[7px] text-slate-600 font-mono">/100</div>
              </div>
            </div>
          </div>
          <div className="border-t border-slate-700/50 pt-2">
            <div className="text-[7px] font-mono text-slate-600 mb-1">Edge · Confidence Level</div>
            <div className="font-mono font-bold text-[10px]" style={{ color: verdictColor }}>{edgeTeam}</div>
            <div className="flex gap-0.5 mt-1">
              {Array.from({ length: 5 }, (_, i) => (
                <Star key={i} className="w-3 h-3" style={{ color: i < confidenceStars ? "#fbbf24" : "#1e293b", fill: i < confidenceStars ? "#fbbf24" : "none" }} />
              ))}
              <span className="text-[9px] font-mono text-slate-500 ml-1">{v.confidenceLevel}%</span>
            </div>
          </div>
        </div>
      </div>

      {/* Goal evolution matrix */}
      <div className="grid grid-cols-2 gap-3">
        {[{ t: h, color: "#00e5ff" }, { t: a, color: "#a855f7" }].map(({ t, color }) => (
          <div key={t.name} className="border border-slate-700/50 bg-slate-900/40 p-3">
            <div className="text-[8px] font-mono uppercase tracking-widest mb-2" style={{ color }}>
              Goal Evolution Matrix — {t.name}
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className="text-[7px] text-slate-600 font-mono">Goals Scored</div>
                <div className="text-xl font-bold font-mono" style={{ color }}>{t.goalEvolution.goalsScored}</div>
                <div className="flex items-center gap-1 mt-0.5">
                  <TrendIcon v={t.goalEvolution.attackEvolution} />
                  <span className="text-[8px] font-mono" style={{ color: t.goalEvolution.attackEvolution >= 0 ? "#22c55e" : "#ef4444" }}>
                    Attack Evolution {sgn(t.goalEvolution.attackEvolution)}%
                  </span>
                </div>
              </div>
              <div>
                <div className="text-[7px] text-slate-600 font-mono">Goals Conceded</div>
                <div className="text-xl font-bold font-mono text-slate-300">{t.goalEvolution.goalsConceded}</div>
                <div className="flex items-center gap-1 mt-0.5">
                  <TrendIcon v={t.goalEvolution.defenseEvolution} />
                  <span className="text-[8px] font-mono" style={{ color: t.goalEvolution.defenseEvolution >= 0 ? "#22c55e" : "#ef4444" }}>
                    Defense Evolution {sgn(t.goalEvolution.defenseEvolution)}%
                  </span>
                </div>
              </div>
            </div>
            <div className="mt-2 pt-1 border-t border-slate-800">
              <span className="text-[8px] font-mono text-slate-500 uppercase">Net Trend: </span>
              <span className="text-[8px] font-mono font-bold" style={{
                color: t.goalEvolution.netTrend === "improving" ? "#22c55e" : t.goalEvolution.netTrend === "declining" ? "#ef4444" : "#94a3b8"
              }}>{t.goalEvolution.netTrend.toUpperCase()}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Pressure response */}
      <div className="grid grid-cols-2 gap-3">
        {[{ t: h, color: "#00e5ff" }, { t: a, color: "#a855f7" }].map(({ t, color }) => (
          <div key={t.name} className="border border-slate-700/50 bg-slate-900/40 p-3 flex items-center gap-3">
            <CircleGauge value={t.pressureScore} size={64} primary={color} />
            <div className="flex-1">
              <div className="text-[7px] font-mono uppercase tracking-widest mb-0.5" style={{ color }}>Pressure Response</div>
              <div className="text-[8px] font-mono text-slate-400">{t.name}</div>
              <div className="text-[9px] font-mono font-bold mt-1" style={{ color }}>
                {t.pressureScore >= 70 ? "High resilience" : t.pressureScore >= 50 ? "Moderate recovery" : "Low resilience"}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Main Modal ────────────────────────────────────────────────────────────────

interface WizardModalProps {
  fetchUrl: string;
  homeTeam: string;
  awayTeam: string;
  onClose: () => void;
}

export default function WizardModal({ fetchUrl, homeTeam, awayTeam, onClose }: WizardModalProps) {
  const [output, setOutput] = useState<WizardOutput | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]   = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetch(fetchUrl)
      .then(r => r.ok ? r.json() : r.json().then((e: {error?: string}) => Promise.reject(e.error ?? "Failed")))
      .then(d => { setOutput(d as WizardOutput); setLoading(false); })
      .catch(e => { setError(String(e)); setLoading(false); });
  }, [fetchUrl]);

  const v = output?.matchup.verdict;
  const verdictColor = !v ? "#00ffff" : v.edge === "home" ? "#00e5ff" : v.edge === "away" ? "#a855f7" : "#f59e0b";

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/90 backdrop-blur-sm overflow-y-auto"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <motion.div
        initial={{ scale: 0.97, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.97, opacity: 0 }}
        transition={{ duration: 0.2 }}
        className="relative w-full max-w-7xl mx-4 my-4"
        style={{
          background: "#020810",
          border: `1px solid ${verdictColor}30`,
          boxShadow: `0 0 40px ${verdictColor}15, 0 0 80px rgba(0,0,0,0.8)`,
        }}
      >
        {/* Scan line overlay */}
        <div className="absolute inset-0 pointer-events-none overflow-hidden opacity-5" style={{
          backgroundImage: "repeating-linear-gradient(0deg, transparent, transparent 3px, rgba(0,255,255,0.15) 3px, rgba(0,255,255,0.15) 4px)",
        }} />

        {/* Header */}
        <div className="relative border-b border-cyan-500/20 p-4 text-center">
          <div className="absolute top-3 right-3">
            <button onClick={onClose} className="w-7 h-7 flex items-center justify-center border border-slate-700 text-slate-500 hover:text-white hover:border-red-500/50 transition-all">
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="text-[9px] font-mono tracking-[0.3em] uppercase mb-1" style={{ color: "#00e5ff", textShadow: "0 0 8px #00e5ff80" }}>
            Futuristic Data Wizard Analysis &amp; Prediction Engine
          </div>
          <div className="text-[7px] font-mono text-slate-600 tracking-[0.2em] uppercase mb-2">
            Deep Data · Adaptation · Ratings · AI Simulation · {output?.dataSource ? `Source: ${output.dataSource.toUpperCase()}` : ""}
          </div>
          <h2 className="text-lg font-bold font-mono tracking-widest uppercase" style={{ textShadow: "0 0 12px rgba(0,255,255,0.3)" }}>
            <span className="text-cyan-300">{homeTeam}</span>
            <span className="text-slate-500 mx-3">vs</span>
            <span className="text-purple-300">{awayTeam}</span>
          </h2>
        </div>

        {/* Body */}
        <div className="p-4">
          {loading && (
            <div className="flex items-center justify-center gap-3 py-20 text-cyan-400/60">
              <Activity className="w-5 h-5 animate-pulse" />
              <span className="text-[10px] font-mono uppercase tracking-widest">Analyzing 10,000 simulations…</span>
            </div>
          )}

          {error && (
            <div className="py-10 text-center">
              <div className="text-red-400 font-mono text-sm">{error}</div>
            </div>
          )}

          {output && (
            <div className="space-y-4">
              {/* Main 3-col layout */}
              <div className="grid grid-cols-1 lg:grid-cols-[1fr_1.2fr_1fr] gap-4">
                <TeamPanel team={output.homeTeam} color="#00e5ff" side="left" />
                <CenterPanel output={output} />
                <TeamPanel team={output.awayTeam} color="#a855f7" side="right" />
              </div>

              {/* Bottom section */}
              <BottomSection output={output} />
            </div>
          )}
        </div>

        {/* Wizard prediction banner */}
        {output && (
          <div
            className="border-t p-4 text-center"
            style={{ borderColor: verdictColor + "40", background: verdictColor + "08" }}
          >
            <div className="text-[9px] font-mono text-slate-600 uppercase tracking-widest mb-1">Wizard Prediction</div>
            <div className="text-sm font-bold font-mono uppercase tracking-widest" style={{
              color: verdictColor,
              textShadow: `0 0 10px ${verdictColor}60`,
            }}>
              {output.matchup.verdict.wizardPrediction}
            </div>
            <div className="text-[8px] font-mono text-slate-500 mt-1">{output.matchup.verdict.recommendation}</div>
          </div>
        )}
      </motion.div>
    </motion.div>
  );
}
