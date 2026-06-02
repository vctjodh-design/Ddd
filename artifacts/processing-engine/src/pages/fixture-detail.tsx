import React, { useState, useRef } from "react";
import { useParams, useLocation } from "wouter";
import { format } from "date-fns";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowLeft, Activity, ChevronLeft, ChevronRight } from "lucide-react";
import { useGetFixtureDetail } from "@workspace/api-client-react";

// ─── Stat definitions ────────────────────────────────────────────────────────

type StatKey =
  | "goals" | "assists" | "goalOrAssist" | "shots" | "shotsOnTarget"
  | "shotsOffTarget" | "blockedShots" | "xG" | "xA" | "xGxA"
  | "bigChancesCreated" | "keyPasses" | "passes" | "accuratePasses"
  | "crosses" | "accurateCrosses" | "longBalls" | "tackles" | "interceptions"
  | "clearances" | "aerialWon" | "duelWon" | "saves" | "fouls" | "foulsWon"
  | "foulInvolvements" | "yellowCard" | "redCard" | "offsides"
  | "dispossessed" | "possessionLost" | "wonContest";

// For team stats the key mapping is slightly different (yellowCards vs yellowCard)
type TeamStatKey =
  | "goals" | "assists" | "shots" | "shotsOnTarget" | "shotsOffTarget"
  | "blockedShots" | "xG" | "xA" | "bigChancesCreated" | "keyPasses"
  | "passes" | "accuratePasses" | "crosses" | "accurateCrosses" | "longBalls"
  | "tackles" | "interceptions" | "clearances" | "aerialWon" | "duelWon"
  | "saves" | "fouls" | "foulsWon" | "yellowCards" | "redCards" | "offsides"
  | "dispossessed" | "possessionLost" | "wonContest";

interface StatDef {
  key: StatKey;
  teamKey: TeamStatKey;
  label: string;
  short: string;
  decimals: number;
  group: string;
}

const STATS: StatDef[] = [
  // Attacking
  { key: "goals",           teamKey: "goals",           label: "Goals",           short: "G",    decimals: 0, group: "Attack" },
  { key: "assists",         teamKey: "assists",          label: "Assists",          short: "A",    decimals: 0, group: "Attack" },
  { key: "goalOrAssist",    teamKey: "goals",            label: "G + A",            short: "G+A",  decimals: 0, group: "Attack" },
  { key: "shots",           teamKey: "shots",            label: "Shots",            short: "Sh",   decimals: 0, group: "Attack" },
  { key: "shotsOnTarget",   teamKey: "shotsOnTarget",    label: "Shots On Target",  short: "SoT",  decimals: 0, group: "Attack" },
  { key: "shotsOffTarget",  teamKey: "shotsOffTarget",   label: "Shots Off Target", short: "SoFF", decimals: 0, group: "Attack" },
  { key: "blockedShots",    teamKey: "blockedShots",     label: "Blocked Shots",    short: "BlSh", decimals: 0, group: "Attack" },
  { key: "xG",              teamKey: "xG",               label: "xG",               short: "xG",   decimals: 2, group: "Attack" },
  { key: "xA",              teamKey: "xA",               label: "xA",               short: "xA",   decimals: 2, group: "Attack" },
  { key: "xGxA",            teamKey: "goals",            label: "xG + xA",          short: "xG+A", decimals: 2, group: "Attack" },
  { key: "bigChancesCreated", teamKey: "bigChancesCreated", label: "Big Chances Created", short: "BC", decimals: 0, group: "Attack" },
  { key: "keyPasses",       teamKey: "keyPasses",        label: "Key Passes",       short: "KP",   decimals: 0, group: "Attack" },
  // Passing
  { key: "passes",          teamKey: "passes",           label: "Passes",           short: "Pas",  decimals: 0, group: "Passing" },
  { key: "accuratePasses",  teamKey: "accuratePasses",   label: "Accurate Passes",  short: "APas", decimals: 0, group: "Passing" },
  { key: "crosses",         teamKey: "crosses",          label: "Crosses",          short: "Cr",   decimals: 0, group: "Passing" },
  { key: "accurateCrosses", teamKey: "accurateCrosses",  label: "Accurate Crosses", short: "ACr",  decimals: 0, group: "Passing" },
  { key: "longBalls",       teamKey: "longBalls",        label: "Long Balls",       short: "LB",   decimals: 0, group: "Passing" },
  // Defending
  { key: "tackles",         teamKey: "tackles",          label: "Tackles",          short: "Tck",  decimals: 0, group: "Defense" },
  { key: "interceptions",   teamKey: "interceptions",    label: "Interceptions",    short: "Int",  decimals: 0, group: "Defense" },
  { key: "clearances",      teamKey: "clearances",       label: "Clearances",       short: "Clr",  decimals: 0, group: "Defense" },
  { key: "aerialWon",       teamKey: "aerialWon",        label: "Aerial Won",       short: "Aer",  decimals: 0, group: "Defense" },
  { key: "duelWon",         teamKey: "duelWon",          label: "Duel Won",         short: "DW",   decimals: 0, group: "Defense" },
  { key: "saves",           teamKey: "saves",            label: "Saves",            short: "Sav",  decimals: 0, group: "Defense" },
  // Discipline
  { key: "fouls",           teamKey: "fouls",            label: "Fouls Committed",  short: "Fls",  decimals: 0, group: "Discipline" },
  { key: "foulsWon",        teamKey: "foulsWon",         label: "Fouls Won",        short: "FW",   decimals: 0, group: "Discipline" },
  { key: "foulInvolvements",teamKey: "fouls",            label: "Foul Involvements",short: "FI",   decimals: 0, group: "Discipline" },
  { key: "yellowCard",      teamKey: "yellowCards",      label: "Yellow Cards",     short: "YC",   decimals: 0, group: "Discipline" },
  { key: "redCard",         teamKey: "redCards",         label: "Red Cards",        short: "RC",   decimals: 0, group: "Discipline" },
  { key: "offsides",        teamKey: "offsides",         label: "Offsides",         short: "Off",  decimals: 0, group: "Discipline" },
  // Other
  { key: "dispossessed",    teamKey: "dispossessed",     label: "Dispossessed",     short: "Dis",  decimals: 0, group: "Other" },
  { key: "possessionLost",  teamKey: "possessionLost",   label: "Possession Lost",  short: "PL",   decimals: 0, group: "Other" },
  { key: "wonContest",      teamKey: "wonContest",       label: "Won Contest",      short: "WC",   decimals: 0, group: "Other" },
];

