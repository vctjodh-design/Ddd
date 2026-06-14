import React, { useState, useEffect, useRef, useCallback } from "react";
import { format, addDays, startOfDay, subDays } from "date-fns";
import { motion, AnimatePresence } from "framer-motion";
import { useLocation } from "wouter";
import {
  FlaskConical, ChevronLeft, ChevronRight, CalendarDays,
  Play, Trash2, RefreshCw, ChevronDown, ChevronUp,
  TrendingUp, Target, Zap, BarChart2, AlertCircle,
  CheckCircle2, Cpu, Wand2,
} from "lucide-react";
import WizardModal from "@/components/WizardModal";

const TODAY = startOfDay(new Date());

function apiUrl(path: string) { return `/api${path}`; }
function fmtDate(d: Date)    { return format(d, "yyyy-MM-dd"); }
function fmtDisplay(d: Date) { return format(d, "EEE d MMM"); }
function pct(v: number)      { return `${Math.round(v * 100)}%`; }
function odds(v: number | null) { return v != null ? v.toFixed(2) : "—"; }

const NAV_ITEMS = [
  { label: "Fixtures",   path: "/" },
  { label: "Processing", path: "/processing" },
  { label: "Tester",     path: "/tester", active: true },
  { label: "Database",   path: "/database" },
];

// ── Types ─────────────────────────────────────────────────────────────────────

interface TesterJobSummary {
  id: string; status: string; date: string;
  totalMatches: number; processed: number; stored: number;
  currentMatch: string | null; errorMessage: string | null;
  lastLog: string | null; createdAt: number;
}

interface TesterJobDetail extends TesterJobSummary {
  logs: string[]; updatedAt: number;
}

interface TesterMatchRow {
  id: string; jobId: string; date: string;
  homeTeam: string; awayTeam: string;
  leagueName: string | null; countryName: string | null;
  kickoffTs: number | null; dataSource: string;
  hasHomeStats: boolean; hasAwayStats: boolean;
  hasOdds: boolean; bookieCount: number; createdAt: number;
}

interface PredictionOutput {
  method: string; featureQuality: "full" | "partial" | "minimal";
  nSamples: number; accuracy1x2: number; accuracyBtts: number;
  lambdaHome: number; lambdaAway: number;
  onex2:  { H: number; D: number; A: number };
  btts:   { yes: number; no: number };
  dc:     { "1X": number; "12": number; X2: number };
  corners: { predicted: number; stdDev: number; over85: number; over95: number; over105: number };
  correctScores: Array<{ home: number; away: number; prob: number }>;
  bestOdds: {
    onex2: { H: number | null; D: number | null; A: number | null };
    btts:  { yes: number | null; no: number | null };
    dc:    { "1X": number | null; "12": number | null; X2: number | null };
  };
  impliedProbs: {
    onex2: { H: number; D: number; A: number };
    btts:  { yes: number; no: number };
  };
  valueBets: Array<{
    market: string; outcome: string;
    modelProb: number; impliedProb: number; edge: number; bestOdds: number | null;
  }>;
  bookieCount: number; dataSource: string;
}

interface TStats {
  jobs: number; matches: number; withStats: number; withOdds: number; dates: string[];
}

// ── Date strip ────────────────────────────────────────────────────────────────

const STRIP_PAST   = 7;
const STRIP_FUTURE = 5;

function buildDateStrip(center: Date): Date[] {
  const days: Date[] = [];
  for (let i = -STRIP_PAST; i <= STRIP_FUTURE; i++) days.push(addDays(center, i));
  return days;
}

// ── Polling hook ──────────────────────────────────────────────────────────────

