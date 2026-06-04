import React, { useState, useEffect, useCallback } from "react";
import { useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import {
  Activity, Database, ChevronLeft, ChevronRight,
  Trash2, RefreshCw, X, ChevronDown, ChevronUp,
  BarChart2, Shield, Zap,
} from "lucide-react";

function apiUrl(path: string) {
  return `/api${path}`;
}

// ── Types ────────────────────────────────────────────────────────────────────

interface DbStats {
  jobs: number;
  matches: number;
  withStats: number;
  withOdds: number;
  leagues: { odds_portal_path: string; league_name: string; country_name: string }[];
}

interface JobSummary {
  id: string;
  status: string;
  leagueName: string;
  countryName: string;
  oddsPortalPath: string;
  year: number;
  totalMatches: number;
  processed: number;
  stored: number;
  skipped: number;
  currentMatch: string | null;
  errorMessage: string | null;
  lastLog: string | null;
  createdAt: number;
}

interface MatchSummary {
  id: string;
  jobId: string;
  leagueName: string;
  countryName: string;
  oddsPortalPath: string;
  year: number;
  date: string;
  homeTeam: string;
  awayTeam: string;
  homeScore: number | null;
  awayScore: number | null;
  hasHomeStats: boolean;
  hasAwayStats: boolean;
  has1x2: boolean;
  hasOU: boolean;
  hasAH: boolean;
  hasBTTS: boolean;
  hasDC: boolean;
  hasCS: boolean;
  hasHTFT: boolean;
  createdAt: number;
}

interface MatchDetail {
  id: string;
  leagueName: string;
  date: string;
  homeTeam: string;
  awayTeam: string;
  homeScore: number | null;
  awayScore: number | null;
  homeStats: unknown;
  awayStats: unknown;
  odds: Record<string, unknown>;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

async function apiFetch<T>(path: string, opts?: RequestInit): Promise<T> {
  const r = await fetch(apiUrl(path), opts);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json() as Promise<T>;
}

function statusColor(s: string) {
  if (s === "complete") return "text-green-400";
  if (s === "running")  return "text-primary animate-pulse";
  if (s === "failed")   return "text-destructive";
  return "text-muted-foreground";
}

function statusBadge(s: string) {
  const base = "text-[9px] font-mono uppercase tracking-widest px-2 py-0.5 border";
  if (s === "complete") return `${base} border-green-400/50 text-green-400 bg-green-400/5`;
  if (s === "running")  return `${base} border-primary/50 text-primary bg-primary/5`;
  if (s === "failed")   return `${base} border-destructive/50 text-destructive bg-destructive/5`;
  return `${base} border-border text-muted-foreground`;
}

function dot(has: boolean) {
  return (
    <span className={`inline-block w-2 h-2 rounded-full ${has ? "bg-green-400" : "bg-border"}`} />
  );
}

function prog(processed: number, total: number) {
  if (!total) return 0;
  return Math.round((processed / total) * 100);
}

// ── Job detail expanded view ─────────────────────────────────────────────────

function JobCard({ job, onDelete, onRefresh }: {
  job: JobSummary;
  onDelete: () => void;
  onRefresh: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [fullJob, setFullJob] = useState<{ logs: string[] } | null>(null);

  useEffect(() => {
    if (expanded && job.status === "running") {
      const id = setInterval(async () => {
        try {
          const d = await apiFetch<{ logs: string[] }>(`/bulk/status/${job.id}`);
          setFullJob(d);
        } catch {}
      }, 2000);
      return () => clearInterval(id);
    }
  }, [expanded, job.status, job.id]);

  const toggle = async () => {
    if (!expanded && !fullJob) {
      try {
        const d = await apiFetch<{ logs: string[] }>(`/bulk/status/${job.id}`);
        setFullJob(d);
      } catch {}
    }
    setExpanded(e => !e);
  };

  const pct = prog(job.processed, job.totalMatches);

  return (
    <div className="border border-border/50 bg-card/40">
      <div className="p-3 flex items-center gap-3 cursor-pointer hover:bg-white/[0.02]" onClick={toggle}>
        <button className="text-muted-foreground">
          {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        </button>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-mono font-bold text-foreground/90 truncate">
              {job.countryName} — {job.leagueName}
            </span>
            <span className="text-[10px] font-mono text-muted-foreground">{job.year}</span>
            <span className={statusBadge(job.status)}>{job.status}</span>
          </div>
          <div className="text-[10px] text-muted-foreground/60 font-mono mt-0.5">
            {job.oddsPortalPath} · stored: {job.stored}/{job.totalMatches} · skipped: {job.skipped}
          </div>
          {job.status === "running" && job.totalMatches > 0 && (
            <div className="mt-1.5 h-1 w-full bg-border/40 rounded-full overflow-hidden">
              <div
                className="h-full bg-primary transition-all duration-500 shadow-[0_0_6px_rgba(0,255,255,0.5)]"
                style={{ width: `${pct}%` }}
              />
            </div>
          )}
          {job.status === "running" && job.currentMatch && (
            <div className="text-[10px] text-primary/70 font-mono mt-1 truncate">⬡ {job.currentMatch}</div>
          )}
        </div>

        <div className="flex items-center gap-2 flex-shrink-0" onClick={e => e.stopPropagation()}>
          <button
            onClick={onRefresh}
            className="w-7 h-7 flex items-center justify-center text-muted-foreground hover:text-primary transition-colors"
            title="Refresh"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={onDelete}
            className="w-7 h-7 flex items-center justify-center text-muted-foreground hover:text-destructive transition-colors"
            title="Delete job and all its matches"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <AnimatePresence>
        {expanded && fullJob && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="border-t border-border/30 p-3 bg-black/20">
              <div className="text-[10px] font-mono text-muted-foreground mb-2 uppercase tracking-widest">Job Log</div>
              <div className="h-40 overflow-y-auto bg-black/40 border border-border/30 p-2 font-mono text-[10px] text-muted-foreground space-y-0.5">
                {fullJob.logs.length === 0
                  ? <div className="text-center py-4 opacity-50">No log entries yet</div>
                  : fullJob.logs.map((line, i) => (
                    <div key={i} className={
                      line.includes("✓") ? "text-green-400/80" :
                      line.includes("⚠") ? "text-yellow-400/80" :
                      line.includes("❌") || line.includes("Skip") ? "text-destructive/80" :
                      line.includes("✅") ? "text-green-400" :
                      "text-muted-foreground/80"
                    }>
                      {line}
                    </div>
                  ))
                }
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Match detail modal ───────────────────────────────────────────────────────

function MatchDetailModal({ matchId, onClose }: { matchId: string; onClose: () => void }) {
  const [match, setMatch] = useState<MatchDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"odds" | "stats">("odds");

  useEffect(() => {
    apiFetch<MatchDetail>(`/db/match/${matchId}`)
      .then(setMatch)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [matchId]);

  const MARKETS = [
    ["1x2","1X2"], ["ou","O/U"], ["ah","AH"], ["btts","BTTS"],
    ["dc","DC"], ["eh","EH"], ["dnb","DNB"], ["cs","CS"],
    ["htft","HT/FT"], ["oe","O/E"],
  ] as const;

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-[#0a0f1a] border border-primary/50 shadow-[0_0_40px_rgba(0,255,255,0.15)] w-full max-w-3xl max-h-[85vh] flex flex-col"
      >
        <div className="border-b border-border/50 p-4 flex items-center justify-between flex-shrink-0">
          <div>
            {match && (
              <div className="text-sm font-mono font-bold text-foreground/90">
                {match.homeTeam} <span className="text-primary">vs</span> {match.awayTeam}
              </div>
            )}
            {match && (
              <div className="text-[10px] text-muted-foreground font-mono mt-0.5">
                {match.leagueName} · {match.date}
                {match.homeScore !== null && (
                  <span className="ml-2 text-foreground font-bold">
                    {match.homeScore} – {match.awayScore}
                  </span>
                )}
              </div>
            )}
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {loading ? (
          <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm font-mono">Loading…</div>
        ) : !match ? (
          <div className="flex-1 flex items-center justify-center text-destructive text-sm font-mono">Failed to load match</div>
        ) : (
          <div className="flex-1 overflow-y-auto">
            <div className="flex border-b border-border/30">
              {(["odds","stats"] as const).map(t => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={`px-5 py-2.5 text-[10px] font-mono uppercase tracking-widest border-b-2 transition-all ${
                    tab === t
                      ? "border-primary text-primary bg-primary/5"
                      : "border-transparent text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {t === "odds" ? "Bookmaker Odds" : "Team Stats"}
                </button>
              ))}
            </div>

            {tab === "odds" && (
              <div className="p-4 space-y-4">
                {MARKETS.map(([key, label]) => {
                  const data = match.odds[key] as Array<{ bookmaker: string; odds: Record<string, number> }> | null;
                  if (!data || data.length === 0) return (
                    <div key={key} className="opacity-40">
                      <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-1">{label}</div>
                      <div className="text-[11px] text-muted-foreground/50 font-mono">No data</div>
                    </div>
                  );
                  const oddsKeys = [...new Set(data.flatMap(e => Object.keys(e.odds)))].slice(0, 8);
                  return (
                    <div key={key}>
                      <div className="text-[10px] font-mono uppercase tracking-widest text-primary/70 mb-2">{label}</div>
                      <div className="overflow-x-auto">
                        <table className="w-full text-[11px] font-mono">
                          <thead>
                            <tr className="border-b border-border/30">
                              <th className="text-left py-1 pr-3 text-muted-foreground/60 font-normal">Bookmaker</th>
                              {oddsKeys.map(k => (
                                <th key={k} className="text-center px-2 py-1 text-muted-foreground/60 font-normal uppercase">{k}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {data.slice(0, 15).map((e, i) => (
                              <tr key={i} className="border-b border-border/20 hover:bg-white/[0.02]">
                                <td className="py-1 pr-3 text-foreground/80 truncate max-w-[140px]">{e.bookmaker}</td>
                                {oddsKeys.map(k => (
                                  <td key={k} className="text-center px-2 py-1 text-primary/80">
                                    {e.odds[k] != null ? e.odds[k].toFixed(2) : "—"}
                                  </td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {tab === "stats" && (
              <div className="p-4 grid grid-cols-2 gap-4">
                {[
                  { label: match.homeTeam, stats: match.homeStats },
                  { label: match.awayTeam, stats: match.awayStats },
                ].map(({ label, stats }) => (
                  <div key={label}>
                    <div className="text-[10px] font-mono uppercase tracking-widest text-primary/70 mb-2">{label}</div>
                    {!stats ? (
                      <div className="text-[11px] text-muted-foreground/50 font-mono">No stats data</div>
                    ) : (
                      <div className="space-y-1">
                        {((stats as { statHistory: Array<{ label: string; matches: unknown[] }> }).statHistory ?? []).slice(0, 8).map((s) => (
                          <div key={s.label} className="flex items-center justify-between text-[11px] font-mono border-b border-border/20 pb-1">
                            <span className="text-muted-foreground/70 truncate">{s.label}</span>
                            <span className="text-foreground/80 ml-2">{s.matches.length} matches</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </motion.div>
    </div>
  );
}

// ── Main page ────────────────────────────────────────────────────────────────

export default function DatabasePage() {
  const [, navigate] = useLocation();

  const [stats, setStats] = useState<DbStats | null>(null);
  const [jobs, setJobs] = useState<JobSummary[]>([]);
  const [matches, setMatches] = useState<MatchSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const LIMIT = 50;

  const [filterLeague, setFilterLeague] = useState("");
  const [filterYear, setFilterYear] = useState("");
  const [selectedMatchId, setSelectedMatchId] = useState<string | null>(null);
  const [jobsVisible, setJobsVisible] = useState(true);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const [s, j] = await Promise.all([
        apiFetch<DbStats>("/db/stats"),
        apiFetch<JobSummary[]>("/bulk/list"),
      ]);
      setStats(s);
      setJobs(j);

      const params = new URLSearchParams({ limit: String(LIMIT), offset: String(offset) });
      if (filterLeague) params.set("oddsPortalPath", filterLeague);
      if (filterYear)   params.set("year", filterYear);
      const mResp = await apiFetch<{ total: number; matches: MatchSummary[] }>(`/db/matches?${params}`);
      setMatches(mResp.matches);
      setTotal(mResp.total);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [offset, filterLeague, filterYear]);

  useEffect(() => { load(); }, [load]);

  // Poll while any job is running
  useEffect(() => {
    const hasRunning = jobs.some(j => j.status === "running" || j.status === "pending");
    if (!hasRunning) return;
    const id = setInterval(load, 4000);
    return () => clearInterval(id);
  }, [jobs, load]);

  const handleDeleteJob = async (jobId: string) => {
    if (!confirm("Delete this job and all its stored matches?")) return;
    try {
      await apiFetch(`/bulk/${jobId}`, { method: "DELETE" });
      await load();
    } catch {}
  };

  const handleDeleteMatch = async (matchId: string) => {
    try {
      await apiFetch(`/db/match/${matchId}`, { method: "DELETE" });
      setMatches(ms => ms.filter(m => m.id !== matchId));
      setTotal(t => t - 1);
    } catch {}
  };

  const years = Array.from({ length: 8 }, (_, i) => new Date().getFullYear() - i);

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
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { icon: <Database className="w-4 h-4" />, label: "Total Matches", value: stats.matches },
              { icon: <BarChart2 className="w-4 h-4" />, label: "With Stats", value: stats.withStats },
              { icon: <Shield className="w-4 h-4" />, label: "With Odds", value: stats.withOdds },
              { icon: <Zap className="w-4 h-4" />, label: "Upload Jobs", value: stats.jobs },
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

        {/* Jobs section */}
        {jobs.length > 0 && (
          <div>
            <button
              onClick={() => setJobsVisible(v => !v)}
              className="flex items-center gap-2 text-xs font-mono uppercase tracking-widest text-muted-foreground hover:text-foreground transition-colors mb-2"
            >
              {jobsVisible ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              Upload Jobs ({jobs.length})
            </button>
            <AnimatePresence>
              {jobsVisible && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="overflow-hidden space-y-2"
                >
                  {jobs.map(j => (
                    <JobCard
                      key={j.id}
                      job={j}
                      onDelete={() => handleDeleteJob(j.id)}
                      onRefresh={load}
                    />
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}

        {/* Match table */}
        <div>
          <div className="flex flex-wrap items-center gap-3 mb-3">
            <div className="text-xs font-mono uppercase tracking-widest text-muted-foreground flex-1">
              Stored Matches {total > 0 && `(${total})`}
            </div>

            {/* League filter */}
            {stats && stats.leagues.length > 0 && (
              <select
                value={filterLeague}
                onChange={e => { setFilterLeague(e.target.value); setOffset(0); }}
                className="bg-card/40 border border-border text-xs font-mono text-foreground px-2 py-1.5 focus:outline-none focus:border-primary/60"
              >
                <option value="">All Leagues</option>
                {stats.leagues.map(l => (
                  <option key={l.odds_portal_path} value={l.odds_portal_path}>
                    {l.country_name} — {l.league_name}
                  </option>
                ))}
              </select>
            )}

            {/* Year filter */}
            <select
              value={filterYear}
              onChange={e => { setFilterYear(e.target.value); setOffset(0); }}
              className="bg-card/40 border border-border text-xs font-mono text-foreground px-2 py-1.5 focus:outline-none focus:border-primary/60"
            >
              <option value="">All Years</option>
              {years.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
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
                      <th className="text-center px-2 py-2 text-muted-foreground/70 font-normal" title="Stats available">Stats</th>
                      <th className="text-center px-2 py-2 text-muted-foreground/70 font-normal" title="1X2 odds">1X2</th>
                      <th className="text-center px-2 py-2 text-muted-foreground/70 font-normal" title="Over/Under">O/U</th>
                      <th className="text-center px-2 py-2 text-muted-foreground/70 font-normal" title="Asian Handicap">AH</th>
                      <th className="text-center px-2 py-2 text-muted-foreground/70 font-normal" title="Both Teams to Score">BTTS</th>
                      <th className="text-center px-2 py-2 text-muted-foreground/70 font-normal" title="Correct Score">CS</th>
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
                        <td className="px-2 py-2 text-center">{dot(m.hasHomeStats && m.hasAwayStats)}</td>
                        <td className="px-2 py-2 text-center">{dot(m.has1x2)}</td>
                        <td className="px-2 py-2 text-center">{dot(m.hasOU)}</td>
                        <td className="px-2 py-2 text-center">{dot(m.hasAH)}</td>
                        <td className="px-2 py-2 text-center">{dot(m.hasBTTS)}</td>
                        <td className="px-2 py-2 text-center">{dot(m.hasCS)}</td>
                        <td className="px-3 py-2 text-right" onClick={e => e.stopPropagation()}>
                          <button
                            onClick={() => handleDeleteMatch(m.id)}
                            className="text-muted-foreground/30 hover:text-destructive transition-colors"
                            title="Delete match"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
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