const STAT_GROUPS = ["Attack", "Passing", "Defense", "Discipline", "Other"];

// ─── Types ───────────────────────────────────────────────────────────────────

interface PlayerMatchStats {
  minutesPlayed: number; isSubstitute: boolean;
  goals: number; assists: number; goalOrAssist: number;
  shots: number; shotsOnTarget: number; shotsOffTarget: number; blockedShots: number;
  passes: number; accuratePasses: number; crosses: number; accurateCrosses: number; longBalls: number; accurateLongBalls: number;
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

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtVal(v: number | boolean | null | undefined, dec: number): string {
  if (v === null || v === undefined) return "-";
  if (typeof v === "boolean") return v ? "1" : "0";
  if (dec === 0) return String(v);
  return v.toFixed(dec);
}

function getPlayerVal(ms: PlayerMatchStats | null, key: StatKey): number {
  if (!ms) return 0;
  const v = ms[key as keyof PlayerMatchStats];
  if (typeof v === "boolean") return v ? 1 : 0;
  return (v as number) ?? 0;
}

function getTeamVal(ts: TeamMatchStats, key: TeamStatKey): number {
  return (ts[key as keyof TeamMatchStats] as number) ?? 0;
}

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

// ─── Stat Tab Bar ─────────────────────────────────────────────────────────────

function StatTabBar({ selected, onSelect }: { selected: number; onSelect: (i: number) => void }) {
  const scrollRef = useRef<HTMLDivElement>(null);

  const scroll = (dir: -1 | 1) => {
    scrollRef.current?.scrollBy({ left: dir * 200, behavior: "smooth" });
  };

  return (
    <div className="relative flex items-center gap-1">
      <button onClick={() => scroll(-1)} className="flex-shrink-0 w-6 h-6 flex items-center justify-center text-muted-foreground hover:text-primary">
        <ChevronLeft className="w-4 h-4" />
      </button>
      <div ref={scrollRef} className="flex gap-0 overflow-x-auto scrollbar-hide border-b border-border/50 flex-1" style={{ scrollbarWidth: "none" }}>
        {STAT_GROUPS.map((group) => {
          const groupStats = STATS.filter(s => s.group === group);
          return (
            <div key={group} className="flex items-center flex-shrink-0">
              <span className="text-[8px] font-mono uppercase text-muted-foreground/50 px-2 border-r border-border/30 whitespace-nowrap self-center">
                {group}
              </span>
              {groupStats.map((stat, _) => {
                const idx = STATS.indexOf(stat);
                const isActive = idx === selected;
                return (
                  <button key={stat.key} onClick={() => onSelect(idx)}
                    className={`px-3 py-2 text-[10px] font-mono uppercase tracking-wider whitespace-nowrap border-b-2 transition-all flex-shrink-0 ${
                      isActive ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
                    }`}>
                    {stat.label}
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>
      <button onClick={() => scroll(1)} className="flex-shrink-0 w-6 h-6 flex items-center justify-center text-muted-foreground hover:text-primary">
        <ChevronRight className="w-4 h-4" />
      </button>
    </div>
  );
}

// ─── Computed match stat values (handles derived stats like xG+xA) ────────────

function matchStatPair(m: Match, key: StatKey): { ours: number; theirs: number } {
  if (key === "xGxA") return { ours: m.teamStats.xG + m.teamStats.xA, theirs: m.oppStats.xG + m.oppStats.xA };
  if (key === "goalOrAssist") return { ours: m.teamStats.goals + m.teamStats.assists, theirs: m.oppStats.goals + m.oppStats.assists };
  if (key === "foulInvolvements") return { ours: m.teamStats.fouls + m.teamStats.foulsWon, theirs: m.oppStats.fouls + m.oppStats.foulsWon };
  const stat = STATS.find(s => s.key === key)!;
  return { ours: getTeamVal(m.teamStats, stat.teamKey), theirs: getTeamVal(m.oppStats, stat.teamKey) };
}

// ─── Team Match Table ─────────────────────────────────────────────────────────

function TeamMatchTable({ data, statIdx, color }: { data: TeamData; statIdx: number; color: string | null }) {
  const stat = STATS[statIdx];
  const sorted = [...data.matches].sort((a, b) => b.date - a.date);

  // Compute max value for color scale
  const vals = sorted.map(m => matchStatPair(m, stat.key).ours);
  const maxVal = Math.max(...vals, 1);

  return (
    <div className="border border-border/50 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-xs font-mono">
          <thead>
            <tr className="bg-card border-b border-border/50">
              <th className="text-left px-3 py-2 text-[9px] text-muted-foreground uppercase tracking-wider">Date</th>
              <th className="text-left px-3 py-2 text-[9px] text-muted-foreground uppercase tracking-wider">Match</th>
              <th className="text-center px-3 py-2 text-[9px] uppercase tracking-wider" style={{ color: color || "#00ffff" }}>
                Ours
              </th>
              <th className="text-center px-3 py-2 text-[9px] text-muted-foreground uppercase tracking-wider">Theirs</th>
              <th className="text-center px-2 py-2 text-[9px] text-muted-foreground uppercase tracking-wider">Res</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/20">
            {sorted.map((m, i) => {
              const { ours: ourVal, theirs: oppVal } = matchStatPair(m, stat.key);
              const intensity = maxVal > 0 ? ourVal / maxVal : 0;
              return (
                <motion.tr key={m.eventId}
                  initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.025 }}
                  className="hover:bg-white/[0.02]">
                  <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">
                    {format(new Date(m.date * 1000), "dd MMM")}
                  </td>
                  <td className="px-3 py-2 max-w-[180px]">
                    <span className={m.isHome ? "text-primary/90" : "text-foreground/60"}>
                      {m.homeTeamName}
                    </span>
                    <span className="text-muted-foreground mx-1 text-[10px]">
                      {m.homeScore}-{m.awayScore}
                    </span>
                    <span className={!m.isHome ? "text-primary/90" : "text-foreground/60"}>
                      {m.awayTeamName}
                    </span>
                    {m.tournamentName && (
                      <div className="text-[9px] text-muted-foreground/50 truncate max-w-[160px]">{m.tournamentName}</div>
                    )}
                  </td>
                  <td className="px-3 py-2 text-center">
                    <span className="font-bold text-sm"
                      style={{ color: `rgba(${intensity > 0.5 ? "0,255,200" : "180,180,200"},${0.5 + intensity * 0.5})` }}>
                      {stat.decimals > 0 ? ourVal.toFixed(stat.decimals) : ourVal}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-center text-muted-foreground">
                    {stat.decimals > 0 ? oppVal.toFixed(stat.decimals) : oppVal}
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

function PlayerMatchMatrix({ data, statIdx }: { data: TeamData; statIdx: number }) {
  const stat = STATS[statIdx];
  // Sort matches oldest→newest (match columns)
  const matches = [...data.matches].sort((a, b) => a.date - b.date);
  const n = matches.length;

  // Sort players by total for this stat (desc)
  const players = [...data.players]
    .map(p => {
      const total = p.matchStats.reduce((s, ms) => s + getPlayerVal(ms, stat.key), 0);
      return { ...p, statTotal: total };
    })
    .filter(p => p.appearances > 0)
    .sort((a, b) => b.statTotal - a.statTotal);

  // Max value for color scale
  const allVals = players.flatMap(p => p.matchStats.map(ms => getPlayerVal(ms, stat.key)));
  const maxVal = Math.max(...allVals, 1);

  return (
    <div className="border border-border/50 overflow-hidden">
      <div className="overflow-x-auto" style={{ maxHeight: "70vh" }}>
        <table className="text-[10px] font-mono border-collapse">
          <thead className="sticky top-0 z-10 bg-card">
            <tr className="border-b border-border/50">
              <th className="sticky left-0 z-20 bg-card px-3 py-2 text-left text-[9px] text-muted-foreground uppercase tracking-wider whitespace-nowrap min-w-[130px] border-r border-border/30">
                Player
              </th>
              <th className="px-2 py-2 text-center text-[9px] text-muted-foreground uppercase tracking-wider whitespace-nowrap border-r border-border/20">
                Apps
              </th>
              {matches.map((m, i) => (
                <th key={m.eventId} className="px-1.5 py-1 text-center whitespace-nowrap border-r border-border/10 min-w-[36px]">
                  <div className="text-[8px] text-muted-foreground/70">{format(new Date(m.date * 1000), "MMM d")}</div>
                  <div className={`text-[8px] font-bold ${resultColor(m.isHome, m.homeScore, m.awayScore).split(" ")[0]}`}>
                    {m.isHome ? m.homeScore : m.awayScore}-{m.isHome ? m.awayScore : m.homeScore}
                  </div>
                </th>
              ))}
              <th className="px-2 py-2 text-center text-[9px] text-primary uppercase tracking-wider whitespace-nowrap sticky right-0 bg-card border-l border-border/30">
                TOT
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/10">
            {players.map((p, pi) => (
              <motion.tr key={p.playerId}
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: pi * 0.02 }}
                className="hover:bg-white/[0.02]">
                <td className="sticky left-0 bg-background px-3 py-1.5 border-r border-border/30">
                  <div className="text-foreground/90 font-medium truncate max-w-[120px]">{p.name}</div>
                  <div className="text-[8px] text-muted-foreground">{p.position}</div>
                </td>
                <td className="px-2 py-1.5 text-center text-muted-foreground border-r border-border/20">{p.appearances}</td>
                {Array.from({ length: n }, (_, i) => {
                  const ms = p.matchStats[n - 1 - i]; // matches sorted newest first in matchStats
                  const val = getPlayerVal(ms, stat.key);
                  const bool = stat.key === "yellowCard" || stat.key === "redCard";
                  const intensity = maxVal > 0 ? val / maxVal : 0;
                  return (
                    <td key={i} className="px-1.5 py-1.5 text-center border-r border-border/10">
                      {ms === null ? (
                        <span className="text-muted-foreground/30">·</span>
                      ) : val === 0 ? (
                        <span className="text-muted-foreground/40">0</span>
                      ) : (
                        <span className="font-bold"
                          style={{ color: bool
                            ? (stat.key === "yellowCard" ? "#fbbf24" : "#ef4444")
                            : `rgba(0,${Math.round(180 + intensity * 75)},${Math.round(150 + intensity * 50)},${0.7 + intensity * 0.3})` }}>
                          {bool ? (val ? "●" : "") : fmtVal(val, stat.decimals)}
                        </span>
                      )}
                    </td>
                  );
                })}
                <td className="px-2 py-1.5 text-center font-bold text-primary sticky right-0 bg-background border-l border-border/30">
                  {stat.decimals > 0 ? p.statTotal.toFixed(stat.decimals) : p.statTotal}
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
  const avg = (key: TeamStatKey) => {
    const total = data.matches.reduce((s, m) => s + getTeamVal(m.teamStats, key), 0);
    return (total / n).toFixed(1);
  };
  const cards = [
    { label: "Goals/G",   val: avg("goals") },
    { label: "Shots/G",   val: avg("shots") },
    { label: "On Tgt/G",  val: avg("shotsOnTarget") },
    { label: "Passes/G",  val: avg("passes") },
    { label: "Tackles/G", val: avg("tackles") },
    { label: "Yellow/G",  val: avg("yellowCards") },
    { label: "Fouls/G",   val: avg("fouls") },
    { label: "Int/G",     val: avg("interceptions") },
  ];
  return (
    <div className="grid grid-cols-4 sm:grid-cols-8 gap-1.5">
      {cards.map(c => (
        <div key={c.label} className="border border-border/40 bg-card/30 p-2 flex flex-col items-center gap-0.5">
          <div className="text-base font-mono font-bold text-foreground">{c.val}</div>
          <div className="text-[8px] font-mono text-muted-foreground uppercase tracking-wide text-center">{c.label}</div>
        </div>
      ))}
    </div>
  );
}

// ─── Team Panel ───────────────────────────────────────────────────────────────

type ViewMode = "team" | "players";

function TeamPanel({ data, color }: { data: TeamData; color: string | null }) {
  const [statIdx, setStatIdx] = useState(0);
  const [viewMode, setViewMode] = useState<ViewMode>("team");

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
            className={`px-4 py-1.5 text-[10px] font-mono uppercase tracking-widest transition-all ${
              viewMode === m ? "bg-primary/10 text-primary border-r border-primary/30" : "text-muted-foreground hover:text-foreground border-r border-border/30 last:border-r-0"
            }`}>
            {m === "team" ? "Team Stats" : "Player Stats"}
          </button>
        ))}
      </div>

      {/* Stat tab bar */}
      <StatTabBar selected={statIdx} onSelect={setStatIdx} />

      {/* Stat label */}
      <div className="flex items-center gap-2">
        <span className="text-xs font-mono text-primary uppercase tracking-widest">{STATS[statIdx].label}</span>
        <span className="text-[9px] font-mono text-muted-foreground">— {viewMode === "team" ? "per match" : "per player per match"}</span>
      </div>

      {/* Content */}
      <AnimatePresence mode="wait">
        <motion.div key={`${viewMode}-${statIdx}`}
          initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}>
          {viewMode === "team" ? (
            <TeamMatchTable data={data} statIdx={statIdx} color={color} />
          ) : (
            <PlayerMatchMatrix data={data} statIdx={statIdx} />
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

  const hAvg = (key: TeamStatKey) =>
    home.matches.reduce((s, m) => s + getTeamVal(m.teamStats, key), 0) / hN;
  const aAvg = (key: TeamStatKey) =>
    away.matches.reduce((s, m) => s + getTeamVal(m.teamStats, key), 0) / aN;

  const compareStats: { label: string; key: TeamStatKey; dec: number }[] = [
    { label: "Goals",           key: "goals",           dec: 1 },
    { label: "Shots",           key: "shots",           dec: 1 },
    { label: "Shots on Target", key: "shotsOnTarget",   dec: 1 },
    { label: "xG",              key: "xG",              dec: 2 },
    { label: "xA",              key: "xA",              dec: 2 },
    { label: "Passes",          key: "passes",          dec: 0 },
    { label: "Acc. Passes",     key: "accuratePasses",  dec: 0 },
    { label: "Crosses",         key: "crosses",         dec: 1 },
    { label: "Big Chances",     key: "bigChancesCreated", dec: 1 },
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
                <div className="h-1.5 flex rounded-none overflow-hidden bg-muted/20">
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