function useJobPoller(jobId: string | null, onUpdate: (j: TesterJobDetail) => void) {
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (!jobId) return;
    const poll = async () => {
      try {
        const r = await fetch(apiUrl(`/tester/status/${jobId}`));
        if (!r.ok) return;
        const j = await r.json() as TesterJobDetail;
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

// ── Confidence bar ────────────────────────────────────────────────────────────

function ConfBar({ value, color = "bg-primary" }: { value: number; color?: string }) {
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-border/30 rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full transition-all`} style={{ width: `${Math.round(value * 100)}%` }} />
      </div>
      <span className="text-[10px] font-mono text-foreground/80 w-8 text-right">{pct(value)}</span>
    </div>
  );
}

// ── Prediction panel ──────────────────────────────────────────────────────────

function PredictionPanel({ pred, loading }: { pred: PredictionOutput | null; loading: boolean }) {
  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-6 text-primary/50">
        <RefreshCw className="w-4 h-4 animate-spin" />
        <span className="text-[10px] font-mono uppercase tracking-widest">Computing prediction…</span>
      </div>
    );
  }
  if (!pred) return null;

  const qualColor: Record<string, string> = {
    full:    "text-green-400 border-green-500/40 bg-green-500/10",
    partial: "text-yellow-400 border-yellow-500/40 bg-yellow-500/10",
    minimal: "text-red-400 border-red-500/40 bg-red-500/10",
  };

  const topScore = pred.correctScores[0];
  const topScore2 = pred.correctScores[1];

  return (
    <div className="space-y-4 pt-1">

      {/* Quality + method row */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className={`text-[9px] font-mono uppercase tracking-widest border px-1.5 py-0.5 ${qualColor[pred.featureQuality] ?? ""}`}>
          {pred.featureQuality} data
        </span>
        <span className="text-[9px] font-mono text-muted-foreground">{pred.method}</span>
        {pred.bookieCount > 0 && (
          <span className="text-[9px] font-mono text-primary/60">{pred.bookieCount} bookie entries</span>
        )}
        {pred.nSamples > 0 && (
          <span className="text-[9px] font-mono text-muted-foreground/60">{pred.nSamples} training samples · RF acc {pred.accuracy1x2}%</span>
        )}
      </div>

      {/* Main markets grid */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">

        {/* 1X2 */}
        <div className="border border-border/30 bg-card/30 p-3 space-y-2">
          <div className="text-[9px] font-mono uppercase tracking-widest text-muted-foreground flex items-center gap-1">
            <Target className="w-3 h-3" /> 1X2
          </div>
          <div className="space-y-1.5">
            {[
              { label: "Home", value: pred.onex2.H, odds: pred.bestOdds.onex2.H, impl: pred.impliedProbs.onex2.H, color: "bg-blue-400" },
              { label: "Draw", value: pred.onex2.D, odds: pred.bestOdds.onex2.D, impl: pred.impliedProbs.onex2.D, color: "bg-yellow-400" },
              { label: "Away", value: pred.onex2.A, odds: pred.bestOdds.onex2.A, impl: pred.impliedProbs.onex2.A, color: "bg-red-400" },
            ].map(row => (
              <div key={row.label}>
                <div className="flex justify-between items-center mb-0.5">
                  <span className="text-[9px] font-mono text-muted-foreground">{row.label}</span>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[9px] font-mono text-primary">{pct(row.value)}</span>
                    {row.odds != null && (
                      <span className="text-[8px] font-mono text-muted-foreground/60">@ {odds(row.odds)}</span>
                    )}
                  </div>
                </div>
                <ConfBar value={row.value} color={row.color} />
              </div>
            ))}
          </div>
        </div>

        {/* BTTS */}
        <div className="border border-border/30 bg-card/30 p-3 space-y-2">
          <div className="text-[9px] font-mono uppercase tracking-widest text-muted-foreground flex items-center gap-1">
            <BarChart2 className="w-3 h-3" /> BTTS
          </div>
          <div className="space-y-1.5">
            {[
              { label: "Yes", value: pred.btts.yes, odds: pred.bestOdds.btts.yes, color: "bg-green-400" },
              { label: "No",  value: pred.btts.no,  odds: pred.bestOdds.btts.no,  color: "bg-red-400" },
            ].map(row => (
              <div key={row.label}>
                <div className="flex justify-between items-center mb-0.5">
                  <span className="text-[9px] font-mono text-muted-foreground">{row.label}</span>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[9px] font-mono text-primary">{pct(row.value)}</span>
                    {row.odds != null && (
                      <span className="text-[8px] font-mono text-muted-foreground/60">@ {odds(row.odds)}</span>
                    )}
                  </div>
                </div>
                <ConfBar value={row.value} color={row.color} />
              </div>
            ))}
          </div>
          <div className="border-t border-border/20 pt-2 space-y-1">
            <div className="text-[9px] font-mono text-muted-foreground uppercase tracking-widest">DC</div>
            {[
              { label: "1X", value: pred.dc["1X"], odds: pred.bestOdds.dc["1X"] },
              { label: "12", value: pred.dc["12"], odds: pred.bestOdds.dc["12"] },
              { label: "X2", value: pred.dc.X2,    odds: pred.bestOdds.dc["X2"] },
            ].map(row => (
              <div key={row.label} className="flex justify-between">
                <span className="text-[9px] font-mono text-muted-foreground/70">{row.label}</span>
                <div className="flex items-center gap-1">
                  <span className="text-[9px] font-mono text-foreground/80">{pct(row.value)}</span>
                  {row.odds != null && (
                    <span className="text-[8px] font-mono text-muted-foreground/50">@ {odds(row.odds)}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Correct scores + corners */}
        <div className="border border-border/30 bg-card/30 p-3 space-y-2">
          <div className="text-[9px] font-mono uppercase tracking-widest text-muted-foreground flex items-center gap-1">
            <TrendingUp className="w-3 h-3" /> Score & Corners
          </div>
          <div className="space-y-1">
            <div className="text-[9px] font-mono text-muted-foreground/60">Expected: {pred.lambdaHome.toFixed(2)}–{pred.lambdaAway.toFixed(2)}</div>
            {topScore && (
              <div className="flex justify-between">
                <span className="text-[9px] font-mono text-primary">{topScore.home}–{topScore.away}</span>
                <span className="text-[9px] font-mono text-muted-foreground">{pct(topScore.prob)}</span>
              </div>
            )}
            {topScore2 && (
              <div className="flex justify-between">
                <span className="text-[9px] font-mono text-foreground/70">{topScore2.home}–{topScore2.away}</span>
                <span className="text-[9px] font-mono text-muted-foreground">{pct(topScore2.prob)}</span>
              </div>
            )}
            {pred.correctScores.slice(2, 5).map(s => (
              <div key={`${s.home}-${s.away}`} className="flex justify-between">
                <span className="text-[9px] font-mono text-muted-foreground/60">{s.home}–{s.away}</span>
                <span className="text-[9px] font-mono text-muted-foreground/50">{pct(s.prob)}</span>
              </div>
            ))}
          </div>
          <div className="border-t border-border/20 pt-2 space-y-0.5">
            <div className="text-[9px] font-mono text-muted-foreground uppercase tracking-widest">Corners</div>
            <div className="flex justify-between">
              <span className="text-[9px] font-mono text-muted-foreground/60">Predicted</span>
              <span className="text-[9px] font-mono text-foreground/80">{pred.corners.predicted} ±{pred.corners.stdDev}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[9px] font-mono text-muted-foreground/60">Over 8.5</span>
              <span className="text-[9px] font-mono text-foreground/80">{pred.corners.over85}%</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[9px] font-mono text-muted-foreground/60">Over 9.5</span>
              <span className="text-[9px] font-mono text-foreground/80">{pred.corners.over95}%</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[9px] font-mono text-muted-foreground/60">Over 10.5</span>
              <span className="text-[9px] font-mono text-foreground/80">{pred.corners.over105}%</span>
            </div>
          </div>
        </div>
      </div>

      {/* Value bets */}
      {pred.valueBets.length > 0 && (
        <div className="border border-yellow-500/20 bg-yellow-500/5 p-3">
          <div className="flex items-center gap-1.5 text-yellow-400 mb-2">
            <Zap className="w-3 h-3" />
            <span className="text-[9px] font-mono uppercase tracking-widest">Value Bets (edge ≥ 4%)</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
            {pred.valueBets.map((vb, i) => (
              <div key={i} className="flex items-center justify-between bg-black/20 px-2 py-1">
                <div className="flex items-center gap-1.5">
                  <span className="text-[9px] font-mono text-yellow-400/80">{vb.market} {vb.outcome}</span>
                  {vb.bestOdds != null && (
                    <span className="text-[9px] font-mono text-muted-foreground/60">@ {odds(vb.bestOdds)}</span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[9px] font-mono text-foreground/80">model {pct(vb.modelProb)}</span>
                  <span className="text-[9px] font-mono text-green-400">+{Math.round(vb.edge * 100)}%</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Match row with expandable prediction ──────────────────────────────────────

function MatchRow({ match, onWizard }: { match: TesterMatchRow; onWizard: () => void }) {
  const [open, setOpen]         = useState(false);
  const [loading, setLoading]   = useState(false);
  const [pred, setPred]         = useState<PredictionOutput | null>(null);
  const [error, setError]       = useState<string | null>(null);

  const handleToggle = async () => {
    setOpen(v => !v);
    if (!open && !pred && !loading) {
      setLoading(true);
      setError(null);
      try {
        const r = await fetch(apiUrl(`/tester/predict/${match.id}`), { method: "POST" });
        if (!r.ok) {
          const e = await r.json().catch(() => ({ error: "Unknown" })) as { error?: string };
          setError(e.error ?? "Prediction failed");
        } else {
          setPred(await r.json() as PredictionOutput);
        }
      } catch (e) {
        setError(String(e));
      } finally {
        setLoading(false);
      }
    }
  };

  const statsOk  = match.hasHomeStats && match.hasAwayStats;
  const oddsOk   = match.hasOdds;
  const kickTime = match.kickoffTs ? format(new Date(match.kickoffTs * 1000), "HH:mm") : null;

  return (
    <div className={`border transition-all ${open ? "border-primary/30 bg-card/30" : "border-border/20 bg-card/10 hover:border-border/40"}`}>
      {/* Row header — uses div to allow nested buttons */}
      <div
        role="button"
        tabIndex={0}
        onClick={handleToggle}
        onKeyDown={e => e.key === "Enter" && handleToggle()}
        className="w-full flex items-center gap-3 px-4 py-3 text-left cursor-pointer select-none"
      >
        {/* Time */}
        <div className="w-10 flex-shrink-0 text-center">
          {kickTime
            ? <span className="text-[10px] font-mono text-primary/60">{kickTime}</span>
            : <span className="text-[10px] font-mono text-muted-foreground/30">—</span>
          }
        </div>

        {/* Teams */}
        <div className="flex-1 min-w-0">
          <div className="text-[11px] font-mono text-foreground font-bold truncate">
            {match.homeTeam} <span className="text-muted-foreground/50 font-normal">vs</span> {match.awayTeam}
          </div>
          {(match.leagueName || match.countryName) && (
            <div className="text-[9px] text-muted-foreground/50 font-mono truncate mt-0.5">
              {match.countryName}{match.leagueName ? ` · ${match.leagueName}` : ""}
            </div>
          )}
        </div>

        {/* Indicators */}
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {statsOk
            ? <span title="Stats available" className="w-4 h-4 flex items-center justify-center text-green-400"><CheckCircle2 className="w-3 h-3" /></span>
            : <span title="No stats" className="w-4 h-4 flex items-center justify-center text-muted-foreground/30"><AlertCircle className="w-3 h-3" /></span>
          }
          {oddsOk
            ? <span title={`${match.bookieCount} bookie entries`} className="text-[9px] font-mono text-primary/60 bg-primary/10 px-1">{match.bookieCount}</span>
            : <span title="No odds" className="text-[9px] font-mono text-muted-foreground/30">—</span>
          }
          <span className={`text-[8px] font-mono uppercase tracking-widest px-1 ${match.dataSource === "statshub" ? "text-blue-400/70" : "text-muted-foreground/40"}`}>
            {match.dataSource === "statshub" ? "SH" : "BE"}
          </span>
          {/* Wizard button — stop propagation so row toggle doesn't fire */}
          <button
            type="button"
            onClick={e => { e.stopPropagation(); onWizard(); }}
            title="Open Futuristic Data Wizard Analysis"
            className="flex items-center gap-1 px-2 py-0.5 border border-cyan-500/30 text-cyan-400/70 hover:border-cyan-400 hover:text-cyan-300 hover:bg-cyan-500/10 transition-all text-[8px] font-mono uppercase tracking-wide"
          >
            <Wand2 className="w-2.5 h-2.5" />
            <span>Wizard</span>
          </button>
        </div>

        {/* Toggle icon */}
        <div className="flex-shrink-0 text-muted-foreground/40">
          {open ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        </div>
      </div>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="border-t border-border/20 px-4 pb-4 pt-3">
              {error ? (
                <div className="text-[10px] font-mono text-red-400/80 flex items-center gap-1.5">
                  <AlertCircle className="w-3 h-3" /> {error}
                </div>
              ) : (
                <PredictionPanel pred={pred} loading={loading} />
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function TesterPage() {
  const [, navigate] = useLocation();
  const [selectedDate, setSelectedDate] = useState<Date>(TODAY);
  const [stripCenter, setStripCenter]   = useState<Date>(TODAY);
  const [jobs, setJobs]       = useState<TesterJobSummary[]>([]);
  const [activeJob, setActiveJob] = useState<TesterJobDetail | null>(null);
  const [pollingJobId, setPollingJobId] = useState<string | null>(null);
  const [stats, setStats]     = useState<TStats | null>(null);
  const [matches, setMatches] = useState<TesterMatchRow[]>([]);
  const [loadingMatches, setLoadingMatches] = useState(false);
  const [starting, setStarting] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [wizardMatch, setWizardMatch] = useState<TesterMatchRow | null>(null);
  const logContainerRef = useRef<HTMLDivElement>(null);

  const dateStr = fmtDate(selectedDate);

  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [activeJob?.logs?.length]);

  const loadJobs = useCallback(async () => {
    try {
      const r = await fetch(apiUrl("/tester/list"));
      if (r.ok) setJobs(await r.json() as TesterJobSummary[]);
    } catch {}
  }, []);

  const loadStats = useCallback(async () => {
    try {
      const r = await fetch(apiUrl("/tester/stats"));
      if (r.ok) setStats(await r.json() as TStats);
    } catch {}
  }, []);

  const loadMatches = useCallback(async (date: string) => {
    setLoadingMatches(true);
    try {
      const r = await fetch(apiUrl(`/tester/matches?date=${date}`));
      if (r.ok) setMatches(await r.json() as TesterMatchRow[]);
      else setMatches([]);
    } catch {
      setMatches([]);
    } finally {
      setLoadingMatches(false);
    }
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
      const r = await fetch(apiUrl("/tester/start"), {
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
      setMatches([]);
      await loadJobs();
    } catch (e) {
      alert(String(e));
    } finally {
      setStarting(false);
    }
  };

  const clearAll = async () => {
    setClearing(true);
    setShowClearConfirm(false);
    try {
      const r = await fetch(apiUrl("/tester/matches/all"), { method: "DELETE" });
      if (!r.ok) { alert("Failed to clear tester database"); return; }
      setActiveJob(null);
      setPollingJobId(null);
      setMatches([]);
      await Promise.all([loadJobs(), loadStats()]);
    } catch (e) {
      alert(String(e));
    } finally {
      setClearing(false);
    }
  };

  const statusBadge = (status: string) => {
    const cfg: Record<string, string> = {
      pending:  "border-yellow-500/50 text-yellow-400 bg-yellow-500/10",
      running:  "border-primary/50 text-primary bg-primary/10",
      complete: "border-green-500/50 text-green-400 bg-green-500/10",
      failed:   "border-red-500/50 text-red-400 bg-red-500/10",
    };
    return `text-[9px] font-mono uppercase tracking-widest border px-1.5 py-0.5 ${cfg[status] ?? "border-border text-muted-foreground"}`;
  };

  const dateJobForSelected = jobs.find(j => j.date === dateStr);
  const isRunning = dateJobForSelected?.status === "running" || dateJobForSelected?.status === "pending";
  const dateStrip = buildDateStrip(stripCenter);
  const totalMatches = stats?.matches ?? 0;

  return (
    <div className="min-h-screen bg-background text-foreground font-mono">

      {/* ── Clear confirmation ── */}
      <AnimatePresence>
        {showClearConfirm && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
              className="border border-red-500/40 bg-card/95 backdrop-blur p-6 max-w-sm w-full mx-4 space-y-4"
            >
              <div className="flex items-center gap-2 text-red-400">
                <Trash2 className="w-4 h-4" />
                <span className="text-xs font-mono uppercase tracking-widest font-bold">Clear Tester DB</span>
              </div>
              <p className="text-sm text-muted-foreground leading-relaxed">
                This permanently deletes <span className="text-foreground font-bold">all {totalMatches} tester match{totalMatches !== 1 ? "es" : ""}</span> and all tester job history. Training data is NOT affected.
              </p>
              <div className="flex items-center gap-2 pt-1">
                <button
                  onClick={clearAll}
                  className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 border border-red-500/60 text-red-400 text-[10px] font-mono uppercase tracking-widest hover:bg-red-500/10 transition-all"
                >
                  <Trash2 className="w-3 h-3" /> Yes, Clear All
                </button>
                <button
                  onClick={() => setShowClearConfirm(false)}
                  className="flex-1 px-3 py-2 border border-border/40 text-muted-foreground text-[10px] font-mono uppercase tracking-widest hover:border-border hover:text-foreground transition-all"
                >
                  Cancel
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Header ── */}
      <header className="border-b border-border/50 bg-card/30 backdrop-blur-sm sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-6 h-6 border border-primary/50 flex items-center justify-center">
              <FlaskConical className="w-3.5 h-3.5 text-primary" />
            </div>
            <span className="text-primary font-bold tracking-widest uppercase text-sm">Nexus Fixtures</span>
            <span className="text-muted-foreground/40">/</span>
            <span className="text-muted-foreground text-xs uppercase tracking-widest">Tester</span>
          </div>
          <nav className="flex items-center gap-1">
            {NAV_ITEMS.map(n => (
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

        {/* ── Stats bar ── */}
        {stats && (
          <div className="flex items-center gap-4 flex-wrap text-[10px] font-mono text-muted-foreground/70">
            <div className="flex items-center gap-1.5">
              <Cpu className="w-3 h-3 text-primary/50" />
              <span>Tester DB: <span className="text-foreground/80">{stats.matches}</span> matches · <span className="text-foreground/80">{stats.withStats}</span> with stats · <span className="text-foreground/80">{stats.withOdds}</span> with odds</span>
            </div>
          </div>
        )}

        {/* ── Date navigation ── */}
        <div className="border border-border/40 bg-card/20">
          <div className="border-b border-border/30 px-4 py-2 flex items-center justify-between">
            <div className="flex items-center gap-2 text-[10px] text-muted-foreground uppercase tracking-widest">
              <CalendarDays className="w-3 h-3" /> Date Selection
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

          <div className="p-3 flex gap-1.5 overflow-x-auto">
            {dateStrip.map(d => {
              const ds = fmtDate(d);
              const isSelected = ds === dateStr;
              const isToday    = ds === fmtDate(TODAY);
              const hasData    = stats?.dates.includes(ds);
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
                  <span className="text-[9px] uppercase tracking-widest opacity-60">{format(d, "EEE")}</span>
                  <span className={`text-sm font-bold ${isSelected ? "text-primary" : ""}`}>{format(d, "d")}</span>
                  <span className="text-[8px] opacity-50">{format(d, "MMM")}</span>
                  {hasData && <div className="w-1 h-1 rounded-full bg-green-400/70 mt-0.5" />}
                </button>
              );
            })}
          </div>

          <div className="border-t border-border/30 px-4 py-3 flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-bold text-foreground">{fmtDisplay(selectedDate)}</div>
              <div className="text-[10px] text-muted-foreground mt-0.5">
                {dateJobForSelected
                  ? `Last run: ${dateJobForSelected.stored} stored, ${dateJobForSelected.processed} processed`
                  : "No tester data for this date"}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowClearConfirm(true)}
                disabled={clearing || totalMatches === 0}
                className={`flex items-center gap-1.5 px-3 py-2 border text-[10px] font-mono uppercase tracking-widest transition-all ${
                  clearing || totalMatches === 0
                    ? "border-border/20 text-muted-foreground/30 cursor-not-allowed"
                    : "border-red-500/40 text-red-400/70 hover:border-red-500/70 hover:text-red-400 hover:bg-red-500/5"
                }`}
              >
                {clearing
                  ? <><RefreshCw className="w-3 h-3 animate-spin" /> Clearing…</>
                  : <><Trash2 className="w-3 h-3" /> Clear DB</>
                }
              </button>
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
                  : <><Play className="w-3.5 h-3.5" /> Process Date</>
                }
              </button>
            </div>
          </div>
        </div>

        {/* ── Active job log ── */}
        <AnimatePresence>
          {activeJob && (
            <motion.div
              initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
              className="border border-border/40 bg-card/20"
            >
              <div className="border-b border-border/30 px-4 py-2 flex items-center justify-between">
                <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-muted-foreground">
                  <Zap className="w-3 h-3" />
                  <span>Tester Job — {activeJob.date}</span>
                  <span className={statusBadge(activeJob.status)}>{activeJob.status}</span>
                  {activeJob.totalMatches > 0 && (
                    <span className="text-primary/60">{activeJob.stored}/{activeJob.totalMatches} stored</span>
                  )}
                </div>
                <button
                  onClick={() => setActiveJob(null)}
                  className="text-muted-foreground hover:text-red-400 transition-colors text-[10px] font-mono uppercase tracking-widest"
                >Dismiss</button>
              </div>

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

              <div className="p-4">
                <div ref={logContainerRef} className="bg-black/40 border border-border/30 p-3 h-56 overflow-y-auto text-[10px] font-mono space-y-0.5">
                  {activeJob.logs.length === 0
                    ? <div className="text-center py-8 text-muted-foreground/30">Waiting for output…</div>
                    : activeJob.logs.map((line, i) => (
                      <div key={i} className={
                        line.includes("❌") || line.includes("⚠") ? "text-red-400/80"
                        : line.includes("✓") || line.includes("✅") ? "text-green-400/80"
                        : line.includes("🌐") || line.includes("🧪") ? "text-primary/70"
                        : "text-muted-foreground/70"
                      }>{line}</div>
                    ))
                  }
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Match list with expandable predictions ── */}
        <div className="border border-border/40 bg-card/20">
          <div className="border-b border-border/30 px-4 py-2 flex items-center justify-between">
            <div className="flex items-center gap-2 text-[10px] text-muted-foreground uppercase tracking-widest">
              <FlaskConical className="w-3 h-3" />
              <span>Matches for {fmtDisplay(selectedDate)}</span>
              {matches.length > 0 && (
                <span className="text-primary/60">{matches.length} stored</span>
              )}
            </div>
            {loadingMatches && <RefreshCw className="w-3 h-3 animate-spin text-muted-foreground/40" />}
          </div>

          {matches.length === 0 && !loadingMatches ? (
            <div className="p-10 text-center">
              <FlaskConical className="w-8 h-8 text-muted-foreground/20 mx-auto mb-3" />
              <div className="text-xs text-muted-foreground/40 uppercase tracking-widest">No matches</div>
              <div className="text-[10px] text-muted-foreground/30 mt-1">
                Select a date above and press "Process Date" to scrape stats + odds
              </div>
            </div>
          ) : (
            <div className="divide-y divide-border/10">
              {matches.map(m => <MatchRow key={m.id} match={m} onWizard={() => setWizardMatch(m)} />)}
            </div>
          )}
        </div>

      </div>

      {/* Futuristic Data Wizard Modal */}
      <AnimatePresence>
        {wizardMatch && (
          <WizardModal
            fetchUrl={`/api/tester/wizard/${wizardMatch.id}`}
            homeTeam={wizardMatch.homeTeam}
            awayTeam={wizardMatch.awayTeam}
            onClose={() => setWizardMatch(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
