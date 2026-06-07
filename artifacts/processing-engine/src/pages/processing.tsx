import React, { useState, useEffect, useRef, useCallback } from "react";
import { format, addDays, startOfDay, subDays, parseISO } from "date-fns";
import { motion, AnimatePresence } from "framer-motion";
import { useLocation } from "wouter";
import {
  Activity, ChevronLeft, ChevronRight, CalendarDays,
  Upload, Database as DatabaseIcon, Zap, RefreshCw,
  ChevronDown, ChevronUp, Shield, BarChart2, Trash2, Clock,
} from "lucide-react";

const TODAY = startOfDay(new Date());

function apiUrl(path: string) { return `/api${path}`; }

function fmtDate(d: Date) {
  return format(d, "yyyy-MM-dd");
}
function fmtDisplay(d: Date) {
  return format(d, "EEE d MMM");
}
function fmtTime(ts: number) {
  return format(new Date(ts * 1000), "HH:mm");
}

// ── Types ────────────────────────────────────────────────────────────────────

interface ProcessingJobSummary {
  id: string;
  status: string;
  date: string;
  totalMatches: number;
  processed: number;
  stored: number;
  currentMatch: string | null;
  errorMessage: string | null;
  lastLog: string | null;
  createdAt: number;
}

interface ProcessingJobDetail extends ProcessingJobSummary {
  logs: string[];
  updatedAt: number;
}

interface MatchRow {
  id: string;
  date: string;
  homeTeam: string;
  awayTeam: string;
  homeScore: number | null;
  awayScore: number | null;
  status: string | null;
  leagueName: string | null;
  countryName: string | null;
  kickoffTs: number | null;
  hasHomeStats: boolean;
  hasAwayStats: boolean;
  hasHomePlayer: boolean;
  hasAwayPlayer: boolean;
  hasPo1x2: boolean;
  hasPoOU: boolean;
  hasPoAH: boolean;
  hasPoAll: boolean;
  createdAt: number;
}

interface PStats {
  jobs: number;
  matches: number;
  withStats: number;
  withOdds: number;
  withPlayer: number;
  dates: string[];
}

// ── Date strip ────────────────────────────────────────────────────────────────

const STRIP_PAST   = 7;
const STRIP_FUTURE = 5;

function buildDateStrip(center: Date): Date[] {
  const days: Date[] = [];
  for (let i = -STRIP_PAST; i <= STRIP_FUTURE; i++) {
    days.push(addDays(center, i));
  }
  return days;
}

// ── Hook: poll job status ────────────────────────────────────────────────────

function useJobPoller(jobId: string | null, onUpdate: (j: ProcessingJobDetail) => void) {
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!jobId) return;

    const poll = async () => {
      try {
        const r = await fetch(apiUrl(`/processing/status/${jobId}`));
        if (!r.ok) return;
        const j = await r.json() as ProcessingJobDetail;
        onUpdate(j);
        if (j.status === "complete" || j.status === "failed") {
          if (timerRef.current) clearInterval(timerRef.current);
        }
      } catch {}
    };

    poll();
    timerRef.current = setInterval(poll, 2000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [jobId]);
}

// ── Main page ────────────────────────────────────────────────────────────────

