import React, { useState } from "react";
import { useParams, useLocation } from "wouter";
import { format } from "date-fns";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowLeft,
  Activity,
  Target,
  Crosshair,
  Shield,
  Zap,
  TrendingUp,
  Users,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { useGetFixtureDetail } from "@workspace/api-client-react";

type TeamData = {
  matches: Array<{
    eventId: number;
    date: number;
    homeTeamName: string;
    awayTeamName: string;
    homeScore: number;
    awayScore: number;
    tournamentName: string;
    isHome: boolean;
    stats: Record<string, number>;
    oppStats: Record<string, number>;
  }>;
  players: Array<{
    playerId: number;
    name: string;
    position: string;
    stats: Array<{
      minutesPlayed: number;
      goals: number;
      assists: number;
      shots: number;
      shotsOnTarget: number;
      passes: number;
      accuratePasses: number;
      tackles: number;
      interceptions: number;
      xG: number;
      xA: number;
    } | null>;
  }>;
};

function StatBar({
  label,
  home,
  away,
  icon: Icon,
}: {
  label: string;
  home: number;
  away: number;
  icon?: React.ComponentType<{ className?: string }>;
}) {
  const total = home + away;
  const homePct = total === 0 ? 50 : Math.round((home / total) * 100);
  const awayPct = 100 - homePct;

  return (
    <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 py-1.5">
      <div className="text-right font-mono text-sm font-bold text-foreground">
        {Number.isInteger(home) ? home : home.toFixed(2)}
      </div>
      <div className="flex flex-col items-center w-40 sm:w-56 gap-1">
        <div className="flex items-center gap-1 text-[10px] text-muted-foreground uppercase tracking-widest">
          {Icon && <Icon className="w-3 h-3" />}
          {label}
        </div>
        <div className="w-full h-1.5 flex rounded-sm overflow-hidden bg-muted/30">
          <div
            className="h-full bg-primary/70 transition-all duration-700"
            style={{ width: `${homePct}%` }}
          />
          <div
            className="h-full bg-cyan-400/40 transition-all duration-700"
            style={{ width: `${awayPct}%` }}
          />
        </div>
        <div className="flex justify-between w-full text-[9px] font-mono text-muted-foreground">
          <span>{homePct}%</span>
          <span>{awayPct}%</span>
        </div>
      </div>
      <div className="text-left font-mono text-sm font-bold text-foreground">
        {Number.isInteger(away) ? away : away.toFixed(2)}
      </div>
    </div>
  );
}

function ResultBadge({
  isHome,
  homeScore,
  awayScore,
}: {
  isHome: boolean;
  homeScore: number;
  awayScore: number;
}) {
  const ourScore = isHome ? homeScore : awayScore;
  const oppScore = isHome ? awayScore : homeScore;
  if (ourScore > oppScore)
    return (
      <span className="text-[9px] font-mono font-bold px-1.5 py-0.5 bg-green-500/20 text-green-400 border border-green-500/40">
        W
      </span>
    );
  if (ourScore < oppScore)
    return (
      <span className="text-[9px] font-mono font-bold px-1.5 py-0.5 bg-destructive/20 text-destructive border border-destructive/40">
        L
      </span>
    );
  return (
    <span className="text-[9px] font-mono font-bold px-1.5 py-0.5 bg-yellow-500/20 text-yellow-400 border border-yellow-500/40">
      D
    </span>
  );
}

function FormBar({ matches }: { matches: TeamData["matches"] }) {
  const last5 = [...matches]
    .sort((a, b) => b.date - a.date)
    .slice(0, 5)
    .reverse();
  return (
    <div className="flex items-center gap-1">
      {last5.map((m) => {
        const our = m.isHome ? m.homeScore : m.awayScore;
        const opp = m.isHome ? m.awayScore : m.homeScore;
        const result = our > opp ? "W" : our < opp ? "L" : "D";
        return (
          <div
            key={m.eventId}
            title={`${m.homeTeamName} ${m.homeScore}-${m.awayScore} ${m.awayTeamName}`}
            className={`w-5 h-5 flex items-center justify-center text-[8px] font-mono font-bold border ${
              result === "W"
                ? "bg-green-500/20 text-green-400 border-green-500/40"
                : result === "L"
                  ? "bg-destructive/20 text-destructive border-destructive/40"
                  : "bg-yellow-500/20 text-yellow-400 border-yellow-500/40"
            }`}
          >
            {result}
          </div>
        );
      })}
    </div>
  );
}

function TeamPanel({
  teamName,
  color,
  data,
}: {
  teamName: string;
  color: string | null;
  data: TeamData;
}) {
  const [showAllMatches, setShowAllMatches] = useState(false);
  const [showAllPlayers, setShowAllPlayers] = useState(false);

  const sorted = [...data.matches].sort((a, b) => b.date - a.date);
  const visibleMatches = showAllMatches ? sorted : sorted.slice(0, 10);

  const avgStats = data.matches.reduce(
    (acc, m) => {
      Object.entries(m.stats).forEach(([k, v]) => {
        acc[k] = (acc[k] ?? 0) + (v as number);
      });
      return acc;
    },
    {} as Record<string, number>
  );
  const n = data.matches.length || 1;
  Object.keys(avgStats).forEach((k) => {
    avgStats[k] = Math.round((avgStats[k] / n) * 10) / 10;
  });

  const topPlayers = data.players
    .map((p) => {
      const played = p.stats.filter(Boolean).length;
      const totals = p.stats.reduce(
        (acc, s) => {
          if (!s) return acc;
          return {
            goals: acc.goals + (s.goals ?? 0),
            assists: acc.assists + (s.assists ?? 0),
            shots: acc.shots + (s.shots ?? 0),
            shotsOnTarget: acc.shotsOnTarget + (s.shotsOnTarget ?? 0),
            xG: acc.xG + (s.xG ?? 0),
            xA: acc.xA + (s.xA ?? 0),
            tackles: acc.tackles + (s.tackles ?? 0),
            interceptions: acc.interceptions + (s.interceptions ?? 0),
          };
        },
        { goals: 0, assists: 0, shots: 0, shotsOnTarget: 0, xG: 0, xA: 0, tackles: 0, interceptions: 0 }
      );
      return { ...p, played, totals };
    })
    .filter((p) => p.played > 0)
    .sort(
      (a, b) =>
        b.totals.goals * 10 +
        b.totals.assists * 5 +
        b.totals.shots -
        (a.totals.goals * 10 + a.totals.assists * 5 + a.totals.shots)
    );

  const visiblePlayers = showAllPlayers ? topPlayers : topPlayers.slice(0, 10);

  return (
    <div className="space-y-6">
      {/* Form strip */}
      <div className="flex items-center gap-3">
        <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest">
          Form
        </span>
        <FormBar matches={data.matches} />
      </div>

      {/* Avg stats grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {[
          { key: "goals", label: "Goals/G", icon: Target },
          { key: "shots", label: "Shots/G", icon: Crosshair },
          { key: "shotsOnTarget", label: "On Tgt/G", icon: Zap },
          { key: "passes", label: "Passes/G", icon: Activity },
          { key: "tackles", label: "Tackles/G", icon: Shield },
          { key: "yellowCards", label: "Yellow/G", icon: Activity },
          { key: "fouls", label: "Fouls/G", icon: Activity },
          { key: "interceptions", label: "Int/G", icon: Shield },
        ].map(({ key, label, icon: Icon }) => (
          <div
            key={key}
            className="border border-border/50 bg-card/30 p-3 flex flex-col items-center gap-1"
          >
            <Icon className="w-4 h-4 text-primary/60" />
            <div className="text-lg font-mono font-bold text-foreground">
              {avgStats[key] ?? 0}
            </div>
            <div className="text-[9px] font-mono text-muted-foreground uppercase tracking-wider">
              {label}
            </div>
          </div>
        ))}
      </div>

      {/* Last N matches */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <TrendingUp className="w-4 h-4 text-primary" />
          <h3 className="text-xs font-mono uppercase tracking-widest text-muted-foreground">
            Last {data.matches.length} Matches
          </h3>
        </div>
        <div className="border border-border/50 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs font-mono">
              <thead>
                <tr className="bg-card border-b border-border/50">
                  <th className="text-left px-3 py-2 text-muted-foreground uppercase tracking-widest text-[9px]">
                    Date
                  </th>
                  <th className="text-left px-3 py-2 text-muted-foreground uppercase tracking-widest text-[9px]">
                    Match
                  </th>
                  <th className="text-center px-2 py-2 text-muted-foreground uppercase tracking-widest text-[9px]">
                    Res
                  </th>
                  <th className="text-center px-2 py-2 text-muted-foreground uppercase tracking-widest text-[9px]">
                    Sh
                  </th>
                  <th className="text-center px-2 py-2 text-muted-foreground uppercase tracking-widest text-[9px]">
                    SoT
                  </th>
                  <th className="text-center px-2 py-2 text-muted-foreground uppercase tracking-widest text-[9px]">
                    Pass
                  </th>
                  <th className="text-center px-2 py-2 text-muted-foreground uppercase tracking-widest text-[9px]">
                    Tck
                  </th>
                  <th className="text-center px-2 py-2 text-muted-foreground uppercase tracking-widest text-[9px]">
                    Int
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/30">
                {visibleMatches.map((m, i) => (
                  <motion.tr
                    key={m.eventId}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: i * 0.03 }}
                    className="hover:bg-white/[0.02]"
                  >
                    <td className="px-3 py-2 text-muted-foreground">
                      {format(new Date(m.date * 1000), "dd MMM")}
                    </td>
                    <td className="px-3 py-2 max-w-[140px] truncate">
                      <span
                        className={m.isHome ? "text-primary/90" : "text-foreground/70"}
                      >
                        {m.homeTeamName}
                      </span>
                      <span className="text-muted-foreground mx-1">
                        {m.homeScore}-{m.awayScore}
                      </span>
                      <span
                        className={!m.isHome ? "text-primary/90" : "text-foreground/70"}
                      >
                        {m.awayTeamName}
                      </span>
                    </td>
                    <td className="px-2 py-2 text-center">
                      <ResultBadge
                        isHome={m.isHome}
                        homeScore={m.homeScore}
                        awayScore={m.awayScore}
                      />
                    </td>
                    <td className="px-2 py-2 text-center text-foreground/80">
                      {m.stats.shots ?? 0}
                    </td>
                    <td className="px-2 py-2 text-center text-foreground/80">
                      {m.stats.shotsOnTarget ?? 0}
                    </td>
                    <td className="px-2 py-2 text-center text-foreground/80">
                      {m.stats.passes ?? 0}
                    </td>
                    <td className="px-2 py-2 text-center text-foreground/80">
                      {m.stats.tackles ?? 0}
                    </td>
                    <td className="px-2 py-2 text-center text-foreground/80">
                      {m.stats.interceptions ?? 0}
                    </td>
                  </motion.tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        {sorted.length > 10 && (
          <button
            onClick={() => setShowAllMatches((v) => !v)}
            className="mt-2 w-full flex items-center justify-center gap-2 text-[10px] font-mono uppercase tracking-widest text-primary/60 hover:text-primary border border-primary/20 hover:border-primary/50 py-1.5 transition-all"
          >
            {showAllMatches ? (
              <>
                <ChevronUp className="w-3 h-3" /> Show less
              </>
            ) : (
              <>
                <ChevronDown className="w-3 h-3" /> Show all {sorted.length}
              </>
            )}
          </button>
        )}
      </div>

      {/* Top players */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Users className="w-4 h-4 text-primary" />
          <h3 className="text-xs font-mono uppercase tracking-widest text-muted-foreground">
            Player Stats (Last {data.matches.length} Games)
          </h3>
        </div>
        <div className="border border-border/50 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs font-mono">
              <thead>
                <tr className="bg-card border-b border-border/50">
                  <th className="text-left px-3 py-2 text-muted-foreground uppercase tracking-widest text-[9px]">
                    Player
                  </th>
                  <th className="text-center px-2 py-2 text-muted-foreground uppercase tracking-widest text-[9px]">
                    Apps
                  </th>
                  <th className="text-center px-2 py-2 text-muted-foreground uppercase tracking-widest text-[9px]">
                    G
                  </th>
                  <th className="text-center px-2 py-2 text-muted-foreground uppercase tracking-widest text-[9px]">
                    A
                  </th>
                  <th className="text-center px-2 py-2 text-muted-foreground uppercase tracking-widest text-[9px]">
                    Sh
                  </th>
                  <th className="text-center px-2 py-2 text-muted-foreground uppercase tracking-widest text-[9px]">
                    SoT
                  </th>
                  <th className="text-center px-2 py-2 text-muted-foreground uppercase tracking-widest text-[9px]">
                    xG
                  </th>
                  <th className="text-center px-2 py-2 text-muted-foreground uppercase tracking-widest text-[9px]">
                    xA
                  </th>
                  <th className="text-center px-2 py-2 text-muted-foreground uppercase tracking-widest text-[9px]">
                    Tck
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/30">
                {visiblePlayers.map((p, i) => (
                  <motion.tr
                    key={p.playerId}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: i * 0.03 }}
                    className="hover:bg-white/[0.02]"
                  >
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <div
                          className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                          style={{ backgroundColor: color || "#00ffff" }}
                        />
                        <span className="text-foreground/90 truncate max-w-[120px]">
                          {p.name}
                        </span>
                      </div>
                      {p.position && (
                        <div className="text-[9px] text-muted-foreground ml-3.5">
                          {p.position}
                        </div>
                      )}
                    </td>
                    <td className="px-2 py-2 text-center text-muted-foreground">
                      {p.played}
                    </td>
                    <td className="px-2 py-2 text-center font-bold text-foreground">
                      {p.totals.goals}
                    </td>
                    <td className="px-2 py-2 text-center text-foreground/80">
                      {p.totals.assists}
                    </td>
                    <td className="px-2 py-2 text-center text-foreground/80">
                      {p.totals.shots}
                    </td>
                    <td className="px-2 py-2 text-center text-foreground/80">
                      {p.totals.shotsOnTarget}
                    </td>
                    <td className="px-2 py-2 text-center text-primary/80">
                      {p.totals.xG.toFixed(1)}
                    </td>
                    <td className="px-2 py-2 text-center text-primary/60">
                      {p.totals.xA.toFixed(1)}
                    </td>
                    <td className="px-2 py-2 text-center text-foreground/80">
                      {p.totals.tackles}
                    </td>
                  </motion.tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        {topPlayers.length > 10 && (
          <button
            onClick={() => setShowAllPlayers((v) => !v)}
            className="mt-2 w-full flex items-center justify-center gap-2 text-[10px] font-mono uppercase tracking-widest text-primary/60 hover:text-primary border border-primary/20 hover:border-primary/50 py-1.5 transition-all"
          >
            {showAllPlayers ? (
              <>
                <ChevronUp className="w-3 h-3" /> Show less
              </>
            ) : (
              <>
                <ChevronDown className="w-3 h-3" /> Show all {topPlayers.length}{" "}
                players
              </>
            )}
          </button>
        )}
      </div>
    </div>
  );
}

export default function FixtureDetail() {
  const { id } = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const [activeTab, setActiveTab] = useState<"home" | "away" | "compare">(
    "home"
  );

  const fixtureId = Number(id);
  const { data, isLoading, isError } = useGetFixtureDetail(fixtureId);

  const fixture = data?.fixture as {
    id: number;
    status: string;
    homeTeam: { id: number; name: string; colorPrimary: string | null };
    awayTeam: { id: number; name: string; colorPrimary: string | null };
    homeScore: number | null;
    awayScore: number | null;
    kickoffTimestamp: number;
    leagueName: string;
  } | undefined;

  const home = data?.home as TeamData | undefined;
  const away = data?.away as TeamData | undefined;

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col dark">
      {/* Header */}
      <header className="border-b border-border/50 bg-card/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="container mx-auto px-4 h-14 flex items-center gap-4">
          <button
            onClick={() => navigate("/")}
            className="flex items-center gap-2 text-muted-foreground hover:text-primary transition-colors font-mono text-xs uppercase tracking-widest"
          >
            <ArrowLeft className="w-4 h-4" />
            Back
          </button>
          <div className="w-px h-4 bg-border" />
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-primary" />
            <span className="text-sm font-mono tracking-widest text-primary/80 uppercase">
              Fixture Intel
            </span>
          </div>
        </div>
      </header>

      {isLoading ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center space-y-4">
            <div className="w-12 h-12 border-2 border-primary/30 border-t-primary animate-spin rounded-full mx-auto" />
            <p className="text-xs font-mono uppercase tracking-widest text-muted-foreground">
              Acquiring targets...
            </p>
          </div>
        </div>
      ) : isError || !fixture ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center border border-destructive/50 bg-destructive/5 p-8">
            <p className="text-destructive font-mono uppercase">
              Signal lost — fixture not found
            </p>
          </div>
        </div>
      ) : (
        <main className="container mx-auto px-4 pb-20 flex-1 space-y-6 pt-6">
          {/* Fixture header card */}
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="border border-border/50 bg-card/40 overflow-hidden"
          >
            <div className="text-center py-1.5 bg-card/60 border-b border-border/40">
              <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                {fixture.leagueName}
              </span>
            </div>
            <div className="py-6 px-4 flex items-center justify-between gap-4">
              {/* Home */}
              <div className="flex-1 text-right">
                <div
                  className="text-xl sm:text-2xl font-bold uppercase tracking-wide"
                  style={{ color: fixture.homeTeam.colorPrimary || undefined }}
                >
                  {fixture.homeTeam.name}
                </div>
                {home && (
                  <div className="mt-1 flex justify-end">
                    <FormBar matches={home.matches} />
                  </div>
                )}
              </div>

              {/* Score / KO */}
              <div className="flex flex-col items-center gap-1 min-w-[80px]">
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
                    <div className="text-3xl font-bold font-mono text-foreground">
                      {fixture.homeScore ?? 0} - {fixture.awayScore ?? 0}
                    </div>
                    <div
                      className={`text-[10px] font-mono uppercase tracking-widest ${
                        fixture.status === "inprogress"
                          ? "text-green-400"
                          : "text-muted-foreground"
                      }`}
                    >
                      {fixture.status === "inprogress" ? "● LIVE" : "FT"}
                    </div>
                  </>
                )}
              </div>

              {/* Away */}
              <div className="flex-1 text-left">
                <div
                  className="text-xl sm:text-2xl font-bold uppercase tracking-wide"
                  style={{ color: fixture.awayTeam.colorPrimary || undefined }}
                >
                  {fixture.awayTeam.name}
                </div>
                {away && (
                  <div className="mt-1 flex justify-start">
                    <FormBar matches={away.matches} />
                  </div>
                )}
              </div>
            </div>
          </motion.div>

          {/* Tabs */}
          <div className="flex gap-2 border-b border-border/50 pb-0">
            {(["home", "away", "compare"] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-4 py-2 text-xs font-mono uppercase tracking-widest border-b-2 transition-all -mb-px ${
                  activeTab === tab
                    ? "border-primary text-primary"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                {tab === "home"
                  ? fixture.homeTeam.name
                  : tab === "away"
                    ? fixture.awayTeam.name
                    : "Compare"}
              </button>
            ))}
          </div>

          {/* Tab content */}
          <AnimatePresence mode="wait">
            {activeTab === "home" && home ? (
              <motion.div
                key="home"
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 10 }}
              >
                <TeamPanel
                  teamName={fixture.homeTeam.name}
                  color={fixture.homeTeam.colorPrimary}
                  data={home}
                />
              </motion.div>
            ) : activeTab === "away" && away ? (
              <motion.div
                key="away"
                initial={{ opacity: 0, x: 10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -10 }}
              >
                <TeamPanel
                  teamName={fixture.awayTeam.name}
                  color={fixture.awayTeam.colorPrimary}
                  data={away}
                />
              </motion.div>
            ) : activeTab === "compare" && home && away ? (
              <motion.div
                key="compare"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="space-y-2"
              >
                <div className="flex justify-between text-xs font-mono uppercase tracking-widest mb-4">
                  <span style={{ color: fixture.homeTeam.colorPrimary || "#00ffff" }}>
                    {fixture.homeTeam.name}
                  </span>
                  <span className="text-muted-foreground">Avg Per Game</span>
                  <span style={{ color: fixture.awayTeam.colorPrimary || "#00ffff" }}>
                    {fixture.awayTeam.name}
                  </span>
                </div>
                <div className="border border-border/50 bg-card/30 p-4 space-y-1">
                  {(
                    [
                      { key: "goals", label: "Goals", icon: Target },
                      { key: "shots", label: "Shots", icon: Crosshair },
                      { key: "shotsOnTarget", label: "Shots on Target", icon: Zap },
                      { key: "passes", label: "Passes", icon: Activity },
                      { key: "accuratePasses", label: "Accurate Passes", icon: Activity },
                      { key: "tackles", label: "Tackles", icon: Shield },
                      { key: "interceptions", label: "Interceptions", icon: Shield },
                      { key: "fouls", label: "Fouls", icon: Shield },
                      { key: "yellowCards", label: "Yellow Cards", icon: Activity },
                    ] as const
                  ).map(({ key, label, icon }) => {
                    const hAvg =
                      home.matches.reduce((s, m) => s + ((m.stats[key] as number) ?? 0), 0) /
                      (home.matches.length || 1);
                    const aAvg =
                      away.matches.reduce((s, m) => s + ((m.stats[key] as number) ?? 0), 0) /
                      (away.matches.length || 1);
                    return (
                      <StatBar
                        key={key}
                        label={label}
                        home={Math.round(hAvg * 10) / 10}
                        away={Math.round(aAvg * 10) / 10}
                        icon={icon}
                      />
                    );
                  })}
                </div>
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
