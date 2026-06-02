import React, { useState, useRef } from "react";
import { useParams, useLocation } from "wouter";
import { format } from "date-fns";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowLeft, Activity, ChevronLeft, ChevronRight, Lock } from "lucide-react";
import { useGetFixtureDetail } from "@workspace/api-client-react";

// ─── Team stat tab definitions (exact StatHub order) ─────────────────────────

interface TeamStatDef {
  label: string;
  short: string;
  available: boolean;
  decimals: number;
  getValue?: (ts: TeamMatchStats, os: TeamMatchStats) => { ours: number; theirs: number };
}

const TEAM_STAT_TABS: TeamStatDef[] = [
  { label: "Goals",                  short: "Gls",  available: true,  decimals: 0, getValue: (ts,os) => ({ ours: ts.goals,             theirs: os.goals })           },
  { label: "Corners",                short: "Cor",  available: false, decimals: 0 },
  { label: "Shots",                  short: "Sh",   available: true,  decimals: 0, getValue: (ts,os) => ({ ours: ts.shots,             theirs: os.shots })           },
  { label: "Cards",                  short: "Crd",  available: true,  decimals: 0, getValue: (ts,os) => ({ ours: ts.yellowCards+ts.redCards, theirs: os.yellowCards+os.redCards }) },
  { label: "Crosses",                short: "Cr",   available: true,  decimals: 0, getValue: (ts,os) => ({ ours: ts.crosses,           theirs: os.crosses })         },
  { label: "Big Chance Created",     short: "BCC",  available: true,  decimals: 0, getValue: (ts,os) => ({ ours: ts.bigChancesCreated, theirs: os.bigChancesCreated }) },
  { label: "Big Chance Missed",      short: "BCM",  available: false, decimals: 0 },
  { label: "Big Chance Scored",      short: "BCS",  available: false, decimals: 0 },
  { label: "Expected Goals",         short: "xG",   available: true,  decimals: 2, getValue: (ts,os) => ({ ours: ts.xG,               theirs: os.xG })              },
  { label: "Shots On Goal",          short: "SoG",  available: true,  decimals: 0, getValue: (ts,os) => ({ ours: ts.shotsOnTarget,    theirs: os.shotsOnTarget })   },
  { label: "Shots Off Goal",         short: "SoFF", available: true,  decimals: 0, getValue: (ts,os) => ({ ours: ts.shotsOffTarget,   theirs: os.shotsOffTarget })  },
  { label: "Shots Inside Box",       short: "SIB",  available: false, decimals: 0 },
  { label: "Shots Outside Box",      short: "SOB",  available: false, decimals: 0 },
  { label: "Total Clearance",        short: "Clr",  available: true,  decimals: 0, getValue: (ts,os) => ({ ours: ts.clearances,       theirs: os.clearances })      },
  { label: "Dispossessed",           short: "Dis",  available: true,  decimals: 0, getValue: (ts,os) => ({ ours: ts.dispossessed,     theirs: os.dispossessed })    },
  { label: "Errors Lead To Goal",    short: "ELG",  available: false, decimals: 0 },
  { label: "Errors Lead To Shot",    short: "ELS",  available: false, decimals: 0 },
  { label: "Fouls",                  short: "Fls",  available: true,  decimals: 0, getValue: (ts,os) => ({ ours: ts.fouls,            theirs: os.fouls })           },
  { label: "Goalkeeper Saves",       short: "Sav",  available: true,  decimals: 0, getValue: (ts,os) => ({ ours: ts.saves,            theirs: os.saves })           },
  { label: "Interception Won",       short: "Int",  available: true,  decimals: 0, getValue: (ts,os) => ({ ours: ts.interceptions,    theirs: os.interceptions })   },
  { label: "Tackles",                short: "Tck",  available: true,  decimals: 0, getValue: (ts,os) => ({ ours: ts.tackles,          theirs: os.tackles })         },
  { label: "Free Kicks",             short: "FK",   available: false, decimals: 0 },
  { label: "Goal Kicks",             short: "GK",   available: false, decimals: 0 },
  { label: "Throw Ins",              short: "TI",   available: false, decimals: 0 },
  { label: "Possession",             short: "Pos",  available: false, decimals: 1 },
  { label: "Offsides",               short: "Off",  available: true,  decimals: 0, getValue: (ts,os) => ({ ours: ts.offsides,         theirs: os.offsides })        },
  { label: "Passes",                 short: "Pas",  available: true,  decimals: 0, getValue: (ts,os) => ({ ours: ts.passes,           theirs: os.passes })          },
  { label: "Touches In Opp Box",     short: "TOB",  available: false, decimals: 0 },
  { label: "Red Cards",              short: "RC",   available: true,  decimals: 0, getValue: (ts,os) => ({ ours: ts.redCards,          theirs: os.redCards })        },
  { label: "Yellow Cards",           short: "YC",   available: true,  decimals: 0, getValue: (ts,os) => ({ ours: ts.yellowCards,       theirs: os.yellowCards })     },
];