export default function ProcessingPage() {
  const [, navigate] = useLocation();
  const [selectedDate, setSelectedDate] = useState<Date>(TODAY);
  const [stripCenter, setStripCenter]   = useState<Date>(TODAY);
  const [jobs, setJobs]       = useState<ProcessingJobSummary[]>([]);
  const [activeJob, setActiveJob] = useState<ProcessingJobDetail | null>(null);
  const [pollingJobId, setPollingJobId] = useState<string | null>(null);
  const [matches, setMatches] = useState<MatchRow[]>([]);
  const [stats, setStats]     = useState<PStats | null>(null);
  const [starting, setStarting] = useState(false);
  const [expandedJobId, setExpandedJobId] = useState<string | null>(null);
  const [loadingMatches, setLoadingMatches] = useState(false);
  const logEndRef = useRef<HTMLDivElement>(null);

  const dateStr = fmtDate(selectedDate);

  // Scroll log to bottom on update
  useEffect(() => {
    if (activeJob?.logs && logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [activeJob?.logs?.length]);

  const loadJobs = useCallback(async () => {
    try {
      const r = await fetch(apiUrl("/processing/list"));
      if (r.ok) setJobs(await r.json() as ProcessingJobSummary[]);
    } catch {}
  }, []);

  const loadMatches = useCallback(async (date: string) => {
    setLoadingMatches(true);
    try {
      const r = await fetch(apiUrl(`/processing/matches?date=${date}`));
      if (r.ok) setMatches(await r.json() as MatchRow[]);
    } catch {} finally {
      setLoadingMatches(false);
    }
  }, []);

  const loadStats = useCallback(async () => {
    try {
      const r = await fetch(apiUrl("/processing/stats"));
      if (r.ok) setStats(await r.json() as PStats);
    } catch {}
  }, []);

  useEffect(() => {
    loadJobs();
    loadStats();
  }, []);

  useEffect(() => {
    loadMatches(dateStr);
  }, [dateStr]);

  useJobPoller(pollingJobId, (j) => {
    setActiveJob(j);
    if (j.status === "complete" || j.status === "failed") {
      setPollingJobId(null);
      loadJobs();
      loadStats();
      loadMatches(dateStr);
    }
  });

  const startJob = async () => {
    setStarting(true);
    try {
      const r = await fetch(apiUrl("/processing/start"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date: dateStr }),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({ error: "Unknown error" })) as { error?: string };
        alert(err.error ?? "Failed to start job");
        return;
      }
      const d = await r.json() as { jobId: string };
      setPollingJobId(d.jobId);
      setExpandedJobId(d.jobId);
      setActiveJob(null);
      await loadJobs();
    } catch (e) {
      alert(String(e));
    } finally {
      setStarting(false);
    }
  };

  const deleteJob = async (id: string) => {
    await fetch(apiUrl(`/processing/${id}`), { method: "DELETE" });
    if (pollingJobId === id) setPollingJobId(null);
    if (activeJob?.id === id) setActiveJob(null);
    await Promise.all([loadJobs(), loadStats(), loadMatches(dateStr)]);
  };

  const dateJobForSelected = jobs.find(j => j.date === dateStr);
  const isRunning = dateJobForSelected?.status === "running" || dateJobForSelected?.status === "pending";
  const dateStrip = buildDateStrip(stripCenter);

  // status badge helper
  const statusBadge = (status: string) => {
    const cfg: Record<string, string> = {
      pending:  "border-yellow-500/50 text-yellow-400 bg-yellow-500/10",
      running:  "border-primary/50 text-primary bg-primary/10",
      complete: "border-green-500/50 text-green-400 bg-green-500/10",
      failed:   "border-red-500/50 text-red-400 bg-red-500/10",
    };
    return `text-[9px] font-mono uppercase tracking-widest border px-1.5 py-0.5 ${cfg[status] ?? "border-border text-muted-foreground"}`;
  };

  return (
    <div className="min-h-screen bg-background text-foreground font-mono">
      {/* ── Top nav ── */}
      <header className="border-b border-border/50 bg-card/30 backdrop-blur-sm sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-6 h-6 border border-primary/50 flex items-center justify-center">
              <Activity className="w-3.5 h-3.5 text-primary" />
            </div>
            <span className="text-primary font-bold tracking-widest uppercase text-sm">Nexus Fixtures</span>
            <span className="text-muted-foreground/40">/</span>
            <span className="text-muted-foreground text-xs uppercase tracking-widest">Processing</span>
          </div>
          <nav className="flex items-center gap-1">
            {[
              { label: "Fixtures", path: "/" },
              { label: "Processing", path: "/processing", active: true },
              { label: "Database", path: "/database" },
            ].map(n => (
              <button
                key={n.path}
                onClick={() => navigate(n.path)}
                className={`text-[10px] font-mono uppercase tracking-widest px-3 py-1.5 border transition-all ${
                  n.active
                    ? "border-primary/60 text-primary bg-primary/10"
                    : "border-transparent text-muted-foreground hover:text-foreground hover:border-border"
                }`}
              >{n.label}</button>
            ))}
          </nav>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 py-6 space-y-6">

        {/* ── Stats strip ── */}
        {stats && (
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            {[
              { label: "Jobs", val: stats.jobs,       icon: <Zap className="w-3 h-3" /> },
              { label: "Matches", val: stats.matches,   icon: <Shield className="w-3 h-3" /> },
              { label: "With Stats", val: stats.withStats, icon: <BarChart2 className="w-3 h-3" /> },
              { label: "With Players", val: stats.withPlayer, icon: <Activity className="w-3 h-3" /> },
              { label: "With Odds", val: stats.withOdds,  icon: <DatabaseIcon className="w-3 h-3" /> },
            ].map(s => (
              <div key={s.label} className="border border-border/40 bg-card/20 p-3">
                <div className="flex items-center gap-1.5 text-muted-foreground mb-1">{s.icon}
                  <span className="text-[9px] uppercase tracking-widest">{s.label}</span>
                </div>
                <div className="text-xl font-bold text-primary tabular-nums">{s.val.toLocaleString()}</div>
              </div>
            ))}
          </div>
        )}

        {/* ── Date navigation ── */}
        <div className="border border-border/40 bg-card/20">
          <div className="border-b border-border/30 px-4 py-2 flex items-center justify-between">
            <div className="flex items-center gap-2 text-[10px] text-muted-foreground uppercase tracking-widest">
              <CalendarDays className="w-3 h-3" />
              Date Selection
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setStripCenter(d => subDays(d, 7))}
                className="w-6 h-6 flex items-center justify-center border border-border/40 text-muted-foreground hover:text-foreground hover:border-primary/40 transition-all"
              ><ChevronLeft className="w-3 h-3" /></button>
              <button
                onClick={() => { setStripCenter(TODAY); setSelectedDate(TODAY); }}
                className="text-[9px] font-mono uppercase tracking-widest px-2 py-1 border border-border/40 text-muted-foreground hover:text-primary hover:border-primary/40 transition-all"
              >Today</button>
              <button
                onClick={() => setStripCenter(d => addDays(d, 7))}
                className="w-6 h-6 flex items-center justify-center border border-border/40 text-muted-foreground hover:text-foreground hover:border-primary/40 transition-all"
              ><ChevronRight className="w-3 h-3" /></button>
            </div>
          </div>

          <div className="p-3 flex gap-1.5 overflow-x-auto scrollbar-thin">
            {dateStrip.map(d => {
              const ds = fmtDate(d);
              const isSelected  = ds === dateStr;
              const isToday     = ds === fmtDate(TODAY);
              const isPast      = d < TODAY;
              const hasData     = stats?.dates.includes(ds);
              return (
                <button
                  key={ds}
                  onClick={() => setSelectedDate(d)}
                  className={`flex-shrink-0 flex flex-col items-center gap-0.5 px-3 py-2 border transition-all min-w-[58px] ${
                    isSelected
                      ? "border-primary bg-primary/15 text-primary"
                      : isToday
                      ? "border-primary/40 text-primary/70 hover:border-primary/60"
                      : "border-border/30 text-muted-foreground hover:border-border hover:text-foreground"
                  }`}
                >
                  <span className="text-[9px] uppercase tracking-widest opacity-60">
                    {format(d, "EEE")}
                  </span>
                  <span className={`text-sm font-bold ${isSelected ? "text-primary" : ""}`}>
                    {format(d, "d")}
                  </span>
                  <span className="text-[8px] opacity-50">{format(d, "MMM")}</span>
                  {hasData && (
                    <div className="w-1 h-1 rounded-full bg-green-400/70 mt-0.5" />
                  )}
                  {isPast && !hasData && (
                    <div className="w-1 h-1 rounded-full bg-border/50 mt-0.5" />
                  )}
                </button>
              );
            })}
          </div>

          {/* Selected date action bar */}
          <div className="border-t border-border/30 px-4 py-3 flex items-center justify-between">
            <div>
              <div className="text-sm font-bold text-foreground">{fmtDisplay(selectedDate)}</div>
              <div className="text-[10px] text-muted-foreground mt-0.5">
                {dateJobForSelected
                  ? `Last job: ${dateJobForSelected.stored} stored, ${dateJobForSelected.processed} processed`
                  : "No data yet for this date"}
              </div>
            </div>
            <button
              onClick={startJob}
              disabled={starting || isRunning}
              className={`flex items-center gap-2 px-4 py-2 border text-xs font-mono uppercase tracking-widest transition-all ${
                starting || isRunning
                  ? "border-border/30 text-muted-foreground/40 cursor-not-allowed"
                  : "border-primary/60 text-primary hover:bg-primary/10 hover:border-primary active:bg-primary/20"
              }`}
            >
              {starting || isRunning
                ? <><RefreshCw className="w-3.5 h-3.5 animate-spin" /> Processing…</>
                : <><Upload className="w-3.5 h-3.5" /> Process Date</>
              }
            </button>
          </div>
        </div>

        {/* ── Active / recent jobs ── */}
        {jobs.length > 0 && (
          <div className="border border-border/40 bg-card/20">
            <div className="border-b border-border/30 px-4 py-2 flex items-center justify-between">
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground flex items-center gap-2">
                <Zap className="w-3 h-3" /> Upload Jobs ({jobs.length})
              </div>
              <button onClick={loadJobs} className="text-muted-foreground hover:text-foreground transition-colors">
                <RefreshCw className="w-3 h-3" />
              </button>
            </div>

            <div className="divide-y divide-border/20">
              {jobs.slice(0, 10).map(j => {
                const isExpanded = expandedJobId === j.id;
                const isActive   = pollingJobId === j.id;
                const detail     = isActive ? activeJob : null;
                const pct        = j.totalMatches > 0 ? Math.round((j.processed / j.totalMatches) * 100) : 0;

                return (
                  <div key={j.id} className="group">
                    <div
                      className="px-4 py-3 flex items-center gap-3 cursor-pointer hover:bg-card/30 transition-colors"
                      onClick={() => setExpandedJobId(isExpanded ? null : j.id)}
                    >
                      {/* Status dot */}
                      <div className={`w-2 h-2 rounded-full flex-shrink-0 ${
                        j.status === "running" ? "bg-primary animate-pulse"
                        : j.status === "complete" ? "bg-green-400"
                        : j.status === "failed"   ? "bg-red-400"
                        : "bg-yellow-400"
                      }`} />

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs font-bold text-foreground">{j.date}</span>
                          <span className={statusBadge(j.status)}>{j.status}</span>
                          <span className="text-[10px] text-muted-foreground">
                            {j.stored}/{j.totalMatches} stored
                          </span>
                          {j.currentMatch && (
                            <span className="text-[10px] text-primary/60 truncate max-w-[200px]">
                              {j.currentMatch}
                            </span>
                          )}
                        </div>
                        {/* Progress bar */}
                        {(j.status === "running" || j.status === "complete") && j.totalMatches > 0 && (
                          <div className="mt-1.5 w-full bg-border/20 h-0.5">
                            <div
                              className={`h-0.5 transition-all ${j.status === "complete" ? "bg-green-400" : "bg-primary"}`}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        )}
                      </div>

                      <div className="flex items-center gap-2 flex-shrink-0">
                        <button
                          onClick={e => { e.stopPropagation(); deleteJob(j.id); }}
                          className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-red-400 transition-all"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                        {isExpanded ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" /> : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />}
                      </div>
                    </div>

                    {/* Expanded log */}
                    <AnimatePresence>
                      {isExpanded && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: "auto", opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.2 }}
                          className="overflow-hidden"
                        >
                          <div className="px-4 pb-4">
                            <div className="bg-black/40 border border-border/30 p-3 max-h-56 overflow-y-auto text-[10px] font-mono space-y-0.5">
                              {(detail?.logs ?? [j.lastLog].filter(Boolean) as string[]).map((line, i) => {
                                const isErr  = line.includes("❌") || line.includes("⚠");
                                const isOk   = line.includes("✓") || line.includes("✅");
                                const isPrimary = line.includes("🌐") || line.includes("Stage");
                                return (
                                  <div key={i} className={
                                    isErr     ? "text-red-400/80"
                                    : isOk    ? "text-green-400/80"
                                    : isPrimary ? "text-primary/70"
                                    : "text-muted-foreground/70"
                                  }>{line}</div>
                                );
                              })}
                              <div ref={logEndRef} />
                            </div>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── Stored matches for selected date ── */}
        <div className="border border-border/40 bg-card/20">
          <div className="border-b border-border/30 px-4 py-2 flex items-center justify-between">
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground flex items-center gap-2">
              <Shield className="w-3 h-3" />
              Matches for {fmtDisplay(selectedDate)}
              <span className="text-primary/60">({matches.length})</span>
            </div>
            <button
              onClick={() => loadMatches(dateStr)}
              className="text-muted-foreground hover:text-foreground transition-colors"
            ><RefreshCw className="w-3 h-3" /></button>
          </div>

          {loadingMatches ? (
            <div className="p-8 text-center text-muted-foreground/40 text-xs">Loading…</div>
          ) : matches.length === 0 ? (
            <div className="p-8 text-center">
              <DatabaseIcon className="w-8 h-8 text-muted-foreground/20 mx-auto mb-2" />
              <div className="text-xs text-muted-foreground/40">No matches stored for this date</div>
              <div className="text-[10px] text-muted-foreground/30 mt-1">Press "Process Date" to fetch and store data</div>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border/30 text-[9px] text-muted-foreground uppercase tracking-widest">
                    <th className="text-left px-4 py-2">Time</th>
                    <th className="text-left px-4 py-2">Match</th>
                    <th className="text-left px-4 py-2">League</th>
                    <th className="text-left px-4 py-2">Score</th>
                    <th className="text-center px-2 py-2">Stats</th>
                    <th className="text-center px-2 py-2">Players</th>
                    <th className="text-center px-2 py-2">1X2</th>
                    <th className="text-center px-2 py-2">O/U</th>
                    <th className="text-center px-2 py-2">AH</th>
                    <th className="text-center px-2 py-2">More</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/15">
                  {matches.map(m => {
                    const allOddsCount = [m.hasPo1x2, m.hasPoOU, m.hasPoAH].filter(Boolean).length;
                    const statsOk = m.hasHomeStats && m.hasAwayStats;
                    const playerOk = m.hasHomePlayer && m.hasAwayPlayer;
                    return (
                      <motion.tr
                        key={m.id}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        className="hover:bg-card/30 transition-colors group"
                      >
                        <td className="px-4 py-2.5 text-muted-foreground/60 tabular-nums">
                          {m.kickoffTs ? fmtTime(m.kickoffTs) : "—"}
                        </td>
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-1.5">
                            <span className="text-foreground font-medium">{m.homeTeam}</span>
                            <span className="text-muted-foreground/40 text-[10px]">vs</span>
                            <span className="text-foreground font-medium">{m.awayTeam}</span>
                          </div>
                        </td>
                        <td className="px-4 py-2.5">
                          <div className="text-[10px] text-muted-foreground/60 truncate max-w-[160px]">
                            {m.countryName} — {m.leagueName}
                          </div>
                        </td>
                        <td className="px-4 py-2.5 tabular-nums font-bold">
                          {m.homeScore !== null && m.awayScore !== null
                            ? <span className="text-primary/80">{m.homeScore} – {m.awayScore}</span>
                            : <span className="text-muted-foreground/30">—</span>
                          }
                        </td>
                        <DataPip ok={statsOk} />
                        <DataPip ok={playerOk} />
                        <DataPip ok={m.hasPo1x2} />
                        <DataPip ok={m.hasPoOU} />
                        <DataPip ok={m.hasPoAH} />
                        <td className="px-2 py-2.5 text-center">
                          {allOddsCount > 0
                            ? <span className="text-[9px] text-primary/70">{allOddsCount}/3+</span>
                            : <span className="text-[9px] text-muted-foreground/30">—</span>
                          }
                        </td>
                      </motion.tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}

function DataPip({ ok }: { ok: boolean }) {
  return (
    <td className="px-2 py-2.5 text-center">
      <span className={`inline-block w-1.5 h-1.5 rounded-full ${ok ? "bg-green-400" : "bg-border/40"}`} />
    </td>
  );
}
