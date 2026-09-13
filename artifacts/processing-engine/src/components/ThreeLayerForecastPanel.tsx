import React from "react";
import { motion } from "framer-motion";
import { Wand2 } from "lucide-react";

interface ForecastMatch {
  isHome: boolean;
  homeScore: number;
  awayScore: number;
  date?: number;
  eventId?: number;
  homeTeamName?: string;
  awayTeamName?: string;
  odds?: [number, number, number];
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
  sureThreshold: number;
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
  trendThreshold: number;
  roundingDirection: "up" | "down" | "standard";
  roundedGoalLine: number;
  primary: Score;
  secondary: Score;
}

interface MatchProfile {
  sampleSize: number;
  goalsForAvg: number;
  goalsAgainstAvg: number;
  totalGoalsAvg: number;
  goalsForVariance: number;
  totalGoalsVariance: number;
  bttsPct: number;
  cleanSheetPct: number;
  scorelessPct: number;
  recentGoalsForAvg: number;
  baselineGoalsForAvg: number;
  momentum: number;
  averageMargin: number;
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

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function variance(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = average(values);
  return average(values.map(value => (value - mean) ** 2));
}

function centralAverage(values: number[]): number {
  if (values.length < 5) return average(values);
  const ordered = [...values].sort((a, b) => a - b);
  return average(ordered.slice(1, -1));
}

function profileFor(matches: ForecastMatch[]): MatchProfile {
  const ordered = matches
    .filter(validMatch)
    .sort((a, b) => (a.date ?? 0) - (b.date ?? 0));
  const recent = ordered.slice(-3);
  const goalsFor = ordered.map(goalsForTeam);
  const goalsAgainst = ordered.map(goalsAgainstTeam);
  const totals = ordered.map(match => match.homeScore + match.awayScore);
  const margins = ordered.map(match => Math.abs(match.homeScore - match.awayScore));
  const baseline = ordered.slice(-12);
  const baselineGoalsFor = baseline.map(goalsForTeam);
  const recentGoalsFor = recent.map(goalsForTeam);
  const btts = ordered.filter(match => match.homeScore > 0 && match.awayScore > 0).length;
  const cleanSheets = goalsAgainst.filter(goals => goals === 0).length;
  const scoreless = goalsFor.filter(goals => goals === 0).length;
  const baselineAvg = average(baselineGoalsFor);
  const recentAvg = average(recentGoalsFor);

  return {
    sampleSize: ordered.length,
    goalsForAvg: centralAverage(goalsFor),
    goalsAgainstAvg: centralAverage(goalsAgainst),
    totalGoalsAvg: centralAverage(totals),
    goalsForVariance: variance(goalsFor),
    totalGoalsVariance: variance(totals),
    bttsPct: ordered.length ? (btts / ordered.length) * 100 : 0,
    cleanSheetPct: ordered.length ? (cleanSheets / ordered.length) * 100 : 0,
    scorelessPct: ordered.length ? (scoreless / ordered.length) * 100 : 0,
    recentGoalsForAvg: recentAvg,
    baselineGoalsForAvg: baselineAvg,
    momentum: clamp(1 + (recentAvg - baselineAvg) * 0.12, 0.72, 1.28),
    averageMargin: average(margins),
  };
}

function adaptiveCandidatePool(
  homeXg: number,
  awayXg: number,
  homeProfile: MatchProfile,
  awayProfile: MatchProfile,
): Score[] {
  const totalExpectation = homeXg + awayXg;
  const volatility = Math.sqrt(
    Math.max(0, homeProfile.totalGoalsVariance) +
    Math.max(0, awayProfile.totalGoalsVariance),
  );
  const maxTotal = clamp(Math.ceil(totalExpectation + volatility * 0.65), 2, 8);
  const maxIndividual = clamp(
    Math.ceil(Math.max(homeXg, awayXg) + Math.sqrt(Math.max(homeProfile.goalsForVariance, awayProfile.goalsForVariance)) * 0.45),
    2,
    6,
  );
  const candidates: Score[] = [];

  for (let homeGoals = 0; homeGoals <= maxIndividual; homeGoals += 1) {
    for (let awayGoals = 0; awayGoals <= maxIndividual; awayGoals += 1) {
      if (homeGoals + awayGoals <= maxTotal) {
        candidates.push({ home: homeGoals, away: awayGoals });
      }
    }
  }

  return candidates;
}

function poissonMass(goals: number, mean: number): number {
  let factorial = 1;
  for (let index = 2; index <= goals; index += 1) factorial *= index;
  return Math.exp(-mean) * (mean ** goals) / factorial;
}

function rankAdaptiveScores(
  candidates: Score[],
  homeXg: number,
  awayXg: number,
  homeProfile: MatchProfile,
  awayProfile: MatchProfile,
): Score[] {
  const expectedTotal = homeXg + awayXg;
  const bttsRate = (homeProfile.bttsPct + awayProfile.bttsPct) / 200;
  const homeCleanSheetRate = homeProfile.cleanSheetPct / 100;
  const awayCleanSheetRate = awayProfile.cleanSheetPct / 100;

  return [...candidates].sort((a, b) => {
    const scoreValue = (score: Score) => {
      const poisson = poissonMass(score.home, Math.max(0.05, homeXg)) *
        poissonMass(score.away, Math.max(0.05, awayXg));
      const bttsFit = (score.home > 0 && score.away > 0) ? bttsRate : 1 - bttsRate;
      const cleanSheetFit =
        (score.away === 0 ? homeCleanSheetRate : 1 - homeCleanSheetRate) *
        (score.home === 0 ? awayCleanSheetRate : 1 - awayCleanSheetRate);
      const totalFit = Math.exp(-Math.abs(score.home + score.away - expectedTotal) * 0.22);
      return poisson * (0.7 + bttsFit * 0.3) * (0.7 + cleanSheetFit * 0.3) * totalFit;
    };
    const difference = scoreValue(b) - scoreValue(a);
    return difference || scoreDistance(a, homeXg, awayXg) - scoreDistance(b, homeXg, awayXg);
  });
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

  const venueSample = Math.min(homeGames.length, awayGames.length);
  const sureThreshold = clamp(20 - Math.max(0, 8 - venueSample) * 2, 10, 20);
  const awayWinEliminated = homeLossPct < sureThreshold && awayWinPct < sureThreshold;
  // Mirrored boundary for the opposite outcome: both venue samples show an 80%+ weakness signal.
  const homeWinEliminated = homeLossPct > 100 - sureThreshold && awayWinPct > 100 - sureThreshold;

  const homeProfile = profileFor(homeGames);
  const awayProfile = profileFor(awayGames);
  const homeRecentProfile = profileFor(chronologicalTimeline(home));
  const awayRecentProfile = profileFor(chronologicalTimeline(away));

  // Blend venue behavior with recent all-venue form. The blend makes the forecast
  // responsive to the matchup without allowing one venue sample or one outlier to
  // become the whole prediction.
  const homeAttack = (homeProfile.goalsForAvg * 0.65 + homeRecentProfile.goalsForAvg * 0.35) * homeRecentProfile.momentum;
  const awayDefense = awayProfile.goalsAgainstAvg * 0.65 + awayRecentProfile.goalsAgainstAvg * 0.35;
  const awayAttack = (awayProfile.goalsForAvg * 0.65 + awayRecentProfile.goalsForAvg * 0.35) * awayRecentProfile.momentum;
  const homeDefense = homeProfile.goalsAgainstAvg * 0.65 + homeRecentProfile.goalsAgainstAvg * 0.35;
  const homeXg = Math.max(0.05, (homeAttack + awayDefense) / 2);
  const awayXg = Math.max(0.05, (awayAttack + homeDefense) / 2);
  const rawGoalLine = homeXg + awayXg;

  const homeOverPct = (homeGames.filter(match => match.homeScore + match.awayScore > 2.5).length / homeGames.length) * 100;
  const awayOverPct = (awayGames.filter(match => match.homeScore + match.awayScore > 2.5).length / awayGames.length) * 100;
  const homeUnderPct = 100 - homeOverPct;
  const awayUnderPct = 100 - awayOverPct;
  const combinedOverPct = homeOverPct + awayOverPct;
  const combinedUnderPct = homeUnderPct + awayUnderPct;

  const trendThreshold = Math.max(95, 100 + (4 - Math.min(homeGames.length, awayGames.length)) * 2);
  const roundingDirection: Forecast["roundingDirection"] =
    combinedUnderPct > trendThreshold ? "down" : combinedOverPct > trendThreshold ? "up" : "standard";
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

  const adaptiveScores = adaptiveCandidatePool(
    homeXg,
    awayXg,
    homeProfile,
    awayProfile,
  );
  const allowedScores = adaptiveScores.filter(score =>
    !(awayWinEliminated && score.away > score.home) &&
    !(homeWinEliminated && score.home > score.away),
  );
  const rankedScores = rankAdaptiveScores(
    allowedScores.length ? allowedScores : adaptiveScores,
    homeXg,
    awayXg,
    homeRecentProfile,
    awayRecentProfile,
  );

  return {
    available: true,
    homeLossPct,
    awayWinPct,
    sureThreshold,
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
    trendThreshold,
    roundingDirection,
    roundedGoalLine,
    primary: rankedScores[0],
    secondary: rankedScores[1] ?? rankedScores[0],
  };
}

function scoreLabel(score: Score): string {
  return `${score.home}–${score.away}`;
}

function normalizeTeamName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function chronologicalTimeline(team: ForecastTeamData): ForecastMatch[] {
  return team.matches
    .filter(validMatch)
    .sort((a, b) => (a.date ?? 0) - (b.date ?? 0))
    .slice(-12);
}

function goalsForTeam(match: ForecastMatch): number {
  return match.isHome ? match.homeScore : match.awayScore;
}

function timelineLabel(match: ForecastMatch): string {
  const venue = match.isHome ? "H" : "A";
  return `${venue} ${match.homeScore}–${match.awayScore}`;
}

function currentScoringDrought(timeline: ForecastMatch[]): number {
  let streak = 0;
  for (let index = timeline.length - 1; index >= 0; index -= 1) {
    if (goalsForTeam(timeline[index]) === 0) streak += 1;
    else break;
  }
  return streak >= 2 ? streak : 0;
}

function goalsAgainstTeam(match: ForecastMatch): number {
  return match.isHome ? match.awayScore : match.homeScore;
}

function lowVarianceGrinderCount(matches: ForecastMatch[]): number {
  return matches.filter(match => match.homeScore + match.awayScore <= 1).length;
}

function wideGapCount(matches: ForecastMatch[]): number {
  return matches.filter(match => match.homeScore + match.awayScore >= 4 || goalsAgainstTeam(match) >= 2).length;
}

function consecutiveHighScoringMatches(timeline: ForecastMatch[]): number {
  let streak = 0;
  for (let index = timeline.length - 1; index >= 0; index -= 1) {
    const match = timeline[index];
    if (match.homeScore + match.awayScore >= 4 || goalsForTeam(match) >= 3) streak += 1;
    else break;
  }
  return streak >= 2 ? streak : 0;
}

function matchesSamePair(match: ForecastMatch, homeName: string, awayName: string): boolean {
  if (!match.homeTeamName || !match.awayTeamName) return false;
  const home = normalizeTeamName(homeName);
  const away = normalizeTeamName(awayName);
  return (
    (normalizeTeamName(match.homeTeamName) === home && normalizeTeamName(match.awayTeamName) === away) ||
    (normalizeTeamName(match.homeTeamName) === away && normalizeTeamName(match.awayTeamName) === home)
  );
}

function h2hMatchKey(match: ForecastMatch): string {
  return match.eventId != null
    ? `event:${match.eventId}`
    : [
        match.date ?? 0,
        normalizeTeamName(match.homeTeamName ?? ""),
        normalizeTeamName(match.awayTeamName ?? ""),
        match.homeScore,
        match.awayScore,
      ].join(":");
}

function collectH2H(
  homeTimeline: ForecastMatch[],
  awayTimeline: ForecastMatch[],
  fixture: ForecastFixture,
): ForecastMatch[] {
  const unique = new Map<string, ForecastMatch>();
  [...homeTimeline, ...awayTimeline]
    .filter(match => matchesSamePair(match, fixture.homeTeam.name, fixture.awayTeam.name))
    .forEach(match => unique.set(h2hMatchKey(match), match));

  return [...unique.values()]
    .sort((a, b) => (a.date ?? 0) - (b.date ?? 0))
    .slice(-6);
}

function fixtureOrientedScore(match: ForecastMatch, fixture: ForecastFixture): Score {
  const isFixtureHome =
    normalizeTeamName(match.homeTeamName ?? "") === normalizeTeamName(fixture.homeTeam.name);
  return isFixtureHome
    ? { home: match.homeScore, away: match.awayScore }
    : { home: match.awayScore, away: match.homeScore };
}

interface ConvergenceAnalysis {
  homeTimeline: ForecastMatch[];
  awayTimeline: ForecastMatch[];
  h2h: ForecastMatch[];
  candidatePool: Score[];
  adaptiveMaxTotal: number;
  adaptiveVolatility: number;
  fatigueCeiling: number;
  lowVarianceCeiling: number;
  wideGapFloor: number;
  homeGrinderCount: number;
  homeWideGapCount: number;
  awayWideGapCount: number;
  lowVarianceFreeze: boolean;
  wideGapEnvironment: boolean;
  homeDrought: number;
  awayDrought: number;
  homeBlowoutStreak: number;
  awayBlowoutStreak: number;
  fatigueTax: boolean;
  survivors: Score[];
  layerOneRemoved: Score[];
  layerTwoRemoved: Score[];
  layerThreeRemoved: Score[];
  h2hTrigger: boolean;
  closeH2H: boolean;
  wildH2H: boolean;
  h2hAverageGoals: number;
  h2hAverageMargin: number;
  historicalEdge: "home" | "away" | "balanced" | "unavailable";
  breakTrigger: string;
  outlierTrigger: boolean;
}

function analyzeConvergence(
  home: ForecastTeamData,
  away: ForecastTeamData,
  fixture: ForecastFixture,
  forecast: Forecast,
  directH2H: ForecastMatch[] = [],
): ConvergenceAnalysis {
  const homeTimeline = chronologicalTimeline(home);
  const awayTimeline = chronologicalTimeline(away);
  const directMatches = directH2H
    .filter(validMatch)
    .filter(match => matchesSamePair(match, fixture.homeTeam.name, fixture.awayTeam.name));
  const h2h = directMatches.length
    ? [...new Map(directMatches.map(match => [h2hMatchKey(match), match])).values()]
      .sort((a, b) => (a.date ?? 0) - (b.date ?? 0))
    : collectH2H(homeTimeline, awayTimeline, fixture);
  const homeDrought = currentScoringDrought(homeTimeline);
  const awayDrought = currentScoringDrought(awayTimeline);
  const homeVenueMatches = home.matches.filter(match => match.isHome && validMatch(match));
  const awayVenueMatches = away.matches.filter(match => !match.isHome && validMatch(match));
  const homeGrinderCount = lowVarianceGrinderCount(homeVenueMatches);
  const homeWideGapCount = wideGapCount(homeVenueMatches);
  const awayWideGapCount = wideGapCount(awayVenueMatches);
  const homeProfile = profileFor(homeVenueMatches);
  const awayProfile = profileFor(awayVenueMatches);
  const adaptiveVolatility = Math.sqrt(
    Math.max(0, homeProfile.totalGoalsVariance) +
    Math.max(0, awayProfile.totalGoalsVariance),
  );
  const candidatePool = adaptiveCandidatePool(
    forecast.homeXg,
    forecast.awayXg,
    homeProfile,
    awayProfile,
  );
  const adaptiveMaxTotal = candidatePool.reduce(
    (max, score) => Math.max(max, score.home + score.away),
    0,
  );
  const lowVarianceFreeze = homeVenueMatches.length >= 4 && homeGrinderCount >= 2;
  const wideGapEnvironment =
    homeVenueMatches.length >= 4 &&
    awayVenueMatches.length >= 4 &&
    homeWideGapCount >= 2 &&
    awayWideGapCount >= 2;
  const homeBlowoutStreak = consecutiveHighScoringMatches(homeTimeline);
  const awayBlowoutStreak = consecutiveHighScoringMatches(awayTimeline);
  const fatigueTax = homeBlowoutStreak >= 2 || awayBlowoutStreak >= 2;
  const fatigueCeiling = Math.max(
    1,
    Math.ceil(forecast.rawGoalLine - Math.min(2, Math.max(homeBlowoutStreak, awayBlowoutStreak) * 0.5)),
  );

  const lowVarianceCeiling = Math.max(
    1,
    Math.ceil(forecast.rawGoalLine + adaptiveVolatility * 0.2),
  );
  const wideGapFloor = Math.max(
    1,
    Math.floor(forecast.rawGoalLine - adaptiveVolatility * 0.35),
  );
  let survivors = candidatePool.map(score => ({ ...score }));
  const layerOneBefore = survivors;
  if (lowVarianceFreeze) survivors = survivors.filter(score => score.home + score.away <= lowVarianceCeiling);
  if (wideGapEnvironment) survivors = survivors.filter(score => score.home + score.away >= wideGapFloor);
  const layerOneRemoved = layerOneBefore.filter(score => !survivors.some(candidate => candidate.home === score.home && candidate.away === score.away));

  const layerTwoBefore = survivors;
  if (fatigueTax) survivors = survivors.filter(score => score.home + score.away <= fatigueCeiling);
  if (homeDrought) survivors = survivors.filter(score => score.home > 0);
  if (awayDrought) survivors = survivors.filter(score => score.away > 0);
  const layerTwoRemoved = layerTwoBefore.filter(score => !survivors.some(candidate => candidate.home === score.home && candidate.away === score.away));

  const h2hAverageGoals = h2h.length
    ? average(h2h.map(match => match.homeScore + match.awayScore))
    : 0;
  const fixtureOrientedH2H = h2h.map(match => fixtureOrientedScore(match, fixture));
  const fixtureHomeWins = fixtureOrientedH2H.filter(score => score.home > score.away).length;
  const fixtureAwayWins = fixtureOrientedH2H.filter(score => score.away > score.home).length;
  const h2hAverageMargin = h2h.length
    ? average(fixtureOrientedH2H.map(score => Math.abs(score.home - score.away)))
    : 0;
  const closeH2HCount = fixtureOrientedH2H.filter(score => Math.abs(score.home - score.away) <= 1).length;
  const wildH2HCount = fixtureOrientedH2H.filter(score => Math.abs(score.home - score.away) >= 2).length;
  const closeH2H = h2h.length >= 3 && closeH2HCount / h2h.length >= 0.67;
  const wildH2H = h2h.length >= 3 && wildH2HCount / h2h.length >= 0.5 && h2hAverageMargin >= 1.5;
  const h2hTrigger = closeH2H || wildH2H;
  const historicalEdge: ConvergenceAnalysis["historicalEdge"] = !h2h.length
    ? "unavailable"
    : fixtureHomeWins > fixtureAwayWins ? "home"
      : fixtureAwayWins > fixtureHomeWins ? "away"
        : "balanced";

  const layerThreeBefore = survivors;
  if (closeH2H) survivors = survivors.filter(score => Math.abs(score.home - score.away) <= 1);
  if (wildH2H) survivors = survivors.filter(score => score.home + score.away > 2);
  const layerThreeRemoved = layerThreeBefore.filter(score => !survivors.some(candidate => candidate.home === score.home && candidate.away === score.away));
  survivors = rankAdaptiveScores(
    survivors.length ? survivors : candidatePool,
    forecast.homeXg,
    forecast.awayXg,
    homeProfile,
    awayProfile,
  );

  const breakTrigger = lowVarianceFreeze
    ? `Home venue produced ${homeGrinderCount} low-variance grinder(s), so the adaptive ceiling is ${lowVarianceCeiling} total goals.`
    : wideGapEnvironment
      ? `Both venue samples contain repeated wide-gap matches (${homeWideGapCount} home / ${awayWideGapCount} away), so totals below ${wideGapFloor} were removed.`
      : fatigueTax
        ? `A ${Math.max(homeBlowoutStreak, awayBlowoutStreak)}-match high-scoring run set an adaptive ceiling of ${fatigueCeiling} total goals.`
        : homeDrought || awayDrought
          ? "A consecutive scoreless run triggered the anomaly-spike clean-sheet check."
          : closeH2H
            ? `The H2H average margin is ${h2hAverageMargin.toFixed(1)} goals and most meetings stayed within one goal.`
            : wildH2H
              ? `The H2H average margin is ${h2hAverageMargin.toFixed(1)} goals and at least half the meetings were wide-margin results.`
              : "No single log statistic is strong enough to force a break from the current form trend.";

  const outlierTrigger = (
    forecast.combinedOverPct > forecast.trendThreshold &&
    forecast.rawGoalLine >= 3.5 &&
    !fatigueTax &&
    !lowVarianceFreeze &&
    (wideGapEnvironment || wildH2H)
  ) || (wildH2H && h2hAverageGoals >= 3.5 && !fatigueTax);

  return {
    homeTimeline,
    awayTimeline,
    h2h,
    candidatePool,
    adaptiveMaxTotal,
    adaptiveVolatility,
    fatigueCeiling,
    lowVarianceCeiling,
    wideGapFloor,
    homeGrinderCount,
    homeWideGapCount,
    awayWideGapCount,
    lowVarianceFreeze,
    wideGapEnvironment,
    homeDrought,
    awayDrought,
    homeBlowoutStreak,
    awayBlowoutStreak,
    fatigueTax,
    survivors,
    layerOneRemoved,
    layerTwoRemoved,
    layerThreeRemoved,
    h2hTrigger,
    closeH2H,
    wildH2H,
    h2hAverageGoals,
    h2hAverageMargin,
    historicalEdge,
    breakTrigger,
    outlierTrigger,
  };
}

function CandidateChips({ scores, muted = false }: { scores: Score[]; muted?: boolean }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {scores.map(score => (
        <span key={`${score.home}-${score.away}`} className={`px-2 py-1 border text-[10px] font-mono ${
          muted
            ? "border-border/30 text-muted-foreground/40"
            : "border-cyan-500/30 bg-cyan-500/5 text-cyan-200"
        }`}>
          {scoreLabel(score)}
        </span>
      ))}
      {!scores.length && <span className="text-[10px] font-mono text-muted-foreground/40">None survive</span>}
    </div>
  );
}

