import React, { useState, useEffect, useMemo } from "react";
import { format, addDays, startOfDay } from "date-fns";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import { Activity, Clock, ShieldAlert, ChevronLeft, ChevronRight, ChevronRight as ArrowRight } from "lucide-react";
import { 
  useGetFixtures, 
  getGetFixturesQueryKey,
  useHealthCheck 
} from "@workspace/api-client-react";

const TODAY = startOfDay(new Date());

export default function Home() {
  const [selectedDate, setSelectedDate] = useState<Date>(TODAY);
  const [windowOffset, setWindowOffset] = useState(0);
  const queryClient = useQueryClient();

  const formattedDate = format(selectedDate, "yyyy-MM-dd");

  const [, navigate] = useLocation();

  const { data: fixturesResponse, isLoading, isError } = useGetFixtures(
    { date: formattedDate },
    { query: { enabled: true, queryKey: getGetFixturesQueryKey({ date: formattedDate }) } }
  );

  const { data: health } = useHealthCheck();

  // Auto-refresh every 30s
  useEffect(() => {
    const interval = setInterval(() => {
      queryClient.invalidateQueries({ queryKey: getGetFixturesQueryKey({ date: formattedDate }) });
    }, 30000);
    return () => clearInterval(interval);
  }, [formattedDate, queryClient]);

  // Date strip: 7 days centered on the window offset
  const dates = useMemo(() => {
    const center = windowOffset;
    const arr = [];
    for (let i = center - 3; i <= center + 3; i++) {
      arr.push(addDays(TODAY, i));
    }
    return arr;
  }, [windowOffset]);

  // When selected date is outside visible window, re-center
  const handleDateSelect = (date: Date) => {
    setSelectedDate(date);
    const diff = Math.round((startOfDay(date).getTime() - TODAY.getTime()) / 86400000);
    if (diff < windowOffset - 3 || diff > windowOffset + 3) {
      setWindowOffset(diff);
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col font-sans overflow-x-hidden selection:bg-primary selection:text-primary-foreground dark">
      {/* Header */}
      <header className="border-b border-border/50 bg-card/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Activity className="w-6 h-6 text-primary" />
            <h1 className="text-2xl font-bold tracking-widest uppercase text-primary drop-shadow-[0_0_8px_rgba(0,255,255,0.5)]">
              Nexus Fixtures
            </h1>
          </div>
          <div className="flex items-center gap-4 text-xs font-mono">
            <div className="flex items-center gap-2 hidden sm:flex">
              <span className="text-muted-foreground uppercase">System:</span>
              <span className="text-green-400 uppercase tracking-widest">{health?.status || "ONLINE"}</span>
            </div>
            <div className="w-px h-4 bg-border hidden sm:block"></div>
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground uppercase">Target:</span>
              <span className="text-primary">{formattedDate}</span>
            </div>
          </div>
        </div>
      </header>

      {/* Date Navigation */}
      <div className="container mx-auto px-4 py-6">
        <div className="flex items-center justify-center gap-2">
          {/* Prev week */}
          <button
            data-testid="btn-date-prev"
            onClick={() => setWindowOffset(o => o - 7)}
            className="flex-shrink-0 w-9 h-9 flex items-center justify-center border border-border text-muted-foreground hover:border-primary/60 hover:text-primary transition-all duration-200 bg-card/30 cursor-pointer"
            aria-label="Previous week"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>

          {/* Date buttons */}
          <div className="flex items-center gap-2 sm:gap-3">
            {dates.map((date) => {
              const isSelected = format(date, "yyyy-MM-dd") === formattedDate;
              const isToday = format(date, "yyyy-MM-dd") === format(TODAY, "yyyy-MM-dd");
              return (
                <button
                  key={date.toISOString()}
                  data-testid={`btn-date-${format(date, "yyyy-MM-dd")}`}
                  onClick={() => handleDateSelect(date)}
                  className={`flex flex-col items-center justify-center min-w-[60px] sm:min-w-[72px] p-2 border transition-all duration-300 font-mono text-sm uppercase flex-shrink-0 cursor-pointer ${
                    isSelected
                      ? "border-primary bg-primary/10 text-primary shadow-[0_0_15px_rgba(0,255,255,0.2)]"
                      : isToday
                      ? "border-primary/40 text-primary/70 bg-card/30 hover:border-primary/60 hover:text-primary"
                      : "border-border text-muted-foreground hover:border-primary/50 hover:text-foreground bg-card/30"
                  }`}
                >
                  <span className="text-[10px] mb-1 opacity-70">
                    {isToday ? "TODAY" : format(date, "EEE")}
                  </span>
                  <span className={`text-lg font-bold ${isSelected ? "text-primary" : "text-foreground"}`}>
                    {format(date, "dd")}
                  </span>
                  <span className="text-[10px] mt-1 opacity-70">
                    {format(date, "MMM")}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Next week */}
          <button
            data-testid="btn-date-next"
            onClick={() => setWindowOffset(o => o + 7)}
            className="flex-shrink-0 w-9 h-9 flex items-center justify-center border border-border text-muted-foreground hover:border-primary/60 hover:text-primary transition-all duration-200 bg-card/30 cursor-pointer"
            aria-label="Next week"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>

        {/* Jump to today if off-screen */}
        {windowOffset !== 0 && (
          <div className="flex justify-center mt-3">
            <button
              data-testid="btn-date-today"
              onClick={() => { setWindowOffset(0); handleDateSelect(TODAY); }}
              className="text-[10px] font-mono uppercase tracking-widest text-primary/60 hover:text-primary border border-primary/20 hover:border-primary/50 px-3 py-1 transition-all duration-200 cursor-pointer"
            >
              Jump to Today
            </button>
          </div>
        )}
      </div>

      {/* Main Content */}
      <main className="container mx-auto px-4 pb-20 flex-1">
        {isLoading ? (
          <div className="space-y-6">
            {[1, 2, 3].map(i => (
              <div key={i} className="border border-border p-4 bg-card/30 animate-pulse">
                <div className="h-6 w-1/3 bg-muted mb-4"></div>
                <div className="space-y-2">
                  <div className="h-16 w-full bg-muted/50 border border-border/50"></div>
                  <div className="h-16 w-full bg-muted/50 border border-border/50"></div>
                </div>
              </div>
            ))}
          </div>
        ) : isError ? (
          <div className="flex flex-col items-center justify-center h-64 border border-destructive/50 bg-destructive/5 text-destructive p-8 text-center neon-border border-destructive">
            <ShieldAlert className="w-12 h-12 mb-4 opacity-80" />
            <h2 className="text-xl font-mono uppercase font-bold mb-2">System Error</h2>
            <p className="text-sm opacity-80">Failed to retrieve fixture data stream. Connection terminated.</p>
          </div>
        ) : !fixturesResponse?.leagues || fixturesResponse.leagues.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 border border-border bg-card/20 p-8 text-center">
            <Clock className="w-12 h-12 mb-4 text-muted-foreground opacity-50" />
            <h2 className="text-xl font-mono uppercase font-bold mb-2 text-muted-foreground">No Targets Acquired</h2>
            <p className="text-sm text-muted-foreground/70">No fixture data available for the selected timeframe.</p>
          </div>
        ) : (
          <div className="space-y-8">
            <AnimatePresence>
              {fixturesResponse.leagues.map((league, leagueIdx) => (
                <motion.div 
                  key={league.leagueId}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: leagueIdx * 0.1 }}
                  className="border border-border/50 bg-card/40 relative overflow-hidden group"
                >
                  {/* League Header */}
                  <div className="border-b border-border/50 bg-card p-3 flex items-center gap-3">
                    {league.primaryColor && (
                      <div className="w-1 h-full absolute left-0 top-0" style={{ backgroundColor: league.primaryColor }} />
                    )}
                    <span className="text-xs ml-2 opacity-80 font-sans">{league.countryFlag}</span>
                    <h2 className="text-sm font-mono font-bold tracking-widest uppercase text-foreground/90">
                      {league.countryName} - {league.leagueName}
                    </h2>
                  </div>

                  {/* Fixtures List */}
                  <div className="divide-y divide-border/30">
                    {league.fixtures.map((fixture) => {
                      const isLive = fixture.status === "inprogress";
                      const isFinished = fixture.status === "finished";
                      const isNotStarted = fixture.status === "notstarted";
                      const isPostponed = fixture.status === "postponed";
                      const isCancelled = fixture.status === "cancelled";
                      
                      const homeWinner = fixture.winnerCode === 100;
                      const awayWinner = fixture.winnerCode === 200;

                      return (
                        <div 
                          key={fixture.id}
                          data-testid={`fixture-${fixture.id}`}
                          onClick={() => navigate(`/fixture/${fixture.id}`)}
                          className={`p-4 flex items-center justify-between transition-colors hover:bg-white/[0.03] cursor-pointer group ${isFinished || isPostponed || isCancelled ? "opacity-60" : ""} ${isLive ? "bg-primary/5" : ""}`}
                        >
                          {/* Home Team */}
                          <div className={`flex-1 flex items-center justify-end gap-3 text-right ${homeWinner ? "font-bold text-foreground" : awayWinner ? "text-muted-foreground" : "text-foreground/90"}`}>
                            <span className="text-sm md:text-base uppercase tracking-wide truncate max-w-[100px] sm:max-w-[140px] md:max-w-none">
                              {fixture.homeTeam.name}
                            </span>
                            <div 
                              className="w-2 h-2 rounded-full flex-shrink-0" 
                              style={{ backgroundColor: fixture.homeTeam.colorPrimary || "#555" }} 
                            />
                          </div>

                          {/* Score / Time */}
                          <div className="w-24 md:w-32 flex-shrink-0 flex flex-col items-center justify-center font-mono">
                            {isLive ? (
                              <>
                                <div className="text-xl md:text-2xl font-bold text-green-400 drop-shadow-[0_0_8px_rgba(34,197,94,0.6)]">
                                  {fixture.homeScore ?? 0} - {fixture.awayScore ?? 0}
                                </div>
                                <div className="flex items-center gap-1 mt-1 text-[10px] text-green-400 font-bold uppercase tracking-widest">
                                  <div className="w-1.5 h-1.5 bg-green-500 rounded-full live-indicator" />
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
                                <div className="text-[10px] text-destructive mt-1 uppercase tracking-widest border border-destructive/50 px-2 py-0.5">POSTPONED</div>
                            ) : isCancelled ? (
                                <div className="text-[10px] text-destructive mt-1 uppercase tracking-widest border border-destructive/50 px-2 py-0.5">CANCELLED</div>
                            ) : (
                              <>
                                <div className="text-lg md:text-xl font-medium text-primary/80">
                                  {format(new Date(fixture.kickoffTimestamp * 1000), "HH:mm")}
                                </div>
                                <div className="text-[10px] text-muted-foreground mt-1 uppercase tracking-widest">UPCOMING</div>
                              </>
                            )}
                          </div>

                          {/* Away Team */}
                          <div className={`flex-1 flex items-center justify-start gap-3 ${awayWinner ? "font-bold text-foreground" : homeWinner ? "text-muted-foreground" : "text-foreground/90"}`}>
                            <div 
                              className="w-2 h-2 rounded-full flex-shrink-0" 
                              style={{ backgroundColor: fixture.awayTeam.colorPrimary || "#555" }} 
                            />
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
