import React, { useState, useRef } from "react";
import { useParams, useLocation } from "wouter";
import { format } from "date-fns";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowLeft, Activity, ChevronLeft, ChevronRight, Lock, Brain, Star, TrendingUp, Zap } from "lucide-react";
import { useGetFixtureDetail } from "@workspace/api-client-react";
import PlayerAnalysisPanel from "@/components/PlayerAnalysisPanel";
import BettingOddsPanel from "@/components/BettingOddsPanel";

// ─── Types ───────────────────────────────────────────────────────────────────

interface SHMatchStatRow {
  eventId: number;
  date: string;
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
  homeValue: number;
  awayValue: number;
  myValue: number;
  opponentValue: number;
  result: "W" | "D" | "L";
}

interface SHStatHistory {
  key: string;
  label: string;
  matches: SHMatchStatRow[];
}

interface PlayerMatchStats {
  minutesPlayed: number; rating: number; matchPosition: string; isSubstitute: boolean;
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

interface Match {
  eventId: number; date: number;
  homeTeamName: string; awayTeamName: string;
  homeScore: number; awayScore: number;
  tournamentName: string; isHome: boolean;
}

interface Player {
  playerId: number; name: string; position: string; jerseyNo: number; appearances: number;
  matchStats: (PlayerMatchStats | null)[];
}

interface TeamData {
  matches: Match[];
  players: Player[];
  matchDates: number[];
  possession: number;
  statHistory: SHStatHistory[];
}

// ─── Team stat tab definitions ────────────────────────────────────────────────

interface TeamStatDef {
  label: string;
  short: string;
  shKey: string;
  decimals: number;
}

const TEAM_STAT_TABS: TeamStatDef[] = [
  { label: "Goals",                   short: "Gls",  shKey: "Goals",                   decimals: 0 },
  { label: "Corners",                 short: "Cor",  shKey: "Corners",                 decimals: 0 },
  { label: "Shots",                   short: "Sh",   shKey: "Shots",                   decimals: 0 },
  { label: "Cards",                   short: "Crd",  shKey: "Cards",                   decimals: 0 },
  { label: "Crosses",                 short: "Cr",   shKey: "Crosses",                 decimals: 0 },
  { label: "Big Chance Created",      short: "BCC",  shKey: "Big Chance Created",      decimals: 0 },
  { label: "Big Chance Missed",       short: "BCM",  shKey: "Big Chance Missed",       decimals: 0 },
  { label: "Big Chance Scored",       short: "BCS",  shKey: "Big Chance Scored",       decimals: 0 },
  { label: "Expected Goals",          short: "xG",   shKey: "Expected Goals",          decimals: 2 },
  { label: "Shots On Goal",           short: "SoG",  shKey: "Shots On Goal",           decimals: 0 },
  { label: "Shots Off Goal",          short: "SoFF", shKey: "Shots Off Goal",          decimals: 0 },
  { label: "Total Shots Inside Box",  short: "SIB",  shKey: "Total Shots Inside Box",  decimals: 0 },
  { label: "Total Shots Outside Box", short: "SOB",  shKey: "Total Shots Outside Box", decimals: 0 },
  { label: "Total Clearance",         short: "Clr",  shKey: "Total Clearance",         decimals: 0 },
  { label: "Dispossessed",            short: "Dis",  shKey: "Dispossessed",            decimals: 0 },
  { label: "Errors Lead To Goal",     short: "ELG",  shKey: "Errors Lead To Goal",     decimals: 0 },
  { label: "Errors Lead To Shot",     short: "ELS",  shKey: "Errors Lead To Shot",     decimals: 0 },
  { label: "Fouls",                   short: "Fls",  shKey: "Fouls",                   decimals: 0 },
  { label: "Goalkeeper Saves",        short: "Sav",  shKey: "Goalkeeper Saves",        decimals: 0 },
  { label: "Interception Won",        short: "Int",  shKey: "Interception Won",        decimals: 0 },
  { label: "Tackles",                 short: "Tck",  shKey: "Tackles",                 decimals: 0 },
  { label: "Free Kicks",              short: "FK",   shKey: "Free Kicks",              decimals: 0 },
  { label: "Goal Kicks",              short: "GK",   shKey: "Goal Kicks",              decimals: 0 },
  { label: "Throw Ins",               short: "TI",   shKey: "Throw Ins",               decimals: 0 },
  { label: "Possession",              short: "Pos",  shKey: "Possession",              decimals: 1 },
  { label: "Offsides",                short: "Off",  shKey: "Offsides",                decimals: 0 },
  { label: "Passes",                  short: "Pas",  shKey: "Passes",                  decimals: 0 },
  { label: "Touches In Opp Box",      short: "TOB",  shKey: "Touches In Opp Box",      decimals: 0 },
  { label: "Red Cards",               short: "RC",   shKey: "Red Cards",               decimals: 0 },
  { label: "Yellow Cards",            short: "YC",   shKey: "Yellow Cards",            decimals: 0 },
];

// ─── Player stat tab definitions ──────────────────────────────────────────────

interface PlayerStatDef {
  label: string;
  short: string;
  available: boolean;
  beta?: boolean;
  decimals: number;
  getValue?: (ms: PlayerMatchStats) => number;
}

const PLAYER_STAT_TABS: PlayerStatDef[] = [
  { label: "Shots Outside the Box",           short: "SOB",  available: false, beta: true,  decimals: 0 },
  { label: "Shots On Target Outside the Box", short: "STOB", available: false, beta: true,  decimals: 0 },
  { label: "Headed Shot",                     short: "HS",   available: false, beta: true,  decimals: 0 },
  { label: "Headed Shot On Target",           short: "HST",  available: false, beta: true,  decimals: 0 },
  { label: "First Half Shots",                short: "FHS",  available: false, beta: true,  decimals: 0 },
  { label: "First Half Shots On Target",      short: "FHST", available: false, beta: true,  decimals: 0 },
  { label: "Fouls Committed",    short: "FC",   available: true, decimals: 0, getValue: ms => ms.fouls },
  { label: "Fouls Won",          short: "FW",   available: true, decimals: 0, getValue: ms => ms.foulsWon },
  { label: "Tackles",            short: "Tck",  available: true, decimals: 0, getValue: ms => ms.tackles },
  { label: "Shots",              short: "Sh",   available: true, decimals: 0, getValue: ms => ms.shots },
  { label: "Shots on Target",    short: "SoT",  available: true, decimals: 0, getValue: ms => ms.shotsOnTarget },
  { label: "Foul Involvements",  short: "FI",   available: true, decimals: 0, getValue: ms => ms.foulInvolvements },
  { label: "Goals",              short: "G",    available: true, decimals: 0, getValue: ms => ms.goals },
  { label: "Assists",            short: "A",    available: true, decimals: 0, getValue: ms => ms.assists },
  { label: "Scored OR Assisted", short: "G+A",  available: true, decimals: 0, getValue: ms => ms.goalOrAssist },
  { label: "Expected Goals (xG)",short: "xG",   available: true, decimals: 2, getValue: ms => ms.xG },
  { label: "Expected Assists (xA)", short: "xA",available: true, decimals: 2, getValue: ms => ms.xA },
  { label: "XG + XA",            short: "xG+A", available: true, decimals: 2, getValue: ms => ms.xGxA },
  { label: "Passes",             short: "Pas",  available: true, decimals: 0, getValue: ms => ms.passes },
  { label: "Crosses",            short: "Cr",   available: true, decimals: 0, getValue: ms => ms.crosses },
  { label: "Possession Lost",    short: "PL",   available: true, decimals: 0, getValue: ms => ms.possessionLost },
  { label: "Dispossessed",       short: "Dis",  available: true, decimals: 0, getValue: ms => ms.dispossessed },
  { label: "Interceptions Won",  short: "Int",  available: true, decimals: 0, getValue: ms => ms.interceptions },
  { label: "Yellow Cards",       short: "YC",   available: true, decimals: 0, getValue: ms => ms.yellowCard ? 1 : 0 },
  { label: "Offsides",           short: "Off",  available: true, decimals: 0, getValue: ms => ms.offsides },
  { label: "Saves",              short: "Sav",  available: true, decimals: 0, getValue: ms => ms.saves },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function resultColor(result: "W" | "D" | "L") {
  if (result === "W") return "text-green-400 border-green-500/40 bg-green-500/10";
  if (result === "L") return "text-red-400 border-red-500/40 bg-red-500/10";
  return "text-yellow-400 border-yellow-500/40 bg-yellow-500/10";
}

function resultFromMatch(isHome: boolean, homeScore: number, awayScore: number): "W" | "D" | "L" {
  const our = isHome ? homeScore : awayScore;
  const opp = isHome ? awayScore : homeScore;
  return our > opp ? "W" : our < opp ? "L" : "D";
}

function ResultBadge({ result }: { result: "W" | "D" | "L" }) {
  return (
    <span className={`text-[9px] font-mono font-bold px-1.5 py-0.5 border ${resultColor(result)}`}>
      {result}
    </span>
  );
}

function FormBar({ matches }: { matches: Match[] }) {
  const last5 = [...matches].sort((a, b) => b.date - a.date).slice(0, 5).reverse();
  return (
    <div className="flex items-center gap-1">
      {last5.map((m) => {
        const r = resultFromMatch(m.isHome, m.homeScore, m.awayScore);
        return (
          <div key={m.eventId} title={`${m.homeTeamName} ${m.homeScore}-${m.awayScore} ${m.awayTeamName}`}
            className={`w-5 h-5 flex items-center justify-center text-[8px] font-mono font-bold border ${resultColor(r)}`}>
            {r}
          </div>
        );
      })}
    </div>
  );
}

// ─── Generic Stat Tab Bar ────────────────────────────────────────────────────

interface TabDef { label: string; available?: boolean; beta?: boolean }

function StatTabBar<T extends TabDef>({
  tabs, selected, onSelect, getAvailable,
}: {
  tabs: T[];
  selected: number;
  onSelect: (i: number) => void;
  getAvailable?: (tab: T) => boolean;
}) {
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
          const isUnavail = getAvailable ? !getAvailable(tab) : tab.available === false;
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

function UnavailableStat({ label, beta, noData }: { label: string; beta?: boolean; noData?: boolean }) {
  return (
    <div className="border border-dashed border-border/30 p-8 text-center space-y-2">
      <Lock className="w-5 h-5 text-muted-foreground/30 mx-auto" />
      <p className="text-sm font-mono text-muted-foreground/50">{label}</p>
      <p className="text-[10px] text-muted-foreground/30 max-w-xs mx-auto">
        {beta
          ? "This is a Beta stat — not yet available in the StatHub lineup data endpoint."
          : noData
          ? "No data returned from StatsHub for this stat."
          : "This stat is not available for this team."}
      </p>
    </div>
  );
}

// ─── Team Match Table (uses SHStatHistory) ───────────────────────────────────

function TeamMatchTable({
  data, tabIdx, color,
}: {
  data: TeamData;
  tabIdx: number;
  color: string | null;
}) {
  const tab = TEAM_STAT_TABS[tabIdx];
  const history = data.statHistory.find(h => h.label === tab.shKey);

  if (!history || history.matches.length === 0) {
    return <UnavailableStat label={tab.label} noData />;
  }

  const vals = history.matches.map(m => m.myValue);
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
            {history.matches.map((m, i) => {
              const intensity = maxVal > 0 ? m.myValue / maxVal : 0;
              return (
                <motion.tr key={m.eventId}
                  initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.02 }}
                  className="hover:bg-white/[0.02]">
                  <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">{m.date}</td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap items-baseline gap-x-1">
                      <span className="text-foreground/60">{m.homeTeam}</span>
                      <span className="text-muted-foreground text-[10px]">{m.homeScore}-{m.awayScore}</span>
                      <span className="text-foreground/60">{m.awayTeam}</span>
                    </div>
                  </td>
                  <td className="px-3 py-2 text-center">
                    <span className="font-bold text-sm"
                      style={{ color: `rgba(${intensity > 0.5 ? "0,255,200" : "180,180,200"},${0.45 + intensity * 0.55})` }}>
                      {tab.decimals > 0 ? m.myValue.toFixed(tab.decimals) : m.myValue}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-center text-muted-foreground">
                    {tab.decimals > 0 ? m.opponentValue.toFixed(tab.decimals) : m.opponentValue}
                  </td>
                  <td className="px-2 py-2 text-center">
                    <ResultBadge result={m.result} />
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
                  <div className={`text-[8px] font-bold ${resultColor(resultFromMatch(m.isHome, m.homeScore, m.awayScore)).split(" ")[0]}`}>
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
  const getAvg = (label: string, dec = 1) => {
    const history = data.statHistory.find(h => h.label === label);
    if (!history || !history.matches.length) return "—";
    const total = history.matches.reduce((s, m) => s + m.myValue, 0);
    return (total / history.matches.length).toFixed(dec);
  };

  const cards = [
    { label: "Goals/G",   val: getAvg("Goals", 1) },
    { label: "Shots/G",   val: getAvg("Shots", 1) },
    { label: "On Tgt/G",  val: getAvg("Shots On Goal", 1) },
    { label: "xG/G",      val: getAvg("Expected Goals", 2) },
    { label: "Passes/G",  val: getAvg("Passes", 0) },
    { label: "Tackles/G", val: getAvg("Tackles", 1) },
    { label: "Fouls/G",   val: getAvg("Fouls", 1) },
    { label: "Pos%",      val: data.possession > 0 ? `${data.possession.toFixed(0)}%` : getAvg("Possession", 0) },
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

// ─── Lineup Intel Panel ───────────────────────────────────────────────────────

const LINEUP_STATS: Array<{
  label: string;
  short: string;
  getValue: (ms: PlayerMatchStats) => number;
  isCard?: boolean;
}> = [
  { label: "Fouls",             short: "FC",  getValue: ms => ms.fouls },
  { label: "Fouls Won",         short: "FW",  getValue: ms => ms.foulsWon },
  { label: "Tackles",           short: "Tck", getValue: ms => ms.tackles },
  { label: "Shots",             short: "Sh",  getValue: ms => ms.shots },
  { label: "SOT",               short: "SOT", getValue: ms => ms.shotsOnTarget },
  { label: "Foul Involvements", short: "FI",  getValue: ms => ms.foulInvolvements },
  { label: "Goals",             short: "G",   getValue: ms => ms.goals },
  { label: "Assists",           short: "A",   getValue: ms => ms.assists },
  { label: "G + A",             short: "G+A", getValue: ms => ms.goalOrAssist },
  { label: "Passes",            short: "Pas", getValue: ms => ms.passes },
  { label: "Yellow Cards",      short: "YC",  getValue: ms => ms.yellowCard ? 1 : 0, isCard: true },
];

const POS_CONFIG: Array<{ pos: string; label: string; max: number }> = [
  { pos: "G", label: "GK",  max: 2 },
  { pos: "D", label: "DEF", max: 5 },
  { pos: "M", label: "MID", max: 6 },
  { pos: "F", label: "FWD", max: 4 },
];

function PlayerIntelCard({
  player, statDef, totalMatches, globalMax, color, matches,
}: {
  player: Player;
  statDef: typeof LINEUP_STATS[0];
  totalMatches: number;
  globalMax: number;
  color: string | null;
  matches: Match[];
}) {
  const [selectedBarIdx, setSelectedBarIdx] = useState<number | null>(null);

  // matchStats[0]=newest; map with original index then reverse for oldest→newest display
  const playedWithIdx = player.matchStats
    .map((ms, originalIdx) => ({ ms, originalIdx }))
    .filter((x): x is { ms: PlayerMatchStats; originalIdx: number } => x.ms !== null)
    .reverse();

  const vals = playedWithIdx.map(({ ms }) => statDef.getValue(ms));
  const totalStat = vals.reduce((s, v) => s + v, 0);
  const avgStat = vals.length > 0 ? totalStat / vals.length : 0;
  const totalMins = playedWithIdx.reduce((s, { ms }) => s + ms.minutesPlayed, 0);
  const avgMins = playedWithIdx.length > 0 ? totalMins / playedWithIdx.length : 0;
  const p90 = totalMins > 0 ? (totalStat / totalMins) * 90 : 0;
  const hitCount = vals.filter(v => v > 0).length;
  const hitRate = vals.length > 0 ? Math.round((hitCount / vals.length) * 100) : 0;
  const startRate = Math.round((player.appearances / totalMatches) * 100);

  const sel = selectedBarIdx !== null ? playedWithIdx[selectedBarIdx] : null;
  const selMatch = sel ? matches[sel.originalIdx] : null;
  const selVal = sel ? statDef.getValue(sel.ms) : null;

  const barColor = (v: number) => {
    if (statDef.isCard) return v > 0 ? "#fbbf24" : "#ffffff12";
    if (v === 0) return "#ffffff12";
    const t = globalMax > 0 ? v / globalMax : 0;
    return color
      ? `${color}${Math.round(80 + t * 160).toString(16).padStart(2, "0")}`
      : `rgba(0,${Math.round(185 + t * 70)},${Math.round(155 + t * 45)},${0.45 + t * 0.55})`;
  };

  return (
    <div className="border border-border/30 bg-card/20 transition-colors hover:border-border/50">
      {/* Header */}
      <div className="px-3 pt-3 pb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[9px] font-mono text-muted-foreground/35 flex-shrink-0">#{player.jerseyNo || "—"}</span>
          <div className="min-w-0">
            <div className="text-xs font-mono font-semibold text-foreground/90 truncate">{player.name}</div>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className="text-[8px] font-mono text-muted-foreground/45">{player.appearances}/{totalMatches} apps</span>
              <div className="h-1 w-8 bg-muted/20 rounded-full overflow-hidden">
                <div className="h-full rounded-full" style={{ width: `${startRate}%`, backgroundColor: color || "#00ffff", opacity: 0.55 }} />
              </div>
              <span className="text-[8px] font-mono text-muted-foreground/35">{startRate}%</span>
            </div>
          </div>
        </div>
      </div>

      {/* Summary stats: Graph Avg · Hit Rate · Avg Mins · P90 */}
      <div className="grid grid-cols-4 border-t border-b border-border/20 divide-x divide-border/20">
        {[
          { label: "Graph Avg", val: statDef.isCard ? String(totalStat) : avgStat.toFixed(2), accent: true },
          { label: "Hit Rate",  val: `${hitRate}% (${hitCount}/${vals.length})`, accent: false, red: hitRate === 0 },
          { label: "Avg Mins",  val: avgMins.toFixed(1), accent: false },
          { label: "P90",       val: p90.toFixed(2), accent: false },
        ].map(c => (
          <div key={c.label} className="px-2 py-1.5 text-center">
            <div className={`text-[10px] font-mono font-bold leading-tight ${
              c.accent ? "" : c.red ? "text-red-400/80" : "text-foreground/70"
            }`} style={c.accent ? { color: color || "#00ffff" } : undefined}>
              {c.val}
            </div>
            <div className="text-[7px] font-mono text-muted-foreground/35 uppercase tracking-wide mt-0.5">{c.label}</div>
          </div>
        ))}
      </div>

      {/* Bar chart */}
      <div className="px-3 pt-2 pb-1">
        {vals.length > 0 ? (
          <div className="flex items-end gap-[2px]" style={{ height: 36 }}>
            {playedWithIdx.map(({ ms, originalIdx }, barIdx) => {
              const v = statDef.getValue(ms);
              const h = globalMax > 0 ? Math.max(3, (v / globalMax) * 36) : 3;
              const isSelected = selectedBarIdx === barIdx;
              return (
                <button
                  key={originalIdx}
                  onClick={() => setSelectedBarIdx(prev => prev === barIdx ? null : barIdx)}
                  className="flex-1 min-w-[5px] rounded-t-[1px] transition-all"
                  style={{
                    height: `${h}px`,
                    backgroundColor: barColor(v),
                    opacity: selectedBarIdx !== null && !isSelected ? 0.3 : 1,
                    outline: isSelected ? `1.5px solid ${color || "#00ffff"}` : "none",
                    outlineOffset: "1px",
                  }}
                />
              );
            })}
          </div>
        ) : (
          <div className="h-9 flex items-center justify-center">
            <span className="text-[9px] font-mono text-muted-foreground/25">no match data</span>
          </div>
        )}
      </div>

      {/* Click popup */}
      <AnimatePresence>
        {sel && selMatch && (
          <motion.div
            key="popup"
            initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden border-t border-border/40">
            <div className="px-3 py-2 bg-muted/10">
              {/* Match header */}
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] font-mono font-semibold text-foreground/90">
                  {selMatch.isHome ? `vs ${selMatch.awayTeamName}` : `@ ${selMatch.homeTeamName}`}
                </span>
                <div className="flex items-center gap-1.5">
                  <span className={`text-[8px] font-mono px-1.5 py-0.5 border ${selMatch.isHome ? "border-primary/40 text-primary/70" : "border-border/40 text-muted-foreground/50"}`}>
                    {selMatch.isHome ? "H" : "A"}
                  </span>
                  <span className="text-[10px] font-mono font-bold text-foreground/80">
                    {selMatch.homeScore}–{selMatch.awayScore}
                  </span>
                </div>
              </div>
              {/* Detail grid */}
              <div className="grid grid-cols-3 gap-x-4 gap-y-1.5">
                {[
                  { k: "Date",     v: format(new Date(selMatch.date * 1000), "MMM d, yyyy") },
                  { k: "Position", v: sel.ms.matchPosition || "—" },
                  { k: "Started",  v: !sel.ms.isSubstitute ? "Yes" : "Sub" },
                  { k: "Minutes",  v: `${sel.ms.minutesPlayed}'` },
                  { k: "Rating",   v: sel.ms.rating > 0 ? sel.ms.rating.toFixed(1) : "—",
                    color: sel.ms.rating >= 7 ? "#4ade80" : sel.ms.rating >= 6 ? "#fbbf24" : sel.ms.rating > 0 ? "#f87171" : undefined },
                  { k: statDef.label, v: selVal !== null ? String(selVal) : "—",
                    color: selVal !== null && selVal > 0 ? (color || "#00ffff") : undefined },
                ].map(row => (
                  <div key={row.k} className="flex flex-col">
                    <span className="text-[7px] font-mono text-muted-foreground/40 uppercase tracking-wide">{row.k}</span>
                    <span className="text-[10px] font-mono font-semibold" style={{ color: row.color }}>
                      {row.v}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function LineupIntelPanel({ data, color }: { data: TeamData; color: string | null }) {
  const [statIdx, setStatIdx] = useState(0);
  const statDef = LINEUP_STATS[statIdx];
  const totalMatches = data.matches.length;

  const grouped = POS_CONFIG.map(({ pos, label, max }) => {
    const players = data.players
      .filter(p => p.position === pos && p.appearances > 0)
      .sort((a, b) => {
        if (b.appearances !== a.appearances) return b.appearances - a.appearances;
        const aMin = a.matchStats.reduce((s, ms) => s + (ms?.minutesPlayed ?? 0), 0);
        const bMin = b.matchStats.reduce((s, ms) => s + (ms?.minutesPlayed ?? 0), 0);
        return bMin - aMin;
      })
      .slice(0, max);
    return { pos, label, players };
  }).filter(g => g.players.length > 0);

  const globalMax = Math.max(
    ...data.players.flatMap(p =>
      p.matchStats.filter(Boolean).map(ms => statDef.getValue(ms!))
    ),
    1
  );

  return (
    <div className="space-y-5">
      <div className="flex gap-0 overflow-x-auto border-b border-border/50" style={{ scrollbarWidth: "none" }}>
        {LINEUP_STATS.map((s, i) => (
          <button key={i} onClick={() => setStatIdx(i)}
            className={`px-3 py-2 text-[10px] font-mono uppercase tracking-wider whitespace-nowrap border-b-2 transition-all flex-shrink-0 ${
              i === statIdx
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}>
            {s.label}
          </button>
        ))}
      </div>

      <div className="text-[9px] font-mono text-muted-foreground/50 uppercase tracking-widest">
        Ranked by appearance frequency — {statDef.label} per match
      </div>

      {grouped.map(({ pos, label, players }) => (
        <div key={pos} className="space-y-2">
          <div className="flex items-center gap-2">
            <div className="border border-border/50 px-2 py-0.5 text-[9px] font-mono text-muted-foreground uppercase tracking-widest">
              {label}
            </div>
            <div className="flex-1 h-px bg-border/20" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {players.map(p => (
              <PlayerIntelCard
                key={p.playerId}
                player={p}
                statDef={statDef}
                totalMatches={totalMatches}
                globalMax={globalMax}
                color={color}
                matches={data.matches}
              />
            ))}
          </div>
        </div>
      ))}

      {grouped.length === 0 && (
        <div className="border border-dashed border-border/30 p-8 text-center">
          <p className="text-xs font-mono text-muted-foreground/40">No lineup data available</p>
        </div>
      )}
    </div>
  );
}

// ─── Team Panel ───────────────────────────────────────────────────────────────

type ViewMode = "team" | "players" | "lineup";

function TeamPanel({ data, color }: { data: TeamData; color: string | null }) {
  const [teamTabIdx, setTeamTabIdx] = useState(0);
  const [playerTabIdx, setPlayerTabIdx] = useState(12);
  const [viewMode, setViewMode] = useState<ViewMode>("team");

  const hasHistory = (tab: TeamStatDef) => {
    const h = data.statHistory.find(sh => sh.label === tab.shKey);
    return !!(h && h.matches.length > 0);
  };

  const VIEW_LABELS: Record<ViewMode, string> = {
    team: "Team Stats",
    players: "Player Stats",
    lineup: "Lineup Intel",
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <span className="text-[9px] font-mono text-muted-foreground uppercase tracking-widest">Form</span>
        <FormBar matches={data.matches} />
        <span className="text-[9px] font-mono text-muted-foreground ml-2">{data.matches.length} matches</span>
      </div>
      <AvgCards data={data} />

      <div className="flex gap-0 border border-border/50 w-fit">
        {(["team", "players", "lineup"] as ViewMode[]).map(m => (
          <button key={m} onClick={() => setViewMode(m)}
            className={`px-4 py-1.5 text-[10px] font-mono uppercase tracking-widest transition-all border-r border-border/30 last:border-r-0 ${
              viewMode === m ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground"
            }`}>
            {VIEW_LABELS[m]}
          </button>
        ))}
      </div>

      {viewMode === "team" ? (
        <>
          <StatTabBar
            tabs={TEAM_STAT_TABS}
            selected={teamTabIdx}
            onSelect={setTeamTabIdx}
            getAvailable={hasHistory}
          />
          <div className="flex items-center gap-2">
            <span className={`text-xs font-mono uppercase tracking-widest ${
              hasHistory(TEAM_STAT_TABS[teamTabIdx]) ? "text-primary" : "text-muted-foreground/40"
            }`}>
              {TEAM_STAT_TABS[teamTabIdx].label}
            </span>
            <span className="text-[9px] font-mono text-muted-foreground">— per match</span>
          </div>
          <AnimatePresence mode="wait">
            <motion.div key={`team-${teamTabIdx}`}
              initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
              transition={{ duration: 0.12 }}>
              <TeamMatchTable data={data} tabIdx={teamTabIdx} color={color} />
            </motion.div>
          </AnimatePresence>
        </>
      ) : viewMode === "players" ? (
        <>
          <StatTabBar
            tabs={PLAYER_STAT_TABS}
            selected={playerTabIdx}
            onSelect={setPlayerTabIdx}
            getAvailable={tab => tab.available !== false}
          />
          <div className="flex items-center gap-2">
            <span className={`text-xs font-mono uppercase tracking-widest ${
              PLAYER_STAT_TABS[playerTabIdx].available !== false ? "text-primary" : "text-muted-foreground/40"
            }`}>
              {PLAYER_STAT_TABS[playerTabIdx].label}
            </span>
            <span className="text-[9px] font-mono text-muted-foreground">— per player per match</span>
          </div>
          <AnimatePresence mode="wait">
            <motion.div key={`players-${playerTabIdx}`}
              initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
              transition={{ duration: 0.12 }}>
              <PlayerMatchMatrix data={data} tabIdx={playerTabIdx} />
            </motion.div>
          </AnimatePresence>
        </>
      ) : (
        <AnimatePresence mode="wait">
          <motion.div key="lineup"
            initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.12 }}>
            <LineupIntelPanel data={data} color={color} />
          </motion.div>
        </AnimatePresence>
      )}
    </div>
  );
}

// ─── Compare Panel ────────────────────────────────────────────────────────────

function ComparePanel({ home, away, fixture }: {
  home: TeamData; away: TeamData;
  fixture: { homeTeam: { name: string; colorPrimary: string | null }; awayTeam: { name: string; colorPrimary: string | null } };
}) {
  const getAvg = (teamData: TeamData, label: string) => {
    const h = teamData.statHistory.find(sh => sh.label === label);
    if (!h || !h.matches.length) return 0;
    return h.matches.reduce((s, m) => s + m.myValue, 0) / h.matches.length;
  };

  const compareStats: { label: string; statLabel: string; dec: number }[] = [
    { label: "Goals",              statLabel: "Goals",              dec: 1 },
    { label: "Shots",              statLabel: "Shots",              dec: 1 },
    { label: "Shots on Target",    statLabel: "Shots On Goal",      dec: 1 },
    { label: "xG",                 statLabel: "Expected Goals",     dec: 2 },
    { label: "Big Chances",        statLabel: "Big Chance Created", dec: 1 },
    { label: "Passes",             statLabel: "Passes",             dec: 0 },
    { label: "Crosses",            statLabel: "Crosses",            dec: 1 },
    { label: "Corners",            statLabel: "Corners",            dec: 1 },
    { label: "Possession %",       statLabel: "Possession",         dec: 0 },
    { label: "Tackles",            statLabel: "Tackles",            dec: 1 },
    { label: "Interceptions",      statLabel: "Interception Won",   dec: 1 },
    { label: "Clearances",         statLabel: "Total Clearance",    dec: 1 },
    { label: "Fouls",              statLabel: "Fouls",              dec: 1 },
    { label: "Yellow Cards",       statLabel: "Yellow Cards",       dec: 1 },
    { label: "Saves",              statLabel: "Goalkeeper Saves",   dec: 1 },
    { label: "Offsides",           statLabel: "Offsides",           dec: 1 },
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
          const h = getAvg(home, s.statLabel);
          const a = getAvg(away, s.statLabel);
          const total = h + a;
          const hPct = total === 0 ? 50 : Math.round((h / total) * 100);
          return (
            <div key={s.statLabel} className="grid grid-cols-[60px_1fr_60px] items-center gap-2 px-3 py-2">
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

// ─── Prediction types ─────────────────────────────────────────────────────────

interface ProbMap { H: number; D: number; A: number }
interface Prob2 { yes: number; no: number }
interface ScoreProb { home: number; away: number; prob: number }
interface ValueBet { market: string; outcome: string; modelProb: number; impliedProb: number; edge: number; bestOdds: number }
interface CornerPred { predicted: number; over85: number; over95: number; over105: number }
interface BestOdds { H?: number; D?: number; A?: number; yes?: number; no?: number; "1X"?: number; "12"?: number; X2?: number }
interface ArbLeg { outcome: string; bookmaker: string; odds: number; stakePercent: number }
interface ArbOpportunity { market: string; impliedSum: number; profitPct: number; legs: ArbLeg[] }
interface RawOdds1X2 { bookmaker: string; H: number | null; D: number | null; A: number | null }
interface RawOddsBTTS { bookmaker: string; yes: number | null; no: number | null }
interface RawOddsOU { bookmaker: string; line: number; over: number | null; under: number | null }
interface RawOddsDC { bookmaker: string; "1X": number | null; X2: number | null; "12": number | null }
interface FixturePrediction {
  method: string; featureQuality: string;
  onex2: ProbMap; dc: { "1X": number; "12": number; X2: number };
  btts: Prob2; corners: CornerPred;
  correctScores: ScoreProb[]; valueBets: ValueBet[];
  arbitrage: ArbOpportunity[];
  lambdaHome: number; lambdaAway: number;
  bestOdds: BestOdds;
  impliedProbs: { H?: number; D?: number; A?: number; yes?: number; no?: number };
  rawOdds?: {
    onex2: RawOdds1X2[];
    btts:  RawOddsBTTS[];
    ou:    RawOddsOU[];
    dc:    RawOddsDC[];
  };
}

// ─── Bookmaker Odds Table ─────────────────────────────────────────────────────

type RawOddsAll = NonNullable<FixturePrediction["rawOdds"]>;

function OddsCell({ v }: { v: number | null }) {
  if (v === null || v === undefined) return <td className="text-right text-muted-foreground/25 text-[10px] font-mono px-2 py-1">—</td>;
  return <td className="text-right text-[10px] font-mono font-bold text-foreground/80 px-2 py-1">{v.toFixed(2)}</td>;
}

function BookmakerOddsTable({ rawOdds }: { rawOdds: RawOddsAll }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"1X2" | "BTTS" | "O/U" | "DC">("1X2");

  const tabs: Array<{ id: typeof tab; count: number }> = [
    { id: "1X2",  count: rawOdds.onex2.length },
    { id: "BTTS", count: rawOdds.btts.length },
    { id: "O/U",  count: [...new Set(rawOdds.ou.map(e => e.bookmaker))].length },
    { id: "DC",   count: rawOdds.dc.length },
  ].filter(t => t.count > 0) as Array<{ id: typeof tab; count: number }>;

  // For O/U: group by bookmaker, then list each line
  const ouByBookmaker = rawOdds.ou.reduce<Record<string, RawOddsOU[]>>((acc, e) => {
    (acc[e.bookmaker] ??= []).push(e);
    return acc;
  }, {});
  const ouLines = [...new Set(rawOdds.ou.map(e => e.line))].sort((a, b) => a - b);

  return (
    <div className="border border-border/30 bg-card/20">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-3 py-2 text-[10px] font-mono uppercase tracking-widest text-muted-foreground/60 hover:text-foreground/60 transition-colors"
      >
        <span className="flex items-center gap-2">
          <span className="text-muted-foreground/40">▸</span>
          Bookmaker Odds Breakdown
          <span className="text-muted-foreground/30">
            ({rawOdds.onex2.length + rawOdds.btts.length + [...new Set(rawOdds.ou.map(e => e.bookmaker))].length + rawOdds.dc.length} entries)
          </span>
        </span>
        <span className={`transition-transform duration-200 ${open ? "rotate-90" : ""}`}>▶</span>
      </button>

      {open && (
        <div className="border-t border-border/20">
          {/* Market tabs */}
          <div className="flex border-b border-border/20">
            {tabs.map(t => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`px-3 py-1.5 text-[9px] font-mono uppercase tracking-wider transition-colors ${
                  tab === t.id
                    ? "text-primary border-b border-primary"
                    : "text-muted-foreground/40 hover:text-muted-foreground/70"
                }`}
              >
                {t.id} <span className="text-muted-foreground/30">({t.count})</span>
              </button>
            ))}
          </div>

          <div className="overflow-x-auto max-h-56 overflow-y-auto" style={{ scrollbarWidth: "thin" }}>
            {tab === "1X2" && rawOdds.onex2.length > 0 && (
              <table className="w-full text-[10px]">
                <thead className="sticky top-0 bg-card/90">
                  <tr className="border-b border-border/20">
                    <th className="text-left text-muted-foreground/50 font-mono font-normal px-2 py-1 uppercase tracking-wider">Bookmaker</th>
                    <th className="text-right text-muted-foreground/50 font-mono font-normal px-2 py-1 uppercase tracking-wider">1</th>
                    <th className="text-right text-muted-foreground/50 font-mono font-normal px-2 py-1 uppercase tracking-wider">X</th>
                    <th className="text-right text-muted-foreground/50 font-mono font-normal px-2 py-1 uppercase tracking-wider">2</th>
                  </tr>
                </thead>
                <tbody>
                  {rawOdds.onex2.map((e, i) => (
                    <tr key={i} className="border-b border-border/10 hover:bg-muted/5">
                      <td className="text-left text-[10px] font-mono text-muted-foreground/70 px-2 py-1">{e.bookmaker}</td>
                      <OddsCell v={e.H} />
                      <OddsCell v={e.D} />
                      <OddsCell v={e.A} />
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {tab === "BTTS" && rawOdds.btts.length > 0 && (
              <table className="w-full text-[10px]">
                <thead className="sticky top-0 bg-card/90">
                  <tr className="border-b border-border/20">
                    <th className="text-left text-muted-foreground/50 font-mono font-normal px-2 py-1 uppercase tracking-wider">Bookmaker</th>
                    <th className="text-right text-muted-foreground/50 font-mono font-normal px-2 py-1 uppercase tracking-wider">Yes</th>
                    <th className="text-right text-muted-foreground/50 font-mono font-normal px-2 py-1 uppercase tracking-wider">No</th>
                  </tr>
                </thead>
                <tbody>
                  {rawOdds.btts.map((e, i) => (
                    <tr key={i} className="border-b border-border/10 hover:bg-muted/5">
                      <td className="text-left text-[10px] font-mono text-muted-foreground/70 px-2 py-1">{e.bookmaker}</td>
                      <OddsCell v={e.yes} />
                      <OddsCell v={e.no} />
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {tab === "O/U" && rawOdds.ou.length > 0 && (
              <table className="w-full text-[10px]">
                <thead className="sticky top-0 bg-card/90">
                  <tr className="border-b border-border/20">
                    <th className="text-left text-muted-foreground/50 font-mono font-normal px-2 py-1 uppercase tracking-wider">Bookmaker</th>
                    {ouLines.map(l => (
                      <React.Fragment key={l}>
                        <th className="text-right text-muted-foreground/50 font-mono font-normal px-2 py-1 uppercase tracking-wider">O{l}</th>
                        <th className="text-right text-muted-foreground/50 font-mono font-normal px-2 py-1 uppercase tracking-wider">U{l}</th>
                      </React.Fragment>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(ouByBookmaker).map(([bookie, entries]) => (
                    <tr key={bookie} className="border-b border-border/10 hover:bg-muted/5">
                      <td className="text-left text-[10px] font-mono text-muted-foreground/70 px-2 py-1">{bookie}</td>
                      {ouLines.map(l => {
                        const e = entries.find(x => Math.abs(x.line - l) < 0.01);
                        return (
                          <React.Fragment key={l}>
                            <OddsCell v={e?.over ?? null} />
                            <OddsCell v={e?.under ?? null} />
                          </React.Fragment>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {tab === "DC" && rawOdds.dc.length > 0 && (
              <table className="w-full text-[10px]">
                <thead className="sticky top-0 bg-card/90">
                  <tr className="border-b border-border/20">
                    <th className="text-left text-muted-foreground/50 font-mono font-normal px-2 py-1 uppercase tracking-wider">Bookmaker</th>
                    <th className="text-right text-muted-foreground/50 font-mono font-normal px-2 py-1 uppercase tracking-wider">1X</th>
                    <th className="text-right text-muted-foreground/50 font-mono font-normal px-2 py-1 uppercase tracking-wider">X2</th>
                    <th className="text-right text-muted-foreground/50 font-mono font-normal px-2 py-1 uppercase tracking-wider">12</th>
                  </tr>
                </thead>
                <tbody>
                  {rawOdds.dc.map((e, i) => (
                    <tr key={i} className="border-b border-border/10 hover:bg-muted/5">
                      <td className="text-left text-[10px] font-mono text-muted-foreground/70 px-2 py-1">{e.bookmaker}</td>
                      <OddsCell v={e["1X"]} />
                      <OddsCell v={e.X2} />
                      <OddsCell v={e["12"]} />
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Fixture Prediction Panel ─────────────────────────────────────────────────

function ProbBar({ label, modelPct, impliedPct, odds }: { label: string; modelPct: number; impliedPct: number; odds?: number }) {
  const edge = modelPct - impliedPct;
  const isValue = impliedPct > 0 && edge > 4;
  return (
    <div className={`p-3 border rounded-sm ${isValue ? "border-amber-500/40 bg-amber-500/5" : "border-border/30 bg-card/20"}`}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-[11px] font-mono font-bold text-foreground/80">{label}</span>
        <div className="flex items-center gap-2 text-[10px] font-mono">
          {odds && <span className="text-muted-foreground/50">@{odds.toFixed(2)}</span>}
          {isValue && <span className="text-amber-400 font-bold flex items-center gap-0.5"><Zap className="w-2.5 h-2.5" />VALUE</span>}
        </div>
      </div>
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <span className="text-[9px] text-muted-foreground/50 w-12 shrink-0 uppercase tracking-wider">Model</span>
          <div className="flex-1 h-1.5 bg-muted/20 overflow-hidden rounded-full">
            <div className="h-full bg-primary/70 transition-all duration-500" style={{ width: `${Math.min(modelPct, 100)}%` }} />
          </div>
          <span className={`text-[10px] font-mono font-bold w-8 text-right ${isValue ? "text-amber-400" : "text-foreground"}`}>{modelPct.toFixed(0)}%</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[9px] text-muted-foreground/50 w-12 shrink-0 uppercase tracking-wider">Implied</span>
          <div className="flex-1 h-1.5 bg-muted/20 overflow-hidden rounded-full">
            <div className="h-full bg-muted-foreground/40 transition-all duration-500" style={{ width: `${Math.min(impliedPct, 100)}%` }} />
          </div>
          <span className="text-[10px] font-mono text-muted-foreground/60 w-8 text-right">{impliedPct.toFixed(0)}%</span>
        </div>
      </div>
      {isValue && (
        <div className="mt-1.5 text-[9px] font-mono text-amber-400/70">
          +{edge.toFixed(1)}% edge
        </div>
      )}
    </div>
  );
}

function FixturePredictionPanel({ homeTeamId, awayTeamId, homeTeam, awayTeam, kickoffTs }: {
  homeTeamId: number; awayTeamId: number;
  homeTeam: string; awayTeam: string; kickoffTs: number;
}) {
  const [pred, setPred] = useState<FixturePrediction | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState("Predicting…");
  const [err, setErr] = useState<string | null>(null);
  const [trained, setTrained] = useState<boolean | null>(null);

  React.useEffect(() => {
    fetch("/api/model/status")
      .then(r => r.json())
      .then(s => setTrained(s.trained))
      .catch(() => setTrained(false));
  }, []);

  const runPrediction = async () => {
    setLoading(true); setErr(null); setPred(null);
    setLoadingMsg("Fetching live data…");
    const msgTimer = setTimeout(() => setLoadingMsg("Scraping stats & odds…"), 5000);
    try {
      const r = await fetch("/api/model/predict-live", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ homeTeamId, awayTeamId, homeTeam, awayTeam, kickoffTs }),
      });
      if (!r.ok) { setErr("error"); return; }
      setPred(await r.json());
    } catch { setErr("error"); } finally { clearTimeout(msgTimer); setLoading(false); }
  };

  const imp = pred?.impliedProbs ?? {};
  const bo  = pred?.bestOdds ?? {};

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-4" style={{ scrollbarWidth: "thin" }}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Brain className="w-4 h-4 text-primary/60" />
          <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground/60">ML Predictions</span>
          {pred && (
            <span className="text-[9px] font-mono text-muted-foreground/40 border border-border/30 px-1.5 py-0.5">
              {pred.method} · {pred.featureQuality}
            </span>
          )}
        </div>
        <button
          onClick={runPrediction}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-mono uppercase tracking-widest border border-primary/50 text-primary hover:bg-primary/10 transition-all disabled:opacity-40"
        >
          <Brain className={`w-3 h-3 ${loading ? "animate-pulse" : ""}`} />
          {loading ? loadingMsg : pred ? "Refresh" : "Run Prediction"}
        </button>
      </div>

      {/* Not trained warning */}
      {trained === false && (
        <div className="text-[11px] font-mono text-amber-400/70 border border-amber-500/20 bg-amber-500/5 p-3">
          ⚠ Model not trained yet — go to the Database page and click "Train Model" first.
        </div>
      )}

      {err === "error" && (
        <div className="text-[11px] font-mono text-destructive/70 border border-destructive/20 p-3">
          Prediction failed — check the server logs.
        </div>
      )}

      {/* Idle state */}
      {!pred && !loading && !err && (
        <div className="text-center py-10 text-muted-foreground/30">
          <Brain className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="text-[11px] font-mono uppercase tracking-widest">Click "Run Prediction" to generate probabilities</p>
        </div>
      )}

      {/* Results */}
      {pred && (
        <>
          {/* ── SURE-BET / ARBITRAGE — shown first, most actionable ── */}
          <div className={`border p-3 ${pred.arbitrage && pred.arbitrage.length > 0 ? "border-green-500/40 bg-green-500/8" : "border-border/20 bg-card/10"}`}>
            <div className="text-[10px] font-mono uppercase tracking-widest mb-2 flex items-center gap-2">
              {pred.arbitrage && pred.arbitrage.length > 0 ? (
                <>
                  <span className="px-2 py-0.5 bg-green-500/20 border border-green-500/50 text-green-300 text-[9px] font-bold tracking-widest">SURE-BET FOUND</span>
                  <span className="text-green-400/80">{pred.arbitrage.length} market{pred.arbitrage.length > 1 ? "s" : ""} with guaranteed profit</span>
                </>
              ) : (
                <>
                  <span className="px-2 py-0.5 bg-muted/20 border border-border/30 text-muted-foreground/40 text-[9px] font-bold tracking-widest">NO SURE-BET</span>
                  <span className="text-muted-foreground/30">No arbitrage across available bookmakers</span>
                </>
              )}
            </div>
            {pred.arbitrage && pred.arbitrage.length > 0 && (
              <div className="space-y-2 mt-3">
                {pred.arbitrage.map((arb, i) => (
                  <div key={i} className="border border-green-500/30 bg-green-500/5 p-3">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[11px] font-mono font-bold text-green-400">{arb.market}</span>
                      <div className="flex items-center gap-2">
                        <span className="text-[9px] font-mono text-muted-foreground/50">Σ implied = {arb.impliedSum.toFixed(4)}</span>
                        <span className="text-[12px] font-mono font-bold text-green-300 bg-green-500/20 border border-green-500/30 px-2 py-0.5">
                          +{arb.profitPct.toFixed(2)}% profit
                        </span>
                      </div>
                    </div>
                    <div className="space-y-1">
                      {arb.legs.map((leg, j) => (
                        <div key={j} className="flex items-center gap-2 text-[10px] font-mono">
                          <span className="text-muted-foreground/60 w-10 shrink-0">{leg.outcome}</span>
                          <span className="text-foreground font-bold">@{leg.odds.toFixed(2)}</span>
                          <span className="text-muted-foreground/50 flex-1">{leg.bookmaker}</span>
                          <span className="text-green-400 font-bold">{leg.stakePercent.toFixed(1)}% of stake</span>
                        </div>
                      ))}
                    </div>
                    <p className="mt-2 text-[9px] font-mono text-muted-foreground/35">
                      Split your stake at the % above across all legs — profit is guaranteed regardless of outcome.
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ── VALUE BETS — shown second ── */}
          {pred.valueBets.length > 0 ? (
            <div className="border border-amber-500/30 bg-amber-500/5 p-3">
              <div className="text-[10px] font-mono uppercase tracking-widest text-amber-400/80 mb-2 flex items-center gap-2">
                <Star className="w-3 h-3" />
                Value Bets — {pred.valueBets.length} opportunity{pred.valueBets.length > 1 ? "ies" : "y"} detected
              </div>
              <div className="space-y-1.5">
                {pred.valueBets.map((v, i) => (
                  <div key={i} className="flex items-center gap-3 border border-amber-500/20 bg-amber-500/5 p-2.5">
                    <span className="text-[11px] font-mono font-bold text-foreground/80 flex-1">{v.market} · {v.outcome}</span>
                    <div className="flex items-center gap-3 text-[10px] font-mono">
                      <span className="text-muted-foreground/50">Model {(v.modelProb * 100).toFixed(0)}%</span>
                      <span className="text-muted-foreground/50">Implied {(v.impliedProb * 100).toFixed(0)}%</span>
                      <span className="text-amber-300 font-bold">+{(v.edge * 100).toFixed(1)}% edge</span>
                      <span className="text-primary font-bold">@{v.bestOdds.toFixed(2)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="text-[9px] font-mono text-muted-foreground/25 flex items-center gap-1.5">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-muted-foreground/20" />
              No value bets detected (model edge &lt; 4% vs implied odds)
            </div>
          )}

          {/* ── 1X2 ── */}
          <div>
            <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground/50 mb-2 flex items-center gap-1.5">
              <TrendingUp className="w-3 h-3" /> Match Result (1X2)
            </div>
            <div className="grid grid-cols-3 gap-2">
              <ProbBar label="Home Win" modelPct={pred.onex2.H * 100} impliedPct={(imp.H ?? 0) * 100} odds={bo.H} />
              <ProbBar label="Draw"     modelPct={pred.onex2.D * 100} impliedPct={(imp.D ?? 0) * 100} odds={bo.D} />
              <ProbBar label="Away Win" modelPct={pred.onex2.A * 100} impliedPct={(imp.A ?? 0) * 100} odds={bo.A} />
            </div>
          </div>

          {/* ── BTTS ── */}
          <div>
            <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground/50 mb-2">Both Teams to Score</div>
            <div className="grid grid-cols-2 gap-2">
              <ProbBar label="BTTS Yes" modelPct={pred.btts.yes * 100} impliedPct={(imp.yes ?? 0) * 100} odds={bo.yes} />
              <ProbBar label="BTTS No"  modelPct={pred.btts.no  * 100} impliedPct={(imp.no  ?? 0) * 100} odds={bo.no}  />
            </div>
          </div>

          {/* ── Double Chance ── */}
          <div>
            <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground/50 mb-2">Double Chance</div>
            <div className="grid grid-cols-3 gap-2">
              <ProbBar label="1X" modelPct={pred.dc["1X"] * 100} impliedPct={0} odds={bo["1X"]} />
              <ProbBar label="12" modelPct={pred.dc["12"] * 100} impliedPct={0} odds={bo["12"]} />
              <ProbBar label="X2" modelPct={pred.dc["X2"] * 100} impliedPct={0} odds={bo["X2"]} />
            </div>
          </div>

          {/* ── Corners ── */}
          <div className="border border-border/30 bg-card/20 p-3">
            <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground/50 mb-3">Total Corners</div>
            <div className="grid grid-cols-4 gap-3">
              {[
                { label: "Predicted", value: pred.corners.predicted, unit: "" },
                { label: "Over 8.5",  value: pred.corners.over85,    unit: "%" },
                { label: "Over 9.5",  value: pred.corners.over95,    unit: "%" },
                { label: "Over 10.5", value: pred.corners.over105,   unit: "%" },
              ].map(({ label, value, unit }) => (
                <div key={label} className="text-center">
                  <div className="text-lg font-mono font-bold text-foreground">{value}{unit}</div>
                  <div className="text-[9px] text-muted-foreground/50 uppercase tracking-wider">{label}</div>
                </div>
              ))}
            </div>
          </div>

          {/* ── Correct Scores ── */}
          <div>
            <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground/50 mb-2">Most Likely Correct Scores</div>
            <div className="grid grid-cols-5 gap-1.5">
              {pred.correctScores.slice(0, 10).map(s => (
                <div key={`${s.home}-${s.away}`} className="border border-border/30 bg-card/20 p-2 text-center">
                  <div className="text-sm font-mono font-bold text-foreground">{s.home}–{s.away}</div>
                  <div className="text-[9px] font-mono text-muted-foreground/50">{(s.prob * 100).toFixed(1)}%</div>
                </div>
              ))}
            </div>
          </div>

          {/* ── Bookmaker Odds Table ── */}
          {pred.rawOdds && (pred.rawOdds.onex2.length > 0 || pred.rawOdds.btts.length > 0 || pred.rawOdds.ou.length > 0 || pred.rawOdds.dc.length > 0) && (
            <BookmakerOddsTable rawOdds={pred.rawOdds} />
          )}

          {/* ── Poisson debug ── */}
          <div className="text-[9px] font-mono text-muted-foreground/30 border-t border-border/20 pt-2">
            Poisson λ: Home {pred.lambdaHome.toFixed(2)} · Away {pred.lambdaAway.toFixed(2)} · {pred.method} · {pred.featureQuality} data
          </div>
        </>
      )}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function FixtureDetail() {
  const { id } = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const [activeTab, setActiveTab] = useState<"home" | "away" | "compare" | "analysis" | "odds" | "predictions">("home");

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

          <div className="flex gap-0 border-b border-border/50 overflow-x-auto" style={{ scrollbarWidth: "none" }}>
            {(["home", "away", "compare", "analysis", "odds", "predictions"] as const).map(tab => (
              <button key={tab} onClick={() => setActiveTab(tab)}
                className={`px-4 py-2 text-xs font-mono uppercase tracking-widest border-b-2 transition-all -mb-px whitespace-nowrap flex-shrink-0 flex items-center gap-1.5 ${
                  activeTab === tab ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
                }`}>
                {tab === "home" ? fixture.homeTeam.name
                  : tab === "away" ? fixture.awayTeam.name
                  : tab === "compare" ? "Compare"
                  : tab === "analysis" ? "⚡ Analysis"
                  : tab === "odds" ? "📊 Odds"
                  : <><Brain className="w-3 h-3" />Predictions</>}
              </button>
            ))}
          </div>

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
            ) : activeTab === "analysis" && home && away ? (
              <motion.div key="analysis" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <PlayerAnalysisPanel home={home} away={away} fixture={fixture} />
              </motion.div>
            ) : activeTab === "odds" && home && away ? (
              <motion.div key="odds" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <BettingOddsPanel home={home} away={away} fixture={fixture} />
              </motion.div>
            ) : activeTab === "predictions" ? (
              <motion.div key="predictions" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                className="border border-border/30 bg-card/20 min-h-[400px] flex flex-col">
                <FixturePredictionPanel
                  homeTeamId={(fixture.homeTeam as { id: number }).id}
                  awayTeamId={(fixture.awayTeam as { id: number }).id}
                  homeTeam={(fixture.homeTeam as { name: string }).name}
                  awayTeam={(fixture.awayTeam as { name: string }).name}
                  kickoffTs={fixture.kickoffTimestamp as number}
                />
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