// ─── Player stat tab definitions (exact StatHub order) ───────────────────────

interface PlayerStatDef {
  label: string;
  short: string;
  available: boolean;
  beta?: boolean;
  decimals: number;
  getValue?: (ms: PlayerMatchStats) => number;
  getTotal?: (all: (PlayerMatchStats | null)[]) => number;
}

const PLAYER_STAT_TABS: PlayerStatDef[] = [
  { label: "Shots Outside the Box",            short: "SOB",  available: false, beta: true,  decimals: 0 },
  { label: "Shots On Target Outside the Box",  short: "STOB", available: false, beta: true,  decimals: 0 },
  { label: "Headed Shot",                      short: "HS",   available: false, beta: true,  decimals: 0 },
  { label: "Headed Shot On Target",            short: "HST",  available: false, beta: true,  decimals: 0 },
  { label: "First Half Shots",                 short: "FHS",  available: false, beta: true,  decimals: 0 },
  { label: "First Half Shots On Target",       short: "FHST", available: false, beta: true,  decimals: 0 },
  { label: "Fouls Committed",   short: "FC",   available: true, decimals: 0, getValue: ms => ms.fouls },
  { label: "Fouls Won",         short: "FW",   available: true, decimals: 0, getValue: ms => ms.foulsWon },
  { label: "Tackles",           short: "Tck",  available: true, decimals: 0, getValue: ms => ms.tackles },
  { label: "Shots",             short: "Sh",   available: true, decimals: 0, getValue: ms => ms.shots },
  { label: "Shots on Target",   short: "SoT",  available: true, decimals: 0, getValue: ms => ms.shotsOnTarget },
  { label: "Foul Involvements", short: "FI",   available: true, decimals: 0, getValue: ms => ms.foulInvolvements },
  { label: "Goals",             short: "G",    available: true, decimals: 0, getValue: ms => ms.goals },
  { label: "Assists",           short: "A",    available: true, decimals: 0, getValue: ms => ms.assists },
  { label: "Scored OR Assisted",short: "G+A",  available: true, decimals: 0, getValue: ms => ms.goalOrAssist },
  { label: "Expected Goals (xG)", short: "xG", available: true, decimals: 2, getValue: ms => ms.xG },
  { label: "Expected Assists (xA)", short: "xA", available: true, decimals: 2, getValue: ms => ms.xA },
  { label: "XG + XA",           short: "xG+A", available: true, decimals: 2, getValue: ms => ms.xGxA },
  { label: "Passes",            short: "Pas",  available: true, decimals: 0, getValue: ms => ms.passes },
  { label: "Crosses",           short: "Cr",   available: true, decimals: 0, getValue: ms => ms.crosses },
  { label: "Possession Lost",   short: "PL",   available: true, decimals: 0, getValue: ms => ms.possessionLost },
  { label: "Dispossessed",      short: "Dis",  available: true, decimals: 0, getValue: ms => ms.dispossessed },
  { label: "Interceptions Won", short: "Int",  available: true, decimals: 0, getValue: ms => ms.interceptions },
  { label: "Yellow Cards",      short: "YC",   available: true, decimals: 0, getValue: ms => ms.yellowCard ? 1 : 0 },
  { label: "Offsides",          short: "Off",  available: true, decimals: 0, getValue: ms => ms.offsides },
  { label: "Saves",             short: "Sav",  available: true, decimals: 0, getValue: ms => ms.saves },
];

// ─── Types ───────────────────────────────────────────────────────────────────

interface PlayerMatchStats {
  minutesPlayed: number; isSubstitute: boolean;
  goals: number; assists: number; goalOrAssist: number;
  shots: number; shotsOnTarget: number; shotsOffTarget: number; blockedShots: number;
  passes: number; accuratePasses: number; crosses: number; accurateCrosses: number;
  longBalls: number; accurateLongBalls: number;
  tackles: number; interceptions: number; fouls: number; foulsWon: number; foulInvolvements: number;
  yellowCard: boolean; redCard: boolean; saves: number;
  xG: number; xA: number; xGxA: number; bigChancesCreated: number; keyPasses: number;
  offsides: number; dispossessed: number; possessionLost: number; clearances: number;
  duelWon: number; duelLost: number; aerialWon: number; wonContest: number;
}

