import React, { useState, useEffect, useCallback } from "react";
import { useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import {
  Activity, Database, ChevronLeft, ChevronRight,
  Trash2, RefreshCw, X,
  BarChart2, Shield,
} from "lucide-react";

function apiUrl(path: string) {
  return `/api${path}`;
}

// ── Types ────────────────────────────────────────────────────────────────────

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
  homeStats: unknown;
  awayStats: unknown;
  homePlayerStats: unknown;
  awayPlayerStats: unknown;
  odds: Record<string, unknown>;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

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


// ── Match detail modal ───────────────────────────────────────────────────────

// ── Types for match detail data ───────────────────────────────────────────────

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

interface OddsEntry {
  bookmaker: string;
  odds: Record<string, number>;
}

// ── Helper: result badge ──────────────────────────────────────────────────────

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

// ── Stat history panel for one team ──────────────────────────────────────────

function StatPanel({
  teamName, teamStats, selectedStat,
}: {
  teamName: string;
  teamStats: SHTeamStats | null;
  selectedStat: string;
}) {
  if (!teamStats) {
    return (
      <div className="flex flex-col items-center justify-center h-32 text-muted-foreground/40 text-xs font-mono">
        No stats data
      </div>
    );
  }

  const hist = teamStats.statHistory.find(s => s.label === selectedStat);
  if (!hist) {
    return (
      <div className="flex flex-col items-center justify-center h-32 text-muted-foreground/40 text-xs font-mono">
        No data for {selectedStat}
      </div>
    );
  }

  const avg = hist.matches.length
    ? (hist.matches.reduce((s, m) => s + m.myValue, 0) / hist.matches.length)
    : 0;
  const oppAvg = hist.matches.length
    ? (hist.matches.reduce((s, m) => s + m.opponentValue, 0) / hist.matches.length)
    : 0;

  return (
    <div>
      {/* Team header + averages */}
      <div className="text-[10px] font-mono font-bold text-primary tracking-widest uppercase mb-2 truncate">
        {teamName}
      </div>
      <div className="flex gap-4 mb-3">
        <div className="border border-border/40 bg-card/30 px-3 py-1.5 text-center flex-1">
          <div className="text-lg font-bold text-primary tabular-nums">{avg.toFixed(1)}</div>
          <div className="text-[9px] text-muted-foreground uppercase tracking-widest">Avg {selectedStat}</div>
        </div>
        <div className="border border-border/40 bg-card/30 px-3 py-1.5 text-center flex-1">
          <div className="text-lg font-bold text-muted-foreground tabular-nums">{oppAvg.toFixed(1)}</div>
          <div className="text-[9px] text-muted-foreground uppercase tracking-widest">Opp Avg</div>
        </div>
        <div className="border border-border/40 bg-card/30 px-3 py-1.5 text-center flex-1">
          <div className="text-lg font-bold text-foreground tabular-nums">{hist.matches.length}</div>
          <div className="text-[9px] text-muted-foreground uppercase tracking-widest">Matches</div>
        </div>
      </div>

      {/* Match history table */}
      <div className="overflow-y-auto max-h-56 border border-border/30">
        <table className="w-full text-[10px] font-mono">
          <thead className="sticky top-0 bg-card/80">
            <tr className="border-b border-border/30">
              <th className="text-left px-2 py-1 text-muted-foreground/50 font-normal">Date</th>
              <th className="text-left px-2 py-1 text-muted-foreground/50 font-normal">Opponent</th>
              <th className="text-center px-2 py-1 text-muted-foreground/50 font-normal">Sc</th>
              <th className="text-center px-2 py-1 text-muted-foreground/50 font-normal">R</th>
              <th className="text-center px-2 py-1 text-primary/60 font-normal">Val</th>
            </tr>
          </thead>
          <tbody>
            {hist.matches.map((m, i) => {
              const isHome = m.homeTeam !== teamName ? false : true;
              const opponent = isHome ? m.awayTeam : m.homeTeam;
              const score = `${m.homeScore}-${m.awayScore}`;
              return (
                <tr key={i} className="border-b border-border/15 hover:bg-white/[0.02]">
                  <td className="px-2 py-1 text-muted-foreground/50">{m.date}</td>
                  <td className="px-2 py-1 text-foreground/70 truncate max-w-[100px]">{opponent}</td>
                  <td className="px-2 py-1 text-center text-muted-foreground/60">{score}</td>
                  <td className="px-2 py-1 text-center"><ResultBadge r={m.result} /></td>
                  <td className="px-2 py-1 text-center text-primary font-bold">{m.myValue % 1 === 0 ? m.myValue : m.myValue.toFixed(2)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Player stats panel ────────────────────────────────────────────────────────

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

function PlayerPanel({ teamName, playerStats }: { teamName: string; playerStats: PlayerGame[] | null }) {
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
      <div className="text-[10px] font-mono font-bold text-primary tracking-widest uppercase mb-2 truncate">{teamName}</div>

      {/* Game picker */}
      <div className="flex items-center gap-1 mb-3 overflow-x-auto">
        {playerStats.map((g, i) => {
          const gd = new Date(g.date * 1000);
          return (
            <button
              key={g.eventId}
              onClick={() => setGameIdx(i)}
              className={`flex-shrink-0 px-2 py-1 text-[9px] font-mono border transition-all ${
                i === gameIdx ? "border-primary bg-primary/10 text-primary" : "border-border/40 text-muted-foreground hover:text-foreground"
              }`}
            >
              {String(gd.getDate()).padStart(2,"0")}/{String(gd.getMonth()+1).padStart(2,"0")}
            </button>
          );
        })}
      </div>

      {/* Game header */}
      <div className="text-[9px] font-mono text-muted-foreground/50 mb-2">
        vs {opp} · {dateStr} · {game.homeScore}–{game.awayScore}
      </div>

      {/* Player table */}
      <div className="overflow-y-auto max-h-52 border border-border/30">
        <table className="w-full text-[10px] font-mono">
          <thead className="sticky top-0 bg-card/80">
            <tr className="border-b border-border/30">
              <th className="text-left px-2 py-1 text-muted-foreground/50 font-normal">#</th>
              <th className="text-left px-2 py-1 text-muted-foreground/50 font-normal">Name</th>
              <th className="text-center px-1 py-1 text-muted-foreground/50 font-normal">Pos</th>
              <th className="text-center px-1 py-1 text-muted-foreground/50 font-normal">Min</th>
              <th className="text-center px-1 py-1 text-primary/50 font-normal">Rtg</th>
              <th className="text-center px-1 py-1 text-muted-foreground/50 font-normal">G</th>
              <th className="text-center px-1 py-1 text-muted-foreground/50 font-normal">A</th>
              <th className="text-center px-1 py-1 text-muted-foreground/50 font-normal">Sh</th>
              <th className="text-center px-1 py-1 text-muted-foreground/50 font-normal">xG</th>
              <th className="text-center px-1 py-1 text-muted-foreground/50 font-normal">Tkl</th>
              <th className="text-center px-1 py-1 text-muted-foreground/50 font-normal">Cd</th>
            </tr>
          </thead>
          <tbody>
            {[...starters, ...subs].map((p, i) => (
              <tr key={p.playerId} className={`border-b border-border/15 hover:bg-white/[0.02] ${p.isSubstitute ? "opacity-50" : ""}`}>
                <td className="px-2 py-1 text-muted-foreground/40">{p.jerseyNo || i+1}</td>
                <td className="px-2 py-1 text-foreground/80 max-w-[90px] truncate">{p.name}</td>
                <td className="px-1 py-1 text-center text-muted-foreground/50">{p.position?.slice(0,2) ?? "—"}</td>
                <td className="px-1 py-1 text-center text-muted-foreground/60">{p.minutesPlayed || "—"}</td>
                <td className="px-1 py-1 text-center text-primary font-bold">
                  {p.rating > 0 ? p.rating.toFixed(1) : "—"}
                </td>
                <td className="px-1 py-1 text-center text-green-400/80">{p.goals || "—"}</td>
                <td className="px-1 py-1 text-center text-blue-400/80">{p.assists || "—"}</td>
                <td className="px-1 py-1 text-center text-muted-foreground/60">{p.shots || "—"}</td>
                <td className="px-1 py-1 text-center text-muted-foreground/60">{p.xG > 0 ? p.xG.toFixed(2) : "—"}</td>
                <td className="px-1 py-1 text-center text-muted-foreground/60">{p.tackles || "—"}</td>
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

// ── Match detail modal ────────────────────────────────────────────────────────

const MARKETS: Array<[string, string]> = [
  ["1x2","1X2"], ["ou","O/U"], ["ah","AH"], ["btts","BTTS"],
  ["dc","DC"], ["eh","EH"], ["dnb","DNB"], ["cs","CS"],
  ["htft","HT/FT"], ["oe","O/E"],
];

function MatchDetailModal({ matchId, onClose }: { matchId: string; onClose: () => void }) {
  const [match, setMatch] = useState<MatchDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"odds" | "stats" | "players">("odds");
  const [selectedMarket, setSelectedMarket] = useState("1x2");
  const [selectedStat, setSelectedStat] = useState("");

  useEffect(() => {
    apiFetch<MatchDetail>(`/db/match/${matchId}`)
      .then(d => {
        setMatch(d);
        // Auto-select first available market
        for (const [key] of MARKETS) {
          const data = (d.odds as Record<string, unknown>)[key];
          if (Array.isArray(data) && data.length > 0) { setSelectedMarket(key); break; }
        }
        // Auto-select first available stat
        const hs = d.homeStats as SHTeamStats | null;
        if (hs?.statHistory?.[0]) setSelectedStat(hs.statHistory[0].label);
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

  // Build union of all stat labels from both teams
  const allStatLabels = Array.from(new Set([
    ...(homeStats?.statHistory.map(s => s.label) ?? []),
    ...(awayStats?.statHistory.map(s => s.label) ?? []),
  ]));

  const activeMarketData = match
    ? ((match.odds as Record<string, unknown>)[selectedMarket] as OddsEntry[] | null)
    : null;
  const oddsColKeys = activeMarketData
    ? [...new Set(activeMarketData.flatMap(e => Object.keys(e.odds)))]
    : [];

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
                ["stats",   "Team Stats"],
                ...(match.homePlayerStats || match.awayPlayerStats ? [["players", "Players"]] : []),
              ] as [string, string][]).map(([t, label]) => (
                <button
                  key={t}
                  onClick={() => setTab(t as "odds" | "stats" | "players")}
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
                  {/* Market pills */}
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

                  {/* Bookmaker table */}
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
                              {oddsColKeys.map(k => (
                                <th key={k} className="text-center px-3 py-2 text-muted-foreground/60 font-normal uppercase min-w-[64px]">
                                  {k}
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
                                {oddsColKeys.map(k => (
                                  <td key={k} className="text-center px-3 py-2 text-primary/90 font-bold tabular-nums">
                                    {e.odds[k] != null ? e.odds[k].toFixed(2) : <span className="text-muted-foreground/30">—</span>}
                                  </td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* ── STATS TAB ── */}
              {tab === "stats" && (
                <div className="flex flex-col flex-1 overflow-hidden">
                  {/* Stat category pills */}
                  {allStatLabels.length > 0 && (
                    <div className="px-4 py-3 flex flex-wrap gap-1.5 border-b border-border/30 flex-shrink-0 overflow-y-auto max-h-24">
                      {allStatLabels.map(label => (
                        <button
                          key={label}
                          onClick={() => setSelectedStat(label)}
                          className={`px-2.5 py-1 text-[10px] font-mono uppercase tracking-widest border transition-all ${
                            selectedStat === label
                              ? "border-primary bg-primary/10 text-primary"
                              : "border-border/50 text-muted-foreground hover:border-primary/40 hover:text-foreground"
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Side-by-side team panels */}
                  <div className="flex-1 overflow-y-auto">
                    {allStatLabels.length === 0 ? (
                      <div className="flex items-center justify-center h-full text-muted-foreground/40 text-xs font-mono">
                        No team stats stored for this match
                      </div>
                    ) : (
                      <div className="grid grid-cols-2 gap-0 divide-x divide-border/30">
                        <div className="p-4">
                          <StatPanel
                            teamName={match.homeTeam}
                            teamStats={homeStats}
                            selectedStat={selectedStat}
                          />
                        </div>
                        <div className="p-4">
                          <StatPanel
                            teamName={match.awayTeam}
                            teamStats={awayStats}
                            selectedStat={selectedStat}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* ── PLAYERS TAB ── */}
              {tab === "players" && (
                <div className="flex-1 overflow-y-auto">
                  <div className="grid grid-cols-2 gap-0 divide-x divide-border/30 h-full">
                    <div className="p-4">
                      <PlayerPanel
                        teamName={match.homeTeam}
                        playerStats={match.homePlayerStats as PlayerGame[] | null}
                      />
                    </div>
                    <div className="p-4">
                      <PlayerPanel
                        teamName={match.awayTeam}
                        playerStats={match.awayPlayerStats as PlayerGame[] | null}
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </motion.div>
    </div>
  );
}

// ── Main page ────────────────────────────────────────────────────────────────

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
    if (!matchId.startsWith("match_")) return; // only stored matches are deletable
    try {
      await apiFetch(`/db/match/${matchId}`, { method: "DELETE" });
      setMatches(ms => ms.filter(m => m.id !== matchId));
      setTotal(t => t - 1);
    } catch {}
  };

  return (
    <div className="min-h-screen bg-background text-foreground font-sans dark">
      {/* Header */}
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
          <button
            onClick={load}
            disabled={refreshing}
            className="w-8 h-8 flex items-center justify-center text-muted-foreground hover:text-primary transition-colors"
            title="Refresh"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} />
          </button>
        </div>
      </header>

      <main className="container mx-auto px-4 py-6 space-y-6">
        {/* Stats strip */}
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

        {/* Match table */}
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
                            m.source === "processing"
                              ? "border-primary/30 text-primary/50"
                              : "border-border/40 text-muted-foreground/40"
                          }`}>
                            {m.source === "processing" ? "live" : "bulk"}
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

              {/* Pagination */}
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

      {/* Match detail modal */}
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