function TimelineLog({ title, timeline, color }: { title: string; timeline: ForecastMatch[]; color: string }) {
  return (
    <div className="border border-border/20 bg-card/20 p-3">
      <div className="text-[10px] font-mono uppercase tracking-widest mb-2" style={{ color }}>
        {title} · {timeline.length} matches
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-1">
        {timeline.map((match, index) => (
          <span key={`${match.eventId ?? index}-${match.date ?? index}`} className="border border-border/15 px-2 py-1 text-[10px] font-mono text-muted-foreground/70">
            {String(index + 1).padStart(2, "0")} · {timelineLabel(match)}
          </span>
        ))}
      </div>
      {!timeline.length && <p className="text-[10px] font-mono text-muted-foreground/40">No completed timeline available.</p>}
    </div>
  );
}

function ConvergenceSieveSection({ home, away, fixture, forecast, directH2H }: {
  home: ForecastTeamData;
  away: ForecastTeamData;
  fixture: ForecastFixture;
  forecast: Forecast;
  directH2H?: ForecastMatch[];
}) {
  const analysis = analyzeConvergence(home, away, fixture, forecast, directH2H);
  const homeColor = fixture.homeTeam.colorPrimary ?? "#22d3ee";
  const awayColor = fixture.awayTeam.colorPrimary ?? "#f97316";

  return (
    <div className="border border-purple-500/30 bg-purple-500/5 p-4 sm:p-5 space-y-5">
      <div>
        <div className="flex items-center gap-2">
          <span className="text-lg">⚽</span>
          <span className="text-xs font-mono uppercase tracking-widest text-purple-200">The 13th Convergence: The Systemic Scoreline Sieve</span>
        </div>
        <p className="mt-2 text-[11px] leading-relaxed font-mono text-muted-foreground/70">
           This matrix maps {fixture.homeTeam.name} and {fixture.awayTeam.name} across their latest 12 chronological matches, builds a match-specific score-state distribution, and then applies only the tactical, trend, and H2H filters supported by the loaded data.
        </p>
      </div>

      <div className="border border-purple-500/20 bg-background/20 p-3">
          <div className="text-[10px] font-mono uppercase tracking-widest text-purple-200/70 mb-2">Adaptive Candidate States · {analysis.candidatePool.length} match-specific scorelines</div>
         <CandidateChips scores={analysis.candidatePool} muted />
      </div>

      <div>
        <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground/50 mb-2">📊 The Triple-Data Logs · Oldest to Most Recent</div>
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
          <TimelineLog title={`${fixture.homeTeam.name} · Home Vector`} timeline={analysis.homeTimeline} color={homeColor} />
          <TimelineLog title={`${fixture.awayTeam.name} · Inconsistency Matrix`} timeline={analysis.awayTimeline} color={awayColor} />
        </div>
      </div>

      <div className="border border-border/20 bg-card/20 p-3">
         <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground/50 mb-2">Head-to-Head Historical Friction · {analysis.h2h.length} meetings with results + odds</div>
        {analysis.h2h.length ? (
           <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 max-h-96 overflow-y-auto pr-1">
            {analysis.h2h.map((match, index) => (
              <span key={`${match.eventId ?? index}-${match.date ?? index}`} className="border border-purple-500/25 px-2 py-1 text-[10px] font-mono text-purple-200/80">
                 {index + 1}. {scoreLabel(fixtureOrientedScore(match, fixture))}
                 {match.odds && <span className="text-muted-foreground/50"> · {match.odds.map(odd => odd.toFixed(2)).join(" / ")}</span>}
              </span>
            ))}
          </div>
        ) : (
          <p className="text-[10px] font-mono text-amber-200/60">
            No H2H meetings were present in the loaded 12-match timelines. Layer 3 applies no H2H elimination rather than inventing historical results.
          </p>
        )}
      </div>

      <div>
        <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground/50 mb-2">⚙️ The Stratified Sifting Layers</div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          <div className="border border-border/20 bg-card/20 p-3 space-y-2">
            <div className="text-[10px] font-mono font-bold text-cyan-200">Layer 1 · Tactical Environment</div>
            <p className="text-[10px] leading-relaxed font-mono text-muted-foreground/60">
              {analysis.lowVarianceFreeze
                 ? `${fixture.homeTeam.name} recorded ${analysis.homeGrinderCount} low-variance home grinder(s), so the adaptive total ceiling is ${analysis.lowVarianceCeiling} goals.`
                : analysis.wideGapEnvironment
                  ? `Both venue samples show repeated wide gaps (${analysis.homeWideGapCount} home / ${analysis.awayWideGapCount} away), so totals below ${analysis.wideGapFloor} were removed.`
                  : "Venue data did not meet either the low-variance freeze or wide-gap threshold."}
            </p>
            <div className="text-[9px] font-mono text-muted-foreground/40">{analysis.layerOneRemoved.length} candidates removed</div>
          </div>
          <div className="border border-border/20 bg-card/20 p-3 space-y-2">
            <div className="text-[10px] font-mono font-bold text-cyan-200">Layer 2 · Trend Exhaustion</div>
            <p className="text-[10px] leading-relaxed font-mono text-muted-foreground/60">
              {analysis.fatigueTax || analysis.homeDrought || analysis.awayDrought
                 ? `${analysis.fatigueTax ? `A recent blowout streak capped this match-specific pool at ${analysis.fatigueCeiling} total goals. ` : ""}${analysis.homeDrought ? `${fixture.homeTeam.name} has a ${analysis.homeDrought}-match scoring drought. ` : ""}${analysis.awayDrought ? `${fixture.awayTeam.name} has a ${analysis.awayDrought}-match scoring drought. ` : ""}${analysis.homeDrought || analysis.awayDrought ? "Clean-sheet options for the dry side were removed." : ""}`
                : "No blowout fatigue or consecutive scoreless streak was detected, so this layer stays neutral."}
            </p>
            <div className="text-[9px] font-mono text-muted-foreground/40">{analysis.layerTwoRemoved.length} candidates removed</div>
          </div>
          <div className="border border-border/20 bg-card/20 p-3 space-y-2">
            <div className="text-[10px] font-mono font-bold text-cyan-200">Layer 3 · H2H Friction Reset</div>
            <p className="text-[10px] leading-relaxed font-mono text-muted-foreground/60">
              {analysis.closeH2H
                ? `The H2H average margin is ${analysis.h2hAverageMargin.toFixed(1)} goals; mostly close meetings removed blowout scores.`
                : analysis.wildH2H
                  ? `The H2H average margin is ${analysis.h2hAverageMargin.toFixed(1)} goals; repeated wide margins removed low-scoring stalemates.`
                : analysis.h2h.length
                  ? `The available H2H sequence averaged ${analysis.h2hAverageMargin.toFixed(1)} goals of margin and did not meet a close or wild threshold.`
                  : "No H2H friction matrix was available, so no margin filter was applied."}
            </p>
            <div className="text-[9px] font-mono text-muted-foreground/40">{analysis.layerThreeRemoved.length} candidates removed</div>
          </div>
        </div>
      </div>

      <div className="border border-green-500/30 bg-green-500/5 p-3">
        <div className="text-[10px] font-mono uppercase tracking-widest text-green-300/80 mb-2">Survivors after all three filters</div>
        <CandidateChips scores={analysis.survivors} />
        <p className="mt-3 text-[10px] leading-relaxed font-mono text-muted-foreground/70">
          {analysis.survivors.length
             ? `The surviving field contains ${analysis.survivors.length} of ${analysis.candidatePool.length} match-specific score states. The matrix ranks central expectation separately from capacity and volatility; it does not treat a high-scoring outlier as the default.`
            : "All listed candidates were eliminated by the active filters; this is the point at which the system should inspect an unlisted outlier rather than force a pool result."}
        </p>
      </div>

      <div className="border border-amber-500/25 bg-amber-500/5 p-3">
        <div className="text-[10px] font-mono uppercase tracking-widest text-amber-200/80 mb-2">Definitive form-break trigger · {analysis.outlierTrigger ? "ACTIVE" : "INACTIVE"}</div>
        <p className="text-[10px] leading-relaxed font-mono text-muted-foreground/70">
          {analysis.breakTrigger}{" "}
          {analysis.outlierTrigger
            ? "The elevated goal environment and wide-gap/H2H evidence justify investigating an unlisted high-scoring outlier."
            : "No unlisted high-scoring outlier is justified by the current evidence."}
        </p>
      </div>
    </div>
  );
}

export default function ThreeLayerForecastPanel({ home, away, fixture, h2hMatches = [] }: {
  home: ForecastTeamData;
  away: ForecastTeamData;
  fixture: ForecastFixture;
  h2hMatches?: ForecastMatch[];
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
      : `Neither trend crosses the adaptive ${result.trendThreshold.toFixed(0)}% threshold`;

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
                  <br />
                  Adaptive boundary: <span className="text-foreground">{result.sureThreshold.toFixed(0)}%</span>
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

      <ConvergenceSieveSection
        home={home}
        away={away}
        fixture={fixture}
        forecast={result}
        directH2H={h2hMatches}
      />
    </motion.div>
  );
}