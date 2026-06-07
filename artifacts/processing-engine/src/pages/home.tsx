import React, { useState, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { format, addDays, startOfDay, isSameDay } from "date-fns";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import {
  Activity, Clock, ShieldAlert,
  ChevronLeft, ChevronRight, CalendarDays, X, Search,
  Upload, Database as DatabaseIcon, Loader2,
} from "lucide-react";
import {
  useGetFixtures,
  getGetFixturesQueryKey,
  useHealthCheck,
} from "@workspace/api-client-react";

const TODAY = startOfDay(new Date());
const SESSION_KEY = "nexus_home_state";

const MONTHS = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December",
];
const DOW = ["Su","Mo","Tu","We","Th","Fr","Sa"];

// ─── Inline cyberpunk calendar ─────────────────────────────────────────────

interface CalendarPopupProps {
  selected: Date;
  onSelect: (d: Date) => void;
  onClose: () => void;
}

function CalendarPopup({ selected, onSelect, onClose }: CalendarPopupProps) {
  const [viewYear, setViewYear]   = useState(selected.getFullYear());
  const [viewMonth, setViewMonth] = useState(selected.getMonth());
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (overlayRef.current && !overlayRef.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  const prevMonth = () => {
    if (viewMonth === 0) { setViewMonth(11); setViewYear(y => y - 1); }
    else setViewMonth(m => m - 1);
  };
  const nextMonth = () => {
    if (viewMonth === 11) { setViewMonth(0); setViewYear(y => y + 1); }
    else setViewMonth(m => m + 1);
  };

  const firstDow    = new Date(viewYear, viewMonth, 1).getDay();
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const daysInPrev  = new Date(viewYear, viewMonth, 0).getDate();

  const cells: { date: Date; current: boolean }[] = [];
  for (let i = firstDow - 1; i >= 0; i--)
    cells.push({ date: new Date(viewYear, viewMonth - 1, daysInPrev - i), current: false });
  for (let d = 1; d <= daysInMonth; d++)
    cells.push({ date: new Date(viewYear, viewMonth, d), current: true });
  while (cells.length % 7 !== 0)
    cells.push({ date: new Date(viewYear, viewMonth + 1, cells.length - daysInMonth - firstDow + 1), current: false });

  const years = Array.from({ length: 11 }, (_, i) => TODAY.getFullYear() - 5 + i);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div
        ref={overlayRef}
        className="bg-[#0a0f1a] border border-primary/50 shadow-[0_0_40px_rgba(0,255,255,0.15)] w-full max-w-sm"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-primary/30 bg-primary/5">
          <span className="text-xs font-mono uppercase tracking-widest text-primary">Select Date</span>
          <button onClick={onClose} className="text-muted-foreground hover:text-primary transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <button
              onClick={prevMonth}
              className="w-8 h-8 flex items-center justify-center border border-border hover:border-primary/60 hover:text-primary text-muted-foreground transition-all"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <div className="flex items-center gap-2 flex-1 justify-center">
              <select
                value={viewMonth}
                onChange={e => setViewMonth(Number(e.target.value))}
                className="bg-card border border-border text-foreground text-xs font-mono uppercase tracking-wide px-2 py-1 hover:border-primary/50 focus:outline-none focus:border-primary cursor-pointer"
              >
                {MONTHS.map((m, i) => <option key={i} value={i}>{m}</option>)}
              </select>
              <select
                value={viewYear}
                onChange={e => setViewYear(Number(e.target.value))}
                className="bg-card border border-border text-foreground text-xs font-mono px-2 py-1 hover:border-primary/50 focus:outline-none focus:border-primary cursor-pointer w-20"
              >
                {years.map(y => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
            <button
              onClick={nextMonth}
              className="w-8 h-8 flex items-center justify-center border border-border hover:border-primary/60 hover:text-primary text-muted-foreground transition-all"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          <div className="grid grid-cols-7 gap-0.5">
            {DOW.map(d => (
              <div key={d} className="text-center text-[10px] font-mono text-muted-foreground py-1 uppercase tracking-widest">
                {d}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-0.5">
            {cells.map(({ date, current }, i) => {
              const isSelected = isSameDay(date, selected);
              const isToday    = isSameDay(date, TODAY);
              const isFuture   = date > TODAY;
              return (
                <button
                  key={i}
                  onClick={() => { onSelect(date); onClose(); }}
                  className={`h-9 flex items-center justify-center text-xs font-mono transition-all
                    ${!current ? "opacity-25" : ""}
                    ${isSelected
                      ? "bg-primary text-black font-bold shadow-[0_0_12px_rgba(0,255,255,0.5)]"
                      : isToday
                      ? "border border-primary/60 text-primary"
                      : isFuture
                      ? "text-foreground/70 hover:bg-primary/10 hover:text-primary"
                      : "text-muted-foreground hover:bg-white/5 hover:text-foreground"
                    }`}
                >
                  {date.getDate()}
                </button>
              );
            })}
          </div>

          <div className="flex gap-2 pt-1 border-t border-border/40">
            {[
              { label: "Yesterday", date: addDays(TODAY, -1) },
              { label: "Today",     date: TODAY },
              { label: "Tomorrow",  date: addDays(TODAY, 1) },
            ].map(({ label, date }) => (
              <button
                key={label}
                onClick={() => { onSelect(date); onClose(); }}
                className={`flex-1 py-1.5 text-[10px] font-mono uppercase tracking-widest border transition-all ${
                  isSameDay(date, selected)
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border text-muted-foreground hover:border-primary/50 hover:text-foreground"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Slug helper ────────────────────────────────────────────────────────────

function toSlug(s: string) {
  return s.toLowerCase().replace(/[^\w\s-]/g, "").replace(/[\s_]+/g, "-").replace(/^-+|-+$/g, "");
}

// ─── Bulk Upload Modal ───────────────────────────────────────────────────────

interface JobStatus {
  id: string;
  status: "pending" | "running" | "complete" | "failed";
  totalMatches: number;
  processed: number;
  stored: number;
  skipped: number;
  currentMatch: string | null;
  errorMessage: string | null;
  logs: string[];
}

interface UploadModalProps {
  leagueName: string;
  countryName: string;
  suggestedPath: string;
  onClose: () => void;
}

const CURRENT_SEASON_VALUE = 9999; // sentinel — triggers no-year-suffix URL

function BulkUploadModal({ leagueName, countryName, suggestedPath, onClose }: UploadModalProps) {
  const currentYear = new Date().getFullYear();
  const years = Array.from({ length: 8 }, (_, i) => currentYear - i);

  const [path, setPath]   = useState(suggestedPath);
  const [year, setYear]   = useState(currentYear - 1);
  const [jobId, setJobId] = useState<string | null>(null);
  const [job, setJob]     = useState<JobStatus | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const logsEndRef = React.useRef<HTMLDivElement>(null);

  const isDone = job?.status === "complete" || job?.status === "failed";

  useEffect(() => {
    if (!jobId) return;
    const poll = async () => {
      try {
        const r = await fetch(`/api/bulk/status/${jobId}`);
        if (r.ok) setJob(await r.json());
      } catch {}
    };
    poll();
    const id = setInterval(poll, 2500);
    return () => clearInterval(id);
  }, [jobId]);

  useEffect(() => {
    if (isDone) return;
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [job?.logs?.length, isDone]);

  const start = async () => {
    if (!path.trim()) { setError("OddsPortal path is required"); return; }
    setError(null);
    setStarting(true);
    try {
      const effectiveYear = year === CURRENT_SEASON_VALUE ? currentYear : year;
      const r = await fetch("/api/bulk/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leagueName, countryName, oddsPortalPath: path.trim(), year: effectiveYear }),
      });
      if (!r.ok) {
        let errMsg = `HTTP ${r.status}`;
        try {
          const ct = r.headers.get("content-type") ?? "";
          if (ct.includes("json")) {
            const j = await r.json() as { error?: string };
            errMsg = j.error ?? errMsg;
          } else {
            errMsg = `API server error (${r.status}) — check that the server is running`;
          }
        } catch {}
        throw new Error(errMsg);
      }
      const d = await r.json() as { jobId: string };
      setJobId(d.jobId);
    } catch (e) {
      setError(String(e));
    } finally {
      setStarting(false);
    }
  };

  const pct = job && job.totalMatches > 0
    ? Math.round((job.processed / job.totalMatches) * 100)
    : 0;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="bg-[#0a0f1a] border border-primary/50 shadow-[0_0_40px_rgba(0,255,255,0.15)] w-full max-w-lg"
      >
        {/* Header */}
        <div className="border-b border-border/50 p-4 flex items-center justify-between">
          <div>
            <div className="text-sm font-mono font-bold text-primary tracking-widest uppercase flex items-center gap-2">
              <Upload className="w-4 h-4" /> Bulk Upload
            </div>
            <div className="text-[11px] text-muted-foreground font-mono mt-0.5">
              {countryName} — {leagueName}
            </div>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          {!jobId ? (
            <>
              {/* OddsPortal path */}
              <div>
                <label className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground block mb-1.5">
                  OddsPortal Path
                  <span className="ml-1 text-muted-foreground/50">(country/league-slug)</span>
                </label>
                <input
                  type="text"
                  value={path}
                  onChange={e => setPath(e.target.value)}
                  placeholder="e.g. england/premier-league"
                  className="w-full bg-card/30 border border-border text-foreground text-xs font-mono px-3 py-2 placeholder:text-muted-foreground/40 focus:outline-none focus:border-primary/60 transition-all"
                />
                {(() => {
                  const slug = path.split("/")[1] || "league";
                  const isCurrentSeason = year === CURRENT_SEASON_VALUE;
                  const yr = currentYear;
                  // Warn if the slug looks like it has unstripped accents or spaces
                  const slugWarning = /[^a-z0-9\-\/]/.test(path) && path.length > 0;
                  return (
                    <div className="text-[10px] font-mono mt-1 space-y-0.5">
                      {slugWarning && (
                        <div className="text-yellow-400/80">⚠ Slug must be lowercase a-z, 0-9, hyphens only (copy from OddsPortal URL bar)</div>
                      )}
                      {isCurrentSeason ? (
                        <>
                          <div className="text-muted-foreground/50">oddsportal.com/football/<span className="text-primary/60">{path || "country/league"}</span>/results/ <span className="text-yellow-500/60">(tried first)</span></div>
                          <div className="text-muted-foreground/30">↳ fallback: …<span className="text-primary/40">{slug}</span>-{yr}/results/</div>
                          <div className="text-muted-foreground/30">↳ fallback: …<span className="text-primary/40">{slug}</span>-{yr - 1}-{yr}/results/</div>
                        </>
                      ) : (
                        <>
                          <div className="text-muted-foreground/50">oddsportal.com/football/<span className="text-primary/60">{path || "country/league"}</span>-{year}/results/</div>
                          <div className="text-muted-foreground/30">↳ fallback: …<span className="text-primary/40">{slug}</span>-{year - 1}-{year}/results/</div>
                          <div className="text-muted-foreground/30">↳ fallback: …<span className="text-primary/40">{slug}</span>/results/</div>
                        </>
                      )}
                    </div>
                  );
                })()}
              </div>

              {/* Year */}
              <div>
                <label className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground block mb-1.5">
                  Year
                  <span className="ml-1 text-muted-foreground/40">(use Current Season for tournaments / ongoing leagues)</span>
                </label>
                <select
                  value={year}
                  onChange={e => setYear(parseInt(e.target.value))}
                  className="w-full bg-card/30 border border-border text-foreground text-xs font-mono px-3 py-2 focus:outline-none focus:border-primary/60 transition-all"
                >
                  <option value={CURRENT_SEASON_VALUE}>Current Season (no year suffix)</option>
                  {years.map(y => <option key={y} value={y}>{y}</option>)}
                </select>
              </div>

              {error && (
                <div className="text-xs text-destructive font-mono border border-destructive/30 bg-destructive/5 px-3 py-2">
                  {error}
                </div>
              )}

              <div className="flex items-center gap-2 text-[10px] text-muted-foreground/60 font-mono border border-border/30 bg-card/20 px-3 py-2">
                <span className="text-primary/60">ℹ</span>
                Scrapes OddsPortal results + StatsHub stats. Skips teams with {"<"}20 historical matches.
              </div>

              <button
                onClick={start}
                disabled={starting || !path.trim()}
                className="w-full py-2.5 font-mono text-xs uppercase tracking-widest border border-primary text-primary hover:bg-primary/10 transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {starting ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Starting…</> : "⬆ Start Upload"}
              </button>
            </>
          ) : (
            <>
              {/* Progress */}
              <div className="space-y-3">
                <div className="flex items-center justify-between text-xs font-mono">
                  <span className={
                    job?.status === "complete" ? "text-green-400" :
                    job?.status === "failed"   ? "text-destructive" :
                    "text-primary animate-pulse"
                  }>
                    {job?.status?.toUpperCase() ?? "STARTING…"}
                  </span>
                  <span className="text-muted-foreground">
                    {job ? `${job.stored} stored · ${job.skipped} skipped` : ""}
                  </span>
                </div>

                {job && job.totalMatches > 0 && (
                  <div>
                    <div className="flex justify-between text-[10px] font-mono text-muted-foreground mb-1">
                      <span>{job.processed} / {job.totalMatches} processed</span>
                      <span>{pct}%</span>
                    </div>
                    <div className="h-1.5 w-full bg-border/40 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-primary transition-all duration-500 shadow-[0_0_6px_rgba(0,255,255,0.5)]"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                )}

                {job?.currentMatch && !isDone && (
                  <div className="text-[10px] font-mono text-primary/70 truncate">⬡ {job.currentMatch}</div>
                )}

                {job?.errorMessage && (
                  <div className="text-[10px] font-mono text-destructive border border-destructive/30 bg-destructive/5 px-2 py-1.5">
                    {job.errorMessage}
                  </div>
                )}

                {/* Log */}
                <div className="h-48 overflow-y-auto bg-black/40 border border-border/30 p-2 font-mono text-[10px] text-muted-foreground space-y-0.5">
                  {(!job?.logs || job.logs.length === 0)
                    ? <div className="text-center py-8 opacity-40">Waiting for log output…</div>
                    : job.logs.map((line, i) => (
                      <div key={i} className={
                        line.includes("✓") ? "text-green-400/80" :
                        line.includes("⚠") ? "text-yellow-400/80" :
                        line.includes("❌") || line.includes("Skip") ? "text-destructive/70" :
                        line.includes("✅") ? "text-green-400" :
                        "text-muted-foreground/70"
                      }>{line}</div>
                    ))
                  }
                  <div ref={logsEndRef} />
                </div>

                {isDone && (
                  <div className="flex gap-2">
                    <button
                      onClick={onClose}
                      className="flex-1 py-2 font-mono text-xs uppercase tracking-widest border border-border text-muted-foreground hover:border-primary/50 hover:text-foreground transition-all"
                    >
                      Close
                    </button>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </motion.div>
    </div>
  );
}

// ─── Main home page ────────────────────────────────────────────────────────

export default function Home() {
  // Restore state from sessionStorage if coming back from a fixture
  const restoredRef = useRef<{ date: string; scrollY: number } | null>(null);
  if (restoredRef.current === null) {
    try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      if (raw) {
        restoredRef.current = JSON.parse(raw);
        sessionStorage.removeItem(SESSION_KEY);
      }
    } catch { /* ignore */ }
  }

  const restored = restoredRef.current;
  const initialDate = restored
    ? startOfDay(new Date(restored.date))
    : TODAY;
  const initialOffset = restored
    ? Math.round((initialDate.getTime() - TODAY.getTime()) / 86400000)
    : 0;

  const [selectedDate, setSelectedDate] = useState<Date>(initialDate);
  const [windowOffset, setWindowOffset] = useState(initialOffset);
  const [showCalendar, setShowCalendar] = useState(false);
  const [searchQuery, setSearchQuery]   = useState("");
  const [uploadModal, setUploadModal]   = useState<{
    leagueName: string; countryName: string; suggestedPath: string;
  } | null>(null);
  const [pendingScrollY, setPendingScrollY] = useState<number | null>(
    restored ? restored.scrollY : null
  );

  const queryClient = useQueryClient();
  const formattedDate = format(selectedDate, "yyyy-MM-dd");
  const [, navigate] = useLocation();

  const { data: fixturesResponse, isLoading, isError } = useGetFixtures(
    { date: formattedDate },
    { query: { enabled: true, queryKey: getGetFixturesQueryKey({ date: formattedDate }) } }
  );

  const { data: health } = useHealthCheck();

  // Auto-refresh every 30 s
  useEffect(() => {
    const interval = setInterval(() => {
      queryClient.invalidateQueries({ queryKey: getGetFixturesQueryKey({ date: formattedDate }) });
    }, 30000);
    return () => clearInterval(interval);
  }, [formattedDate, queryClient]);

  // Scroll restoration: after data loads, jump to the saved Y position
  useLayoutEffect(() => {
    if (!isLoading && pendingScrollY !== null) {
      window.scrollTo({ top: pendingScrollY, behavior: "instant" });
      setPendingScrollY(null);
    }
  }, [isLoading, pendingScrollY]);

  // 7-day strip
  const dates = useMemo(() => {
    const arr: Date[] = [];
    for (let i = windowOffset - 3; i <= windowOffset + 3; i++) arr.push(addDays(TODAY, i));
    return arr;
  }, [windowOffset]);

  const handleDateSelect = (date: Date) => {
    const d = startOfDay(date);
    setSelectedDate(d);
    const diff = Math.round((d.getTime() - TODAY.getTime()) / 86400000);
    setWindowOffset(diff);
    setSearchQuery("");
  };

  // Navigate to fixture, persisting current date + scroll so we can come back
  const handleFixtureClick = (fixtureId: number) => {
    try {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify({
        date: formattedDate,
        scrollY: window.scrollY,
      }));
    } catch { /* ignore */ }
    navigate(`/fixture/${fixtureId}`);
  };

  // Filter leagues / fixtures by search query
  const filteredLeagues = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q || !fixturesResponse?.leagues) return fixturesResponse?.leagues ?? [];
    return fixturesResponse.leagues
      .map(league => ({
        ...league,
        fixtures: league.fixtures.filter(
          f =>
            f.homeTeam.name.toLowerCase().includes(q) ||
            f.awayTeam.name.toLowerCase().includes(q)
        ),
      }))
      .filter(league => league.fixtures.length > 0);
  }, [fixturesResponse?.leagues, searchQuery]);

  const diffFromToday = Math.round((startOfDay(selectedDate).getTime() - TODAY.getTime()) / 86400000);
  const isOnStrip = diffFromToday >= windowOffset - 3 && diffFromToday <= windowOffset + 3;

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col font-sans overflow-x-hidden selection:bg-primary selection:text-primary-foreground dark">

      {/* ── Header ── */}
      <header className="border-b border-border/50 bg-card/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Activity className="w-6 h-6 text-primary" />
            <h1 className="text-2xl font-bold tracking-widest uppercase text-primary drop-shadow-[0_0_8px_rgba(0,255,255,0.5)]">
              Nexus Fixtures
            </h1>
          </div>
          <div className="flex items-center gap-4 text-xs font-mono">
            <div className="hidden sm:flex items-center gap-2">
              <span className="text-muted-foreground uppercase">System:</span>
              <span className="text-green-400 uppercase tracking-widest">{health?.status || "ONLINE"}</span>
            </div>
            <div className="w-px h-4 bg-border hidden sm:block" />
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground uppercase">Target:</span>
              <span className="text-primary">{formattedDate}</span>
            </div>
            <div className="w-px h-4 bg-border hidden sm:block" />
            <button
              onClick={() => navigate("/database")}
              className="hidden sm:flex items-center gap-1.5 text-muted-foreground hover:text-primary transition-colors uppercase tracking-widest"
              title="View stored match database"
            >
              <DatabaseIcon className="w-3.5 h-3.5" />
              <span>DB</span>
            </button>
            <div className="w-px h-4 bg-border hidden sm:block" />
            <button
              onClick={() => navigate("/processing")}
              className="hidden sm:flex items-center gap-1.5 text-muted-foreground hover:text-primary transition-colors uppercase tracking-widest"
              title="Processing engine"
            >
              <Activity className="w-3.5 h-3.5" />
              <span>Processing</span>
            </button>
          </div>
        </div>
      </header>

      {/* ── Date navigation ── */}
      <div className="container mx-auto px-4 py-4">
        <div className="flex flex-col items-center gap-3">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setWindowOffset(o => o - 7)}
              className="flex-shrink-0 w-9 h-9 flex items-center justify-center border border-border text-muted-foreground hover:border-primary/60 hover:text-primary transition-all bg-card/30"
              aria-label="Previous 7 days"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>

            <div className="flex items-center gap-1 sm:gap-2 overflow-x-auto" style={{ scrollbarWidth: "none" }}>
              {dates.map(date => {
                const isSelected = isSameDay(date, selectedDate);
                const isToday    = isSameDay(date, TODAY);
                return (
                  <button
                    key={date.toISOString()}
                    onClick={() => handleDateSelect(date)}
                    className={`flex flex-col items-center justify-center min-w-[56px] sm:min-w-[68px] p-2 border transition-all duration-200 font-mono text-sm uppercase flex-shrink-0 ${
                      isSelected
                        ? "border-primary bg-primary/10 text-primary shadow-[0_0_12px_rgba(0,255,255,0.2)]"
                        : isToday
                        ? "border-primary/40 text-primary/70 bg-card/30 hover:border-primary/60 hover:text-primary"
                        : "border-border text-muted-foreground hover:border-primary/50 hover:text-foreground bg-card/30"
                    }`}
                  >
                    <span className="text-[9px] mb-0.5 opacity-70 tracking-widest">
                      {isToday ? "TODAY" : format(date, "EEE").toUpperCase()}
                    </span>
                    <span className={`text-base font-bold ${isSelected ? "text-primary" : "text-foreground"}`}>
                      {format(date, "dd")}
                    </span>
                    <span className="text-[9px] mt-0.5 opacity-70">
                      {format(date, "MMM").toUpperCase()}
                    </span>
                  </button>
                );
              })}
            </div>

            <button
              onClick={() => setWindowOffset(o => o + 7)}
              className="flex-shrink-0 w-9 h-9 flex items-center justify-center border border-border text-muted-foreground hover:border-primary/60 hover:text-primary transition-all bg-card/30"
              aria-label="Next 7 days"
            >
              <ChevronRight className="w-4 h-4" />
            </button>

            <button
              onClick={() => setShowCalendar(true)}
              className="flex-shrink-0 w-9 h-9 flex items-center justify-center border border-border text-muted-foreground hover:border-primary/60 hover:text-primary transition-all bg-card/30"
              aria-label="Open calendar"
              title="Pick any date"
            >
              <CalendarDays className="w-4 h-4" />
            </button>
          </div>

          <div className="flex items-center gap-3">
            {windowOffset !== 0 && (
              <button
                onClick={() => { setWindowOffset(0); handleDateSelect(TODAY); }}
                className="text-[10px] font-mono uppercase tracking-widest text-primary/60 hover:text-primary border border-primary/20 hover:border-primary/50 px-3 py-1 transition-all"
              >
                Jump to Today
              </button>
            )}
            {!isOnStrip && (
              <div className="text-[10px] font-mono text-primary/70 border border-primary/20 px-3 py-1">
                Viewing: {format(selectedDate, "EEE dd MMM yyyy")}
              </div>
            )}
          </div>

          {/* ── Search bar ── */}
          <div className="w-full max-w-md relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
            <input
              type="text"
              placeholder="Filter by team name..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full bg-card/30 border border-border text-foreground text-xs font-mono pl-8 pr-8 py-2 placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary/60 focus:bg-card/50 transition-all"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-primary transition-colors"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ── Bulk upload modal ── */}
      <AnimatePresence>
        {uploadModal && (
          <motion.div
            key="upload-modal"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
          >
            <BulkUploadModal
              leagueName={uploadModal.leagueName}
              countryName={uploadModal.countryName}
              suggestedPath={uploadModal.suggestedPath}
              onClose={() => setUploadModal(null)}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Calendar popup ── */}
      <AnimatePresence>
        {showCalendar && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
          >
            <CalendarPopup
              selected={selectedDate}
              onSelect={handleDateSelect}
              onClose={() => setShowCalendar(false)}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Main content ── */}
      <main className="container mx-auto px-4 pb-20 flex-1">
        {isLoading ? (
          <div className="space-y-6">
            {[1, 2, 3].map(i => (
              <div key={i} className="border border-border p-4 bg-card/30 animate-pulse">
                <div className="h-6 w-1/3 bg-muted mb-4" />
                <div className="space-y-2">
                  <div className="h-16 w-full bg-muted/50 border border-border/50" />
                  <div className="h-16 w-full bg-muted/50 border border-border/50" />
                </div>
              </div>
            ))}
          </div>
        ) : isError ? (
          <div className="flex flex-col items-center justify-center h-64 border border-destructive/50 bg-destructive/5 text-destructive p-8 text-center">
            <ShieldAlert className="w-12 h-12 mb-4 opacity-80" />
            <h2 className="text-xl font-mono uppercase font-bold mb-2">System Error</h2>
            <p className="text-sm opacity-80">Failed to retrieve fixture data stream. Connection terminated.</p>
          </div>
        ) : filteredLeagues.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 border border-border bg-card/20 p-8 text-center">
            <Clock className="w-12 h-12 mb-4 text-muted-foreground opacity-50" />
            <h2 className="text-xl font-mono uppercase font-bold mb-2 text-muted-foreground">
              {searchQuery ? "No Matches Found" : "No Targets Acquired"}
            </h2>
            <p className="text-sm text-muted-foreground/70">
              {searchQuery
                ? `No fixtures match "${searchQuery}" on this date.`
                : "No fixture data available for the selected date."}
            </p>
          </div>
        ) : (
          <div className="space-y-8">
            <AnimatePresence>
              {filteredLeagues.map((league, leagueIdx) => (
                <motion.div
                  key={league.leagueId}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: leagueIdx * 0.04 }}
                  className="border border-border/50 bg-card/40 relative overflow-hidden"
                >
                  {/* League header */}
                  <div className="border-b border-border/50 bg-card p-3 flex items-center gap-3">
                    {league.primaryColor && (
                      <div className="w-1 h-full absolute left-0 top-0" style={{ backgroundColor: league.primaryColor }} />
                    )}
                    <span className="text-xs ml-2 opacity-80 font-sans">{league.countryFlag}</span>
                    <h2 className="text-sm font-mono font-bold tracking-widest uppercase text-foreground/90 flex-1">
                      {league.countryName} — {league.leagueName}
                    </h2>
                    <button
                      onClick={e => {
                        e.stopPropagation();
                        setUploadModal({
                          leagueName: league.leagueName,
                          countryName: league.countryName,
                          suggestedPath: `${toSlug(league.countryName)}/${toSlug(league.leagueName)}`,
                        });
                      }}
                      className="flex-shrink-0 flex items-center gap-1 text-[10px] font-mono uppercase tracking-widest text-muted-foreground/60 hover:text-primary border border-border/40 hover:border-primary/50 px-2 py-1 transition-all"
                      title="Bulk upload historical data for this league"
                    >
                      <Upload className="w-3 h-3" />
                      Upload
                    </button>
                  </div>

                  {/* Fixtures */}
                  <div className="divide-y divide-border/30">
                    {league.fixtures.map(fixture => {
                      const isLive      = fixture.status === "inprogress";
                      const isFinished  = fixture.status === "finished";
                      const isPostponed = fixture.status === "postponed";
                      const isCancelled = fixture.status === "cancelled";
                      const homeWinner  = fixture.winnerCode === 100;
                      const awayWinner  = fixture.winnerCode === 200;

                      return (
                        <div
                          key={fixture.id}
                          onClick={() => handleFixtureClick(fixture.id)}
                          className={`p-4 flex items-center justify-between transition-colors hover:bg-white/[0.03] cursor-pointer ${
                            isFinished || isPostponed || isCancelled ? "opacity-60" : ""
                          } ${isLive ? "bg-primary/5" : ""}`}
                        >
                          {/* Home */}
                          <div className={`flex-1 flex items-center justify-end gap-3 text-right ${homeWinner ? "font-bold text-foreground" : awayWinner ? "text-muted-foreground" : "text-foreground/90"}`}>
                            <span className="text-sm md:text-base uppercase tracking-wide truncate max-w-[100px] sm:max-w-[140px] md:max-w-none">
                              {fixture.homeTeam.name}
                            </span>
                            <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: fixture.homeTeam.colorPrimary || "#555" }} />
                          </div>

                          {/* Score / Time */}
                          <div className="w-24 md:w-32 flex-shrink-0 flex flex-col items-center justify-center font-mono">
                            {isLive ? (
                              <>
                                <div className="text-xl md:text-2xl font-bold text-green-400 drop-shadow-[0_0_8px_rgba(34,197,94,0.6)]">
                                  {fixture.homeScore ?? 0} - {fixture.awayScore ?? 0}
                                </div>
                                <div className="flex items-center gap-1 mt-1 text-[10px] text-green-400 font-bold uppercase tracking-widest">
                                  <div className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse" />
                                  LIVE
                                </div>
                              </>
                            ) : isFinished ? (
                              <>
                                <div className="text-xl md:text-2xl font-bold text-foreground">
                                  {fixture.homeScore ?? 0} - {fixture.awayScore ?? 0}
                                </div>
                                <div className="text-[10px] text-muted-foreground mt-1 uppercase tracking-widest">FT</div>
                              </>
                            ) : isPostponed ? (
                              <div className="text-[10px] text-destructive uppercase tracking-widest border border-destructive/50 px-2 py-0.5">POSTPONED</div>
                            ) : isCancelled ? (
                              <div className="text-[10px] text-destructive uppercase tracking-widest border border-destructive/50 px-2 py-0.5">CANCELLED</div>
                            ) : (
                              <>
                                <div className="text-lg md:text-xl font-medium text-primary/80">
                                  {format(new Date(fixture.kickoffTimestamp * 1000), "HH:mm")}
                                </div>
                                <div className="text-[10px] text-muted-foreground mt-1 uppercase tracking-widest">UPCOMING</div>
                              </>
                            )}
                          </div>

                          {/* Away */}
                          <div className={`flex-1 flex items-center justify-start gap-3 ${awayWinner ? "font-bold text-foreground" : homeWinner ? "text-muted-foreground" : "text-foreground/90"}`}>
                            <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: fixture.awayTeam.colorPrimary || "#555" }} />
                            <span className="text-sm md:text-base uppercase tracking-wide truncate max-w-[100px] sm:max-w-[140px] md:max-w-none">
                              {fixture.awayTeam.name}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}
      </main>
    </div>
  );
}
