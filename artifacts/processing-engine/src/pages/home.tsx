import React, { useState, useEffect, useMemo, useRef } from "react";
import { format, addDays, startOfDay, isSameDay } from "date-fns";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import {
  Activity, Clock, ShieldAlert,
  ChevronLeft, ChevronRight, CalendarDays, X,
} from "lucide-react";
import {
  useGetFixtures,
  getGetFixturesQueryKey,
  useHealthCheck,
} from "@workspace/api-client-react";

const TODAY = startOfDay(new Date());

const MONTHS = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December",
];
const DOW = ["Su","Mo","Tu","We","Th","Fr","Sa"];

// ─── Inline cyberpunk calendar ────────────────────────────────────────────────

interface CalendarPopupProps {
  selected: Date;
  onSelect: (d: Date) => void;
  onClose: () => void;
}

function CalendarPopup({ selected, onSelect, onClose }: CalendarPopupProps) {
  const [viewYear, setViewYear]   = useState(selected.getFullYear());
  const [viewMonth, setViewMonth] = useState(selected.getMonth());
  const overlayRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (overlayRef.current && !overlayRef.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  // Close on Escape
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

  // Build calendar grid
  const firstDow = new Date(viewYear, viewMonth, 1).getDay();
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
        {/* Title bar */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-primary/30 bg-primary/5">
          <span className="text-xs font-mono uppercase tracking-widest text-primary">Select Date</span>
          <button onClick={onClose} className="text-muted-foreground hover:text-primary transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 space-y-3">
          {/* Month / Year navigation */}
          <div className="flex items-center justify-between gap-2">
            <button
              onClick={prevMonth}
              className="w-8 h-8 flex items-center justify-center border border-border hover:border-primary/60 hover:text-primary text-muted-foreground transition-all"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>

            <div className="flex items-center gap-2 flex-1 justify-center">
              {/* Month select */}
              <select
                value={viewMonth}
                onChange={e => setViewMonth(Number(e.target.value))}
                className="bg-card border border-border text-foreground text-xs font-mono uppercase tracking-wide px-2 py-1 hover:border-primary/50 focus:outline-none focus:border-primary cursor-pointer"
              >
                {MONTHS.map((m, i) => (
                  <option key={i} value={i}>{m}</option>
                ))}
              </select>
              {/* Year select */}
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

          {/* Day-of-week headers */}
          <div className="grid grid-cols-7 gap-0.5">
            {DOW.map(d => (
              <div key={d} className="text-center text-[10px] font-mono text-muted-foreground py-1 uppercase tracking-widest">
                {d}
              </div>
            ))}
          </div>

          {/* Day cells */}
          <div className="grid grid-cols-7 gap-0.5">
            {cells.map(({ date, current }, i) => {
              const isSelected = isSameDay(date, selected);
              const isToday    = isSameDay(date, TODAY);
              const isFuture   = date > TODAY;

              return (
                <button
                  key={i}
                  onClick={() => { onSelect(date); onClose(); }}
                  className={`
                    h-9 flex items-center justify-center text-xs font-mono transition-all
                    ${!current ? "opacity-25" : ""}
                    ${isSelected
                      ? "bg-primary text-black font-bold shadow-[0_0_12px_rgba(0,255,255,0.5)]"
                      : isToday
                      ? "border border-primary/60 text-primary"
                      : isFuture
                      ? "text-foreground/70 hover:bg-primary/10 hover:text-primary"
                      : "text-muted-foreground hover:bg-white/5 hover:text-foreground"
                    }
                  `}
                >
                  {date.getDate()}
                </button>
              );
            })}
          </div>

          {/* Quick jumps */}
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

// ─── Main home page ───────────────────────────────────────────────────────────

export default function Home() {
  const [selectedDate, setSelectedDate] = useState<Date>(TODAY);
  const [windowOffset, setWindowOffset] = useState(0);
  const [showCalendar, setShowCalendar] = useState(false);
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

  // 7-day strip centered on windowOffset (days from TODAY)
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
  };

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
          </div>
        </div>
      </header>

      {/* ── Date navigation ── */}
      <div className="container mx-auto px-4 py-4">
        <div className="flex flex-col items-center gap-3">

          {/* Strip + controls row */}
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

            {/* Calendar picker button */}
            <button
              onClick={() => setShowCalendar(true)}
              className="flex-shrink-0 w-9 h-9 flex items-center justify-center border border-border text-muted-foreground hover:border-primary/60 hover:text-primary transition-all bg-card/30"
              aria-label="Open calendar"
              title="Pick any date"
            >
              <CalendarDays className="w-4 h-4" />
            </button>
          </div>

          {/* Jump to today / show selected date if off-strip */}
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
        </div>
      </div>

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

      {/* ── Main Content ── */}
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
        ) : !fixturesResponse?.leagues || fixturesResponse.leagues.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 border border-border bg-card/20 p-8 text-center">
            <Clock className="w-12 h-12 mb-4 text-muted-foreground opacity-50" />
            <h2 className="text-xl font-mono uppercase font-bold mb-2 text-muted-foreground">No Targets Acquired</h2>
            <p className="text-sm text-muted-foreground/70">No fixture data available for the selected date.</p>
          </div>
        ) : (
          <div className="space-y-8">
            <AnimatePresence>
              {fixturesResponse.leagues.map((league, leagueIdx) => (
                <motion.div
                  key={league.leagueId}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: leagueIdx * 0.05 }}
                  className="border border-border/50 bg-card/40 relative overflow-hidden"
                >
                  {/* League Header */}
                  <div className="border-b border-border/50 bg-card p-3 flex items-center gap-3">
                    {league.primaryColor && (
                      <div className="w-1 h-full absolute left-0 top-0" style={{ backgroundColor: league.primaryColor }} />
                    )}
                    <span className="text-xs ml-2 opacity-80 font-sans">{league.countryFlag}</span>
                    <h2 className="text-sm font-mono font-bold tracking-widest uppercase text-foreground/90">
                      {league.countryName} — {league.leagueName}
                    </h2>
                  </div>

                  {/* Fixtures */}
                  <div className="divide-y divide-border/30">
                    {league.fixtures.map(fixture => {
                      const isLive       = fixture.status === "inprogress";
                      const isFinished   = fixture.status === "finished";
                      const isPostponed  = fixture.status === "postponed";
                      const isCancelled  = fixture.status === "cancelled";
                      const homeWinner   = fixture.winnerCode === 100;
                      const awayWinner   = fixture.winnerCode === 200;

                      return (
                        <div
                          key={fixture.id}
                          onClick={() => navigate(`/fixture/${fixture.id}`)}
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
