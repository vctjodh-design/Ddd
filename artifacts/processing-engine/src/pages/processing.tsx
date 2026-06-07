import React, { useState, useEffect, useRef, useCallback } from "react";
import { format, addDays, startOfDay, subDays } from "date-fns";
import { motion, AnimatePresence } from "framer-motion";
import { useLocation } from "wouter";
import {
  Activity, ChevronLeft, ChevronRight, CalendarDays,
  Upload, Database as DatabaseIcon, Zap, RefreshCw,
  BarChart2, Shield,
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
  const [stats, setStats]     = useState<PStats | null>(null);
  const [starting, setStarting] = useState(false);
  const logContainerRef = useRef<HTMLDivElement>(null);

  const dateStr = fmtDate(selectedDate);

  // Scroll log container (not the page) to bottom on new lines
  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [activeJob?.logs?.length]);

  const loadJobs = useCallback(async () => {
    try {
      const r = await fetch(apiUrl("/processing/list"));
      if (r.ok) setJobs(await r.json() as ProcessingJobSummary[]);
    } catch {}
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

  useJobPoller(pollingJobId, (j) => {
    setActiveJob(j);
    if (j.status === "complete" || j.status === "failed") {
      setPollingJobId(null);
      loadJobs();
      loadStats();
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
    await Promise.all([loadJobs(), loadStats()]);
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

        {/* ── Active job log ── */}
        <AnimatePresence>
          {activeJob && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="border border-border/40 bg-card/20"
            >
              <div className="border-b border-border/30 px-4 py-2 flex items-center justify-between">
                <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-muted-foreground">
                  <Zap className="w-3 h-3" />
                  <span>Job — {activeJob.date}</span>
                  <span className={statusBadge(activeJob.status)}>{activeJob.status}</span>
                  {activeJob.totalMatches > 0 && (
                    <span className="text-primary/60">
                      {activeJob.stored}/{activeJob.totalMatches} stored
                    </span>
                  )}
                </div>
                <button
                  onClick={() => { deleteJob(activeJob.id); }}
                  className="text-muted-foreground hover:text-red-400 transition-colors text-[10px] font-mono uppercase tracking-widest"
                >
                  Dismiss
                </button>
              </div>

              {/* Progress bar */}
              {activeJob.totalMatches > 0 && (
                <div className="h-0.5 w-full bg-border/20">
                  <div
                    className={`h-0.5 transition-all duration-500 ${activeJob.status === "complete" ? "bg-green-400" : "bg-primary shadow-[0_0_6px_rgba(0,255,255,0.5)]"}`}
                    style={{ width: `${Math.round((activeJob.processed / activeJob.totalMatches) * 100)}%` }}
                  />
                </div>
              )}

              {activeJob.currentMatch && activeJob.status === "running" && (
                <div className="px-4 py-1.5 text-[10px] font-mono text-primary/60 truncate border-b border-border/20">
                  ⬡ {activeJob.currentMatch}
                </div>
              )}

              {/* Log output */}
              <div className="p-4">
                <div ref={logContainerRef} className="bg-black/40 border border-border/30 p-3 h-56 overflow-y-auto text-[10px] font-mono space-y-0.5">
                  {activeJob.logs.length === 0
                    ? <div className="text-center py-8 text-muted-foreground/30">Waiting for output…</div>
                    : activeJob.logs.map((line, i) => (
                      <div key={i} className={
                        line.includes("❌") || line.includes("⚠") ? "text-red-400/80"
                        : line.includes("✓") || line.includes("✅") ? "text-green-400/80"
                        : line.includes("🌐") || line.includes("Stage") ? "text-primary/70"
                        : "text-muted-foreground/70"
                      }>{line}</div>
                    ))
                  }
                </div>
              </div>

              {(activeJob.status === "complete" || activeJob.status === "failed") && (
                <div className="px-4 pb-4 flex items-center gap-3">
                  <button
                    onClick={() => navigate("/database")}
                    className="flex items-center gap-1.5 px-3 py-1.5 border border-primary/50 text-primary text-[10px] font-mono uppercase tracking-widest hover:bg-primary/10 transition-all"
                  >
                    <DatabaseIcon className="w-3 h-3" /> View in Database
                  </button>
                  <button
                    onClick={() => setActiveJob(null)}
                    className="px-3 py-1.5 border border-border/40 text-muted-foreground text-[10px] font-mono uppercase tracking-widest hover:border-border hover:text-foreground transition-all"
                  >
                    Dismiss
                  </button>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Empty state when no active job */}
        {!activeJob && (
          <div className="border border-border/30 bg-card/10 p-10 text-center">
            <RefreshCw className="w-8 h-8 text-muted-foreground/20 mx-auto mb-3" />
            <div className="text-xs text-muted-foreground/40 uppercase tracking-widest">No active job</div>
            <div className="text-[10px] text-muted-foreground/30 mt-1">
              Select a date above and press "Process Date" to start
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