interface TeamMatchStats {
  goals: number; assists: number; shots: number; shotsOnTarget: number; shotsOffTarget: number; blockedShots: number;
  passes: number; accuratePasses: number; crosses: number; accurateCrosses: number; longBalls: number; accurateLongBalls: number;
  tackles: number; interceptions: number; fouls: number; foulsWon: number; yellowCards: number; redCards: number;
  saves: number; xG: number; xA: number; bigChancesCreated: number; keyPasses: number;
  offsides: number; dispossessed: number; possessionLost: number; clearances: number;
  duelWon: number; duelLost: number; aerialWon: number; wonContest: number;
}

interface Match {
  eventId: number; date: number;
  homeTeamName: string; awayTeamName: string;
  homeScore: number; awayScore: number;
  tournamentName: string; isHome: boolean;
  teamStats: TeamMatchStats; oppStats: TeamMatchStats;
}

interface Player {
  playerId: number; name: string; position: string; jerseyNo: number; appearances: number;
  matchStats: (PlayerMatchStats | null)[];
}

interface TeamData { matches: Match[]; players: Player[]; matchDates: number[]; }

// ─── Helpers ──────────────────────────────────────────────────────────────────

function resultColor(isHome: boolean, homeScore: number, awayScore: number) {
  const our = isHome ? homeScore : awayScore;
  const opp = isHome ? awayScore : homeScore;
  if (our > opp) return "text-green-400 border-green-500/40 bg-green-500/10";
  if (our < opp) return "text-red-400 border-red-500/40 bg-red-500/10";
  return "text-yellow-400 border-yellow-500/40 bg-yellow-500/10";
}

function ResultBadge({ isHome, homeScore, awayScore }: { isHome: boolean; homeScore: number; awayScore: number }) {
  const our = isHome ? homeScore : awayScore;
  const opp = isHome ? awayScore : homeScore;
  const r = our > opp ? "W" : our < opp ? "L" : "D";
  return (
    <span className={`text-[9px] font-mono font-bold px-1.5 py-0.5 border ${resultColor(isHome, homeScore, awayScore)}`}>
      {r}
    </span>
  );
}

function FormBar({ matches }: { matches: Match[] }) {
  const last5 = [...matches].sort((a, b) => b.date - a.date).slice(0, 5).reverse();
  return (
    <div className="flex items-center gap-1">
      {last5.map((m) => {
        const our = m.isHome ? m.homeScore : m.awayScore;
        const opp = m.isHome ? m.awayScore : m.homeScore;
        const r = our > opp ? "W" : our < opp ? "L" : "D";
        return (
          <div key={m.eventId} title={`${m.homeTeamName} ${m.homeScore}-${m.awayScore} ${m.awayTeamName}`}
            className={`w-5 h-5 flex items-center justify-center text-[8px] font-mono font-bold border ${resultColor(m.isHome, m.homeScore, m.awayScore)}`}>
            {r}
          </div>
        );
      })}
    </div>
  );
}

// ─── Generic Stat Tab Bar (works for both team and player tabs) ───────────────

interface TabDef { label: string; available: boolean; beta?: boolean }

function StatTabBar<T extends TabDef>({
  tabs, selected, onSelect,
}: { tabs: T[]; selected: number; onSelect: (i: number) => void }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const scroll = (dir: -1 | 1) => scrollRef.current?.scrollBy({ left: dir * 200, behavior: "smooth" });

  return (
    <div className="relative flex items-center gap-1">
      <button onClick={() => scroll(-1)} className="flex-shrink-0 w-6 h-6 flex items-center justify-center text-muted-foreground hover:text-primary">
        <ChevronLeft className="w-4 h-4" />
      </button>
      <div ref={scrollRef} className="flex gap-0 overflow-x-auto border-b border-border/50 flex-1" style={{ scrollbarWidth: "none" }}>
        {tabs.map((tab, i) => {
          const isActive = i === selected;
          const isUnavail = !tab.available;
          return (
            <button key={i} onClick={() => onSelect(i)}
              className={`px-3 py-2 text-[10px] font-mono uppercase tracking-wider whitespace-nowrap border-b-2 transition-all flex-shrink-0 flex items-center gap-1 ${
                isActive
                  ? "border-primary text-primary"
                  : isUnavail
                    ? "border-transparent text-muted-foreground/30 hover:text-muted-foreground/50"
                    : "border-transparent text-muted-foreground hover:text-foreground"
              }`}>
              {isUnavail && <Lock className="w-2.5 h-2.5 opacity-50" />}
              {tab.label}
              {tab.beta && <span className="text-[7px] text-cyan-500/60 ml-0.5">β</span>}
            </button>
          );
        })}
      </div>
      <button onClick={() => scroll(1)} className="flex-shrink-0 w-6 h-6 flex items-center justify-center text-muted-foreground hover:text-primary">
        <ChevronRight className="w-4 h-4" />
      </button>
    </div>
  );
}

// ─── Unavailable stat placeholder ────────────────────────────────────────────

function UnavailableStat({ label, beta }: { label: string; beta?: boolean }) {
  return (
    <div className="border border-dashed border-border/30 p-8 text-center space-y-2">
      <Lock className="w-5 h-5 text-muted-foreground/30 mx-auto" />
      <p className="text-sm font-mono text-muted-foreground/50">{label}</p>
      <p className="text-[10px] text-muted-foreground/30 max-w-xs mx-auto">
        {beta
          ? "This is a Beta stat — not yet available in the StatHub lineup data endpoint."
          : "This stat (corners, possession, shots inside/outside box, etc.) is not included in the StatHub last-games API response. Only player-derived stats are available."}
      </p>
    </div>
  );
}

// ─── Team Match Table ─────────────────────────────────────────────────────────

function TeamMatchTable({ data, tabIdx, color }: { data: TeamData; tabIdx: number; color: string | null }) {
  const tab = TEAM_STAT_TABS[tabIdx];
  if (!tab.available || !tab.getValue) return <UnavailableStat label={tab.label} />;

  const sorted = [...data.matches].sort((a, b) => b.date - a.date);
  const vals = sorted.map(m => tab.getValue!(m.teamStats, m.oppStats).ours);
  const maxVal = Math.max(...vals, 0.01);

  return (
    <div className="border border-border/50 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-xs font-mono">
          <thead>
            <tr className="bg-card border-b border-border/50">
              <th className="text-left px-3 py-2 text-[9px] text-muted-foreground uppercase tracking-wider min-w-[70px]">Date</th>
              <th className="text-left px-3 py-2 text-[9px] text-muted-foreground uppercase tracking-wider">Match</th>
              <th className="text-center px-3 py-2 text-[9px] uppercase tracking-wider font-bold" style={{ color: color || "#00ffff" }}>
                Ours
              </th>
              <th className="text-center px-3 py-2 text-[9px] text-muted-foreground uppercase tracking-wider">Theirs</th>
              <th className="text-center px-2 py-2 text-[9px] text-muted-foreground uppercase tracking-wider">Res</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/20">
            {sorted.map((m, i) => {
              const { ours, theirs } = tab.getValue!(m.teamStats, m.oppStats);
              const intensity = maxVal > 0 ? ours / maxVal : 0;
              return (
                <motion.tr key={m.eventId}
                  initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.02 }}
                  className="hover:bg-white/[0.02]">
                  <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">
                    {format(new Date(m.date * 1000), "dd MMM")}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap items-baseline gap-x-1">
                      <span className={m.isHome ? "font-medium" : "text-foreground/60"}>{m.homeTeamName}</span>
                      <span className="text-muted-foreground text-[10px]">{m.homeScore}-{m.awayScore}</span>
                      <span className={!m.isHome ? "font-medium" : "text-foreground/60"}>{m.awayTeamName}</span>
                    </div>
                    {m.tournamentName && (
                      <div className="text-[9px] text-muted-foreground/40 truncate max-w-[200px]">{m.tournamentName}</div>
                    )}
                  </td>
                  <td className="px-3 py-2 text-center">
                    <span className="font-bold text-sm"
                      style={{ color: `rgba(${intensity > 0.5 ? "0,255,200" : "180,180,200"},${0.45 + intensity * 0.55})` }}>
                      {tab.decimals > 0 ? ours.toFixed(tab.decimals) : ours}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-center text-muted-foreground">
                    {tab.decimals > 0 ? theirs.toFixed(tab.decimals) : theirs}
                  </td>
                  <td className="px-2 py-2 text-center">
                    <ResultBadge isHome={m.isHome} homeScore={m.homeScore} awayScore={m.awayScore} />
                  </td>
                </motion.tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Player Match Matrix ──────────────────────────────────────────────────────

function PlayerMatchMatrix({ data, tabIdx }: { data: TeamData; tabIdx: number }) {
  const tab = PLAYER_STAT_TABS[tabIdx];
  if (!tab.available || !tab.getValue) return <UnavailableStat label={tab.label} beta={tab.beta} />;

  const matches = [...data.matches].sort((a, b) => a.date - b.date);
  const n = matches.length;
  const getVal = tab.getValue;

  const players = [...data.players]
    .filter(p => p.appearances > 0)
    .map(p => {
      const vals = p.matchStats.map(ms => ms ? getVal(ms) : null);
      const total = vals.reduce<number>((s, v) => s + (v ?? 0), 0);
      return { ...p, vals, total };
    })
    .sort((a, b) => b.total - a.total);

  const allVals = players.flatMap(p => p.vals).filter((v): v is number => v !== null && v > 0);
  const maxVal = Math.max(...allVals, 0.01);
  const isCardStat = tab.short === "YC" || tab.short === "RC";

  return (
    <div className="border border-border/50 overflow-hidden">
      <div className="overflow-x-auto" style={{ maxHeight: "70vh" }}>
        <table className="text-[10px] font-mono border-collapse">
          <thead className="sticky top-0 z-10 bg-card">
            <tr className="border-b border-border/50">
              <th className="sticky left-0 z-20 bg-card px-3 py-2 text-left text-[9px] text-muted-foreground uppercase tracking-wider whitespace-nowrap min-w-[130px] border-r border-border/30">
                Player
              </th>
              <th className="px-2 py-2 text-center text-[9px] text-muted-foreground uppercase whitespace-nowrap border-r border-border/20 min-w-[36px]">
                Apps
              </th>
              {matches.map(m => (
                <th key={m.eventId} className="px-1 py-1 text-center whitespace-nowrap border-r border-border/10 min-w-[34px]">
                  <div className="text-[8px] text-muted-foreground/70">{format(new Date(m.date * 1000), "MMM\u00A0d")}</div>
                  <div className={`text-[8px] font-bold ${resultColor(m.isHome, m.homeScore, m.awayScore).split(" ")[0]}`}>
                    {m.isHome ? m.homeScore : m.awayScore}-{m.isHome ? m.awayScore : m.homeScore}
                  </div>
                </th>
              ))}
              <th className="px-2 py-2 text-center text-[9px] text-primary uppercase whitespace-nowrap sticky right-0 bg-card border-l border-border/30">
                TOT
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/10">
            {players.map((p, pi) => (
              <motion.tr key={p.playerId}
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: pi * 0.015 }}
                className="hover:bg-white/[0.02]">
                <td className="sticky left-0 bg-background px-3 py-1.5 border-r border-border/30">
                  <div className="text-foreground/90 font-medium truncate max-w-[120px]">{p.name}</div>
                  <div className="text-[8px] text-muted-foreground">{p.position}</div>
                </td>
                <td className="px-2 py-1.5 text-center text-muted-foreground border-r border-border/20">{p.appearances}</td>
                {Array.from({ length: n }, (_, i) => {
                  // matchStats are ordered newest-first; matches are sorted oldest-first
                  const ms = p.matchStats[n - 1 - i];
                  const val = ms ? getVal(ms) : null;
                  const intensity = (val !== null && maxVal > 0) ? val / maxVal : 0;
                  return (
                    <td key={i} className="px-1 py-1.5 text-center border-r border-border/10">
                      {ms === null ? (
                        <span className="text-muted-foreground/20">·</span>
                      ) : val === 0 || val === null ? (
                        <span className="text-muted-foreground/30">0</span>
                      ) : (
                        <span className="font-bold" style={{
                          color: isCardStat
                            ? (tab.short === "YC" ? "#fbbf24" : "#ef4444")
                            : `rgba(0,${Math.round(185 + intensity * 70)},${Math.round(155 + intensity * 45)},${0.65 + intensity * 0.35})`
                        }}>
                          {isCardStat ? "●" : tab.decimals > 0 ? val.toFixed(tab.decimals) : val}
                        </span>
                      )}
                    </td>
                  );
                })}
                <td className="px-2 py-1.5 text-center font-bold text-primary sticky right-0 bg-background border-l border-border/30">
                  {tab.decimals > 0 ? p.total.toFixed(tab.decimals) : p.total}
                </td>
              </motion.tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Avg Stat Cards ───────────────────────────────────────────────────────────

function AvgCards({ data }: { data: TeamData }) {
  const n = data.matches.length || 1;
  const teamAvg = (key: keyof TeamMatchStats) => {
    const total = data.matches.reduce((s, m) => s + ((m.teamStats[key] as number) ?? 0), 0);
    return (total / n).toFixed(1);
  };
  const cards = [
    { label: "Goals/G",   val: teamAvg("goals") },
    { label: "Shots/G",   val: teamAvg("shots") },
    { label: "On Tgt/G",  val: teamAvg("shotsOnTarget") },
    { label: "Passes/G",  val: teamAvg("passes") },
    { label: "Tackles/G", val: teamAvg("tackles") },
    { label: "Yellow/G",  val: teamAvg("yellowCards") },
    { label: "Fouls/G",   val: teamAvg("fouls") },
    { label: "Int/G",     val: teamAvg("interceptions") },
  ];
  return (
    <div className="grid grid-cols-4 sm:grid-cols-8 gap-1.5">
      {cards.map(c => (
        <div key={c.label} className="border border-border/40 bg-card/30 p-2 flex flex-col items-center gap-0.5">
          <div className="text-base font-mono font-bold text-foreground">{c.val}</div>
          <div className="text-[8px] font-mono text-muted-foreground uppercase tracking-wide text-center leading-tight">{c.label}</div>
        </div>
      ))}
    </div>
  );
}

// ─── Team Panel ───────────────────────────────────────────────────────────────

type ViewMode = "team" | "players";

function TeamPanel({ data, color }: { data: TeamData; color: string | null }) {
  const [teamTabIdx, setTeamTabIdx] = useState(0);
  const [playerTabIdx, setPlayerTabIdx] = useState(12); // default to "Goals" in player list
  const [viewMode, setViewMode] = useState<ViewMode>("team");

  const currentLabel = viewMode === "team"
    ? TEAM_STAT_TABS[teamTabIdx].label
    : PLAYER_STAT_TABS[playerTabIdx].label;
  const isCurrentUnavail = viewMode === "team"
    ? !TEAM_STAT_TABS[teamTabIdx].available
    : !PLAYER_STAT_TABS[playerTabIdx].available;

  return (
    <div className="space-y-4">
      {/* Form + avg */}
      <div className="flex items-center gap-3">
        <span className="text-[9px] font-mono text-muted-foreground uppercase tracking-widest">Form</span>
        <FormBar matches={data.matches} />
        <span className="text-[9px] font-mono text-muted-foreground ml-2">{data.matches.length} matches</span>
      </div>
      <AvgCards data={data} />

      {/* View mode toggle */}
      <div className="flex gap-0 border border-border/50 w-fit">
        {(["team", "players"] as ViewMode[]).map(m => (
          <button key={m} onClick={() => setViewMode(m)}
            className={`px-4 py-1.5 text-[10px] font-mono uppercase tracking-widest transition-all border-r border-border/30 last:border-r-0 ${
              viewMode === m ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground"
            }`}>
            {m === "team" ? "Team Stats" : "Player Stats"}
          </button>
        ))}
      </div>

      {/* Stat tab bar */}
      {viewMode === "team" ? (
        <StatTabBar tabs={TEAM_STAT_TABS} selected={teamTabIdx} onSelect={setTeamTabIdx} />
      ) : (
        <StatTabBar tabs={PLAYER_STAT_TABS} selected={playerTabIdx} onSelect={setPlayerTabIdx} />
      )}

      {/* Stat label */}
      <div className="flex items-center gap-2">
        {isCurrentUnavail && <Lock className="w-3 h-3 text-muted-foreground/40" />}
        <span className={`text-xs font-mono uppercase tracking-widest ${isCurrentUnavail ? "text-muted-foreground/40" : "text-primary"}`}>
          {currentLabel}
        </span>
        <span className="text-[9px] font-mono text-muted-foreground">
          — {viewMode === "team" ? "per match" : "per player per match"}
        </span>
      </div>

      {/* Content */}
      <AnimatePresence mode="wait">
        <motion.div key={`${viewMode}-${viewMode === "team" ? teamTabIdx : playerTabIdx}`}
          initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
          transition={{ duration: 0.12 }}>
          {viewMode === "team" ? (
            <TeamMatchTable data={data} tabIdx={teamTabIdx} color={color} />
          ) : (
            <PlayerMatchMatrix data={data} tabIdx={playerTabIdx} />
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

// ─── Compare Panel ────────────────────────────────────────────────────────────

function ComparePanel({ home, away, fixture }: {
  home: TeamData; away: TeamData;
  fixture: { homeTeam: { name: string; colorPrimary: string | null }; awayTeam: { name: string; colorPrimary: string | null } };
}) {
  const hN = home.matches.length || 1;
  const aN = away.matches.length || 1;
  const hAvg = (key: keyof TeamMatchStats) =>
    home.matches.reduce((s, m) => s + ((m.teamStats[key] as number) ?? 0), 0) / hN;
  const aAvg = (key: keyof TeamMatchStats) =>
    away.matches.reduce((s, m) => s + ((m.teamStats[key] as number) ?? 0), 0) / aN;

  const compareStats: { label: string; key: keyof TeamMatchStats; dec: number }[] = [
    { label: "Goals",           key: "goals",           dec: 1 },
    { label: "Shots",           key: "shots",           dec: 1 },
    { label: "Shots on Target", key: "shotsOnTarget",   dec: 1 },
    { label: "xG",              key: "xG",              dec: 2 },
    { label: "xA",              key: "xA",              dec: 2 },
    { label: "Big Chances",     key: "bigChancesCreated", dec: 1 },
    { label: "Passes",          key: "passes",          dec: 0 },
    { label: "Accurate Passes", key: "accuratePasses",  dec: 0 },
    { label: "Crosses",         key: "crosses",         dec: 1 },
    { label: "Tackles",         key: "tackles",         dec: 1 },
    { label: "Interceptions",   key: "interceptions",   dec: 1 },
    { label: "Clearances",      key: "clearances",      dec: 1 },
    { label: "Fouls",           key: "fouls",           dec: 1 },
    { label: "Yellow Cards",    key: "yellowCards",     dec: 1 },
    { label: "Saves",           key: "saves",           dec: 1 },
    { label: "Offsides",        key: "offsides",        dec: 1 },
  ];

  return (
    <div className="space-y-4">
      <div className="flex justify-between text-xs font-mono uppercase tracking-widest">
        <span style={{ color: fixture.homeTeam.colorPrimary || "#00ffff" }}>{fixture.homeTeam.name}</span>
        <span className="text-muted-foreground text-[9px]">avg per game</span>
        <span style={{ color: fixture.awayTeam.colorPrimary || "#00ffff" }}>{fixture.awayTeam.name}</span>
      </div>
      <div className="border border-border/50 bg-card/20 divide-y divide-border/20">
        {compareStats.map(s => {
          const h = hAvg(s.key);
          const a = aAvg(s.key);
          const total = h + a;
          const hPct = total === 0 ? 50 : Math.round((h / total) * 100);
          return (
            <div key={s.key} className="grid grid-cols-[60px_1fr_60px] items-center gap-2 px-3 py-2">
              <div className="text-right font-mono text-sm font-bold text-foreground">{s.dec === 0 ? Math.round(h) : h.toFixed(s.dec)}</div>
              <div className="flex flex-col gap-1">
                <div className="text-[9px] text-center text-muted-foreground uppercase tracking-wider">{s.label}</div>
                <div className="h-1.5 flex overflow-hidden bg-muted/20">
                  <div className="h-full transition-all duration-500" style={{ width: `${hPct}%`, backgroundColor: fixture.homeTeam.colorPrimary || "#00ffff", opacity: 0.7 }} />
                  <div className="h-full transition-all duration-500" style={{ width: `${100 - hPct}%`, backgroundColor: fixture.awayTeam.colorPrimary || "#00ffff", opacity: 0.5 }} />
                </div>
              </div>
              <div className="text-left font-mono text-sm font-bold text-foreground">{s.dec === 0 ? Math.round(a) : a.toFixed(s.dec)}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function FixtureDetail() {
  const { id } = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const [activeTab, setActiveTab] = useState<"home" | "away" | "compare">("home");

  const fixtureId = Number(id);
  const { data, isLoading, isError } = useGetFixtureDetail(fixtureId);

  const fixture = data?.fixture as {
    id: number; status: string; slug: string;
    homeTeam: { id: number; name: string; colorPrimary: string | null };
    awayTeam: { id: number; name: string; colorPrimary: string | null };
    homeScore: number | null; awayScore: number | null;
    kickoffTimestamp: number; leagueName: string; winnerCode: number | null;
  } | undefined;

  const home = data?.home as TeamData | undefined;
  const away = data?.away as TeamData | undefined;

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col dark">
      {/* Header */}
      <header className="border-b border-border/50 bg-card/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="container mx-auto px-4 h-14 flex items-center gap-4">
          <button onClick={() => navigate("/")}
            className="flex items-center gap-2 text-muted-foreground hover:text-primary transition-colors font-mono text-xs uppercase tracking-widest">
            <ArrowLeft className="w-4 h-4" /> Back
          </button>
          <div className="w-px h-4 bg-border" />
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-primary" />
            <span className="text-sm font-mono tracking-widest text-primary/80 uppercase">Fixture Intel</span>
          </div>
        </div>
      </header>

      {isLoading ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center space-y-4">
            <div className="w-12 h-12 border-2 border-primary/30 border-t-primary animate-spin rounded-full mx-auto" />
            <p className="text-xs font-mono uppercase tracking-widest text-muted-foreground">Acquiring data streams...</p>
          </div>
        </div>
      ) : isError || !fixture ? (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-destructive font-mono text-sm">Signal lost — fixture not found</p>
        </div>
      ) : (
        <main className="container mx-auto px-4 pb-20 flex-1 space-y-6 pt-6">
          {/* Fixture card */}
          <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}
            className="border border-border/50 bg-card/40 overflow-hidden">
            <div className="text-center py-1.5 bg-card/60 border-b border-border/40">
              <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">{fixture.leagueName}</span>
            </div>
            <div className="py-5 px-4 flex items-center justify-between gap-4">
              <div className="flex-1 text-right">
                <div className="text-xl sm:text-2xl font-bold uppercase tracking-wide"
                  style={{ color: fixture.homeTeam.colorPrimary || undefined }}>{fixture.homeTeam.name}</div>
                {home && <div className="mt-1 flex justify-end"><FormBar matches={home.matches} /></div>}
              </div>
              <div className="flex flex-col items-center min-w-[80px]">
                {fixture.status === "notstarted" ? (
                  <>
                    <div className="text-2xl font-bold font-mono text-primary/80">
                      {format(new Date(fixture.kickoffTimestamp * 1000), "HH:mm")}
                    </div>
                    <div className="text-[10px] font-mono uppercase text-muted-foreground tracking-widest">
                      {format(new Date(fixture.kickoffTimestamp * 1000), "dd MMM")}
                    </div>
                  </>
                ) : (
                  <>
                    <div className="text-3xl font-bold font-mono">{fixture.homeScore ?? 0} - {fixture.awayScore ?? 0}</div>
                    <div className={`text-[10px] font-mono uppercase tracking-widest ${fixture.status === "inprogress" ? "text-green-400" : "text-muted-foreground"}`}>
                      {fixture.status === "inprogress" ? "● LIVE" : "FT"}
                    </div>
                  </>
                )}
              </div>
              <div className="flex-1 text-left">
                <div className="text-xl sm:text-2xl font-bold uppercase tracking-wide"
                  style={{ color: fixture.awayTeam.colorPrimary || undefined }}>{fixture.awayTeam.name}</div>
                {away && <div className="mt-1 flex justify-start"><FormBar matches={away.matches} /></div>}
              </div>
            </div>
          </motion.div>

          {/* Tabs */}
          <div className="flex gap-0 border-b border-border/50">
            {(["home", "away", "compare"] as const).map(tab => (
              <button key={tab} onClick={() => setActiveTab(tab)}
                className={`px-4 py-2 text-xs font-mono uppercase tracking-widest border-b-2 transition-all -mb-px ${
                  activeTab === tab ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
                }`}>
                {tab === "home" ? fixture.homeTeam.name : tab === "away" ? fixture.awayTeam.name : "Compare"}
              </button>
            ))}
          </div>

          {/* Tab content */}
          <AnimatePresence mode="wait">
            {activeTab === "home" && home ? (
              <motion.div key="home" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <TeamPanel data={home} color={fixture.homeTeam.colorPrimary} />
              </motion.div>
            ) : activeTab === "away" && away ? (
              <motion.div key="away" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <TeamPanel data={away} color={fixture.awayTeam.colorPrimary} />
              </motion.div>
            ) : activeTab === "compare" && home && away ? (
              <motion.div key="compare" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <ComparePanel home={home} away={away} fixture={fixture} />
              </motion.div>
            ) : (
              <div className="flex items-center justify-center h-32">
                <div className="w-6 h-6 border border-primary/30 border-t-primary animate-spin rounded-full" />
              </div>
            )}
          </AnimatePresence>
        </main>
      )}
    </div>
  );
}
