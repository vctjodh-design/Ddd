import React from "react";
import { motion } from "framer-motion";
import { Wand2 } from "lucide-react";

interface ForecastMatch {
  isHome: boolean;
  homeScore: number;
  awayScore: number;
}

interface ForecastTeamData {
  matches: ForecastMatch[];
}

interface ForecastFixture {
  homeTeam: { name: string; colorPrimary: string | null };
  awayTeam: { name: string; colorPrimary: string | null };
}

interface Score {
  home: number;
  away: number;
}

interface Forecast {
  available: true;
  homeLossPct: number;
  awayWinPct: number;
  sureVerdict: string;
  homeXg: number;
  awayXg: number;
  rawGoalLine: number;
  homeOverPct: number;
  awayOverPct: number;
  homeUnderPct: number;
  awayUnderPct: number;
  combinedOverPct: number;
  combinedUnderPct: number;
  roundingDirection: "up" | "down" | "standard";
  roundedGoalLine: number;
  primary: Score;
  secondary: Score;
}

interface Unavailable {
  available: false;
  reason: string;
}

type ForecastResult = Forecast | Unavailable;

function average(values: number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function validMatch(match: ForecastMatch): boolean {
  return Number.isFinite(match.homeScore) && Number.isFinite(match.awayScore);
}

function scoreDistance(score: Score, homeXg: number, awayXg: number): number {
  return Math.abs(score.home - homeXg) + Math.abs(score.away - awayXg);
}

function calculateForecast(home: ForecastTeamData, away: ForecastTeamData): ForecastResult {
  const homeGames = home.matches.filter(match => match.isHome && validMatch(match));
  const awayGames = away.matches.filter(match => !match.isHome && validMatch(match));

  if (!homeGames.length || !awayGames.length) {
    return {
      available: false,
      reason: "The model needs completed home matches for the home team and completed away matches for the away team.",
    };
  }

  const homeLosses = homeGames.filter(match => match.homeScore < match.awayScore).length;
  const awayWins = awayGames.filter(match => match.awayScore > match.homeScore).length;
  const homeLossPct = (homeLosses / homeGames.length) * 100;
  const awayWinPct = (awayWins / awayGames.length) * 100;

  const awayWinEliminated = homeLossPct < 20 && awayWinPct < 20;
  // Mirrored boundary for the opposite outcome: both venue samples show an 80%+ weakness signal.
  const homeWinEliminated = homeLossPct > 80 && awayWinPct > 80;

  // Exact Layer 2 formulas, using venue-specific averages.
  const homeXg = (
    average(homeGames.map(match => match.homeScore)) +
    average(awayGames.map(match => match.homeScore))
  ) / 2;
  const awayXg = (
    average(awayGames.map(match => match.awayScore)) +
    average(homeGames.map(match => match.awayScore))
  ) / 2;
  const rawGoalLine = homeXg + awayXg;

  const homeOverPct = (homeGames.filter(match => match.homeScore + match.awayScore > 2.5).length / homeGames.length) * 100;
  const awayOverPct = (awayGames.filter(match => match.homeScore + match.awayScore > 2.5).length / awayGames.length) * 100;
  const homeUnderPct = 100 - homeOverPct;
  const awayUnderPct = 100 - awayOverPct;
  const combinedOverPct = homeOverPct + awayOverPct;
  const combinedUnderPct = homeUnderPct + awayUnderPct;

  const roundingDirection: Forecast["roundingDirection"] =
    combinedUnderPct > 110 ? "down" : combinedOverPct > 110 ? "up" : "standard";
  const roundedGoalLine = roundingDirection === "down"
    ? Math.max(0, Math.floor(rawGoalLine))
    : roundingDirection === "up"
      ? Math.ceil(rawGoalLine)
      : Math.max(0, Math.round(rawGoalLine));

  const sureVerdict = awayWinEliminated
    ? "Away win eliminated"
    : homeWinEliminated
      ? "Home win eliminated"
      : "No outcome eliminated";

  const candidateScores: Score[] = [];
  for (let homeGoals = 0; homeGoals <= roundedGoalLine; homeGoals += 1) {
    const awayGoals = roundedGoalLine - homeGoals;
    if (awayWinEliminated && awayGoals > homeGoals) continue;
    if (homeWinEliminated && homeGoals > awayGoals) continue;
    candidateScores.push({ home: homeGoals, away: awayGoals });
  }

  const allowedScores = candidateScores.length
    ? candidateScores
    : [{ home: Math.floor(roundedGoalLine / 2), away: Math.ceil(roundedGoalLine / 2) }];
  allowedScores.sort((a, b) => scoreDistance(a, homeXg, awayXg) - scoreDistance(b, homeXg, awayXg));

  return {
    available: true,
    homeLossPct,
    awayWinPct,
    sureVerdict,
    homeXg,
    awayXg,
    rawGoalLine,
    homeOverPct,
    awayOverPct,
    homeUnderPct,
    awayUnderPct,
    combinedOverPct,
    combinedUnderPct,
    roundingDirection,
    roundedGoalLine,
    primary: allowedScores[0],
    secondary: allowedScores[1] ?? (
      allowedScores[0].home >= allowedScores[0].away
        ? { home: Math.max(0, allowedScores[0].home - 1), away: allowedScores[0].away + 1 }
        : { home: allowedScores[0].home + 1, away: Math.max(0, allowedScores[0].away - 1) }
    ),
  };
}

function scoreLabel(score: Score): string {
  return `${score.home}–${score.away}`;
}

export default function ThreeLayerForecastPanel({ home, away, fixture }: {
  home: ForecastTeamData;
  away: ForecastTeamData;
  fixture: ForecastFixture;
}) {
  const result = calculateForecast(home, away);
  const homeColor = fixture.homeTeam.colorPrimary ?? "#22d3ee";
  const awayColor = fixture.awayTeam.colorPrimary ?? "#f97316";

  if (!result.available) {
    return (
      <motion.div key="forecast-empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="border border-amber-500/30 bg-amber-500/5 p-5 space-y-3">
        <div className="flex items-center gap-2 text-amber-300">
          <Wand2 className="w-4 h-4" />
          <span className="text-xs font-mono uppercase tracking-widest">3-Layer Forecast</span>
        </div>
        <p className="text-[11px] font-mono text-amber-200/70">{result.reason}</p>
        <p className="text-[10px] font-mono text-muted-foreground/50">
          No percentage, xG, or scoreline is shown until both venue-specific samples are available.
        </p>
      </motion.div>
    );
  }

  const roundingLabel = result.roundingDirection === "down"
    ? "Forcefully round down"
    : result.roundingDirection === "up"
      ? "Forcefully round up"
      : "Standard nearest-integer rounding";
  const totalGoalsVerdict = result.roundingDirection === "down"
    ? "Under 2.5 Goals"
    : result.roundingDirection === "up"
      ? "Over 2.5 Goals"
      : result.roundedGoalLine > 2 ? "Over 2.5 Goals" : "Under 2.5 Goals";
  const trendLabel = result.roundingDirection === "down"
    ? "Under trend wins the rounding rule"
    : result.roundingDirection === "up"
      ? "Over trend wins the rounding rule"
      : "Neither trend crosses the 110% threshold";

  return (
    <motion.div key="forecast" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Wand2 className="w-4 h-4 text-cyan-400" />
            <span className="text-xs font-mono uppercase tracking-widest text-foreground/80">3-Layer Forecasting System</span>
          </div>
          <p className="mt-1 text-[10px] font-mono text-muted-foreground/50">
            Sure facts → raw probability → contextual estimation
          </p>
        </div>
        <span className="text-[9px] font-mono uppercase tracking-widest text-cyan-300/70 border border-cyan-500/30 px-2 py-1">
          Venue split · {home.matches.filter(match => match.isHome).length}/{away.matches.filter(match => !match.isHome).length} games
        </span>
      </div>

      <div className="border border-border/30 bg-card/20 overflow-hidden">
        <div className="px-3 py-2 border-b border-border/20 text-[10px] font-mono uppercase tracking-widest text-muted-foreground/60">
          📊 System Breakdown
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[680px] text-[10px] font-mono">
            <thead>
              <tr className="border-b border-border/20 text-muted-foreground/40 uppercase tracking-wider">
                <th className="text-left font-normal px-3 py-2">System Component</th>
                <th className="text-left font-normal px-3 py-2">Calculated Value</th>
                <th className="text-left font-normal px-3 py-2">Strategic Verdict</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-border/15 align-top">
                <td className="px-3 py-3 font-bold text-foreground/80">Layer 1: Sure Facts</td>
                <td className="px-3 py-3 text-muted-foreground/70">
                  Home losses: <span className="text-foreground">{result.homeLossPct.toFixed(1)}%</span>
                  <br />
                  Away wins: <span className="text-foreground">{result.awayWinPct.toFixed(1)}%</span>
                </td>
                <td className={`px-3 py-3 font-bold ${result.sureVerdict === "No outcome eliminated" ? "text-muted-foreground/70" : "text-cyan-300"}`}>
                  {result.sureVerdict}
                </td>
              </tr>
              <tr className="border-b border-border/15 align-top">
                <td className="px-3 py-3 font-bold text-foreground/80">Layer 2: Probability</td>
                <td className="px-3 py-3 text-muted-foreground/70">
                  Home xG: <span className="text-foreground">{result.homeXg.toFixed(2)}</span>
                  <br />
                  Away xG: <span className="text-foreground">{result.awayXg.toFixed(2)}</span>
                </td>
                <td className="px-3 py-3 text-foreground/80">
                  Raw goal line: <span className="text-cyan-300 font-bold">{result.rawGoalLine.toFixed(2)}</span>
                </td>
              </tr>
              <tr className="align-top">
                <td className="px-3 py-3 font-bold text-foreground/80">Layer 3: Estimation</td>
                <td className="px-3 py-3 text-muted-foreground/70">
                  Under: <span className="text-foreground">{result.combinedUnderPct.toFixed(1)}%</span>
                  <br />
                  Over: <span className="text-foreground">{result.combinedOverPct.toFixed(1)}%</span>
                </td>
                <td className={`px-3 py-3 font-bold ${result.roundingDirection === "standard" ? "text-muted-foreground/70" : "text-cyan-300"}`}>
                  {roundingLabel}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <div className="border border-cyan-500/30 bg-cyan-500/5 p-4">
          <div className="text-[10px] font-mono uppercase tracking-widest text-cyan-300/70 mb-3">🤖 Final System Prediction</div>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div>
              <div className="text-2xl font-mono font-bold text-foreground">{scoreLabel(result.primary)}</div>
              <div className="text-[9px] font-mono uppercase tracking-wider text-muted-foreground/50">Primary prediction</div>
            </div>
            <div className="border-l border-border/20">
              <div className="text-xl font-mono font-bold text-foreground/80">{scoreLabel(result.secondary)}</div>
              <div className="text-[9px] font-mono uppercase tracking-wider text-muted-foreground/50">Secondary prediction</div>
            </div>
            <div className="border-l border-border/20">
              <div className="text-sm font-mono font-bold text-cyan-300">{totalGoalsVerdict}</div>
              <div className="text-[9px] font-mono uppercase tracking-wider text-muted-foreground/50">Total goals verdict</div>
            </div>
          </div>
        </div>

        <div className="border border-border/30 bg-card/20 p-4 space-y-2">
          <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground/50">Trend context</div>
          <div className="grid grid-cols-2 gap-2 text-[10px] font-mono">
            <div className="border border-border/20 p-2">
              <div className="text-muted-foreground/40 uppercase tracking-wider">Home venue</div>
              <div className="mt-1" style={{ color: homeColor }}>
                O {result.homeOverPct.toFixed(0)}% · U {result.homeUnderPct.toFixed(0)}%
              </div>
            </div>
            <div className="border border-border/20 p-2">
              <div className="text-muted-foreground/40 uppercase tracking-wider">Away venue</div>
              <div className="mt-1" style={{ color: awayColor }}>
                O {result.awayOverPct.toFixed(0)}% · U {result.awayUnderPct.toFixed(0)}%
              </div>
            </div>
          </div>
          <p className="text-[10px] font-mono text-muted-foreground/60">{trendLabel}. Rounded line: {result.roundedGoalLine} goals.</p>
        </div>
      </div>
    </motion.div>
  );
}