/**
 * Futuristic Data Wizard Analysis Engine
 * ----------------------------------------
 * Pure data interpretation — NO odds influence, NO ML model.
 * Analyzes stored team stats to produce detailed match intelligence:
 *  - Team form ratings, DNA scans, goal trend insights
 *  - Overtune/Undertune adaptation analysis
 *  - 10,000 Poisson match simulations
 *  - Strengths, weaknesses, pressure response scores
 *  - Verdict based solely on raw data
 *
 * Works with both StatsHub (rich per-stat history) and BetExplorer (aggregated) data.
 */

// ── Shared types ──────────────────────────────────────────────────────────────

export interface WizardTeam {
  name: string;
  formRating: number;
  form: ("W" | "D" | "L")[];
  dnaScan: DnaScan;
  goalInsight: GoalInsight;
  goalImpact: GoalImpact;
  goalEvolution: GoalEvolution;
  overtuneEngine: OvertuneEngine;
  pressureScore: number;
  dynamicRating: DynamicRating;
  statRows: StatRow[];
  strengths: string[];
  weaknesses: string[];
}

export interface DnaScan {
  formRating: number;
  attackPower: number;
  defensiveStability: number;
  momentumIndex: number;
  adaptationScore: number;
  recoveryAfterDefeat: number;
  goalThreatIndex: number;
  matchControlRating: number;
}

export interface GoalInsight {
  allTimeAvg: number;
  last5Avg: number;
  trend: "above" | "below" | "stable";
  trendPct: number;
  prediction: string;
}

export interface GoalImpact {
  scored: number;
  scoredPg: number;
  conceded: number;
  concededPg: number;
  cleanSheets: number;
  cleanSheetPct: number;
  btts: number;
  bttsPct: number;
  over25: number;
  over25Pct: number;
  totalGames: number;
}

export interface GoalEvolution {
  goalsScored: number;
  goalsConceded: number;
  attackEvolution: number;
  defenseEvolution: number;
  netTrend: "improving" | "declining" | "stable";
}

export interface OvertuneEngine {
  adaptationLevel: number;
  overtuneCapacity: number;
  undertuneRisk: number;
  notes: string[];
}

export interface StatRow {
  label: string;
  allAvg: number;
  last5Avg: number;
  rating: number;
  impact: number;
  adjustment: number;
}

export interface DynamicRating {
  overall: number;
  form: number;
  attack: number;
  defense: number;
  psychology: number;
  momentum: number;
  adaptation: number;
  recovery: number;
}

export interface WizardMatchup {
  simulation: SimulationResult;
  mostLikelyScores: Array<{ home: number; away: number; prob: number }>;
  lambdaHome: number;
  lambdaAway: number;
  verdict: WizardVerdict;
}

export interface SimulationResult {
  homeWin: number;
  draw: number;
  awayWin: number;
  bttsYes: number;
  over25: number;
  under35: number;
  doubleChanceX2: number;
  doubleChance1X: number;
  sims: number;
}

export interface WizardVerdict {
  recommendation: string;
  edge: "home" | "away" | "draw" | "x2";
  confidenceLevel: number;
  advantages: Array<{ team: "home" | "away"; label: string }>;
  wizardPrediction: string;
}

export interface WizardOutput {
  dataSource: "statshub" | "betexplorer" | "minimal";
  homeTeam: WizardTeam;
  awayTeam: WizardTeam;
  matchup: WizardMatchup;
  generatedAt: number;
}

// ── StatsHub types (from stored JSON) ─────────────────────────────────────────

interface SHMatchStatRow {
  myValue: number;
  opponentValue: number;
  result: "W" | "D" | "L";
  homeScore: number;
  awayScore: number;
}

interface SHStatHistory {
  key: string;
  label: string;
  matches: SHMatchStatRow[];
}

interface SHTeamStatHistory {
  teamId: number;
  possession: number;
  statHistory: SHStatHistory[];
}

// ── BetExplorer types (from stored JSON) ──────────────────────────────────────

interface BETeamResult {
  result: "W" | "D" | "L";
  isHome: boolean;
  goalsScored: number;
  goalsConceded: number;
  opponent: string;
}

interface BETeamStats {
  avgGoalsScored: number;
  avgGoalsConceded: number;
  avgGoalsScoredL5: number;
  avgGoalsConcededL5: number;
  avgGoalsScoredHome: number;
  avgGoalsConcededHome: number;
  avgGoalsScoredAway: number;
  avgGoalsConcededAway: number;
  cleanSheets: number;
  cleanSheetsPct: number;
  bttsPct: number;
  form: ("W" | "D" | "L")[];
  wins: number;
  draws: number;
  losses: number;
  totalGames: number;
  results: BETeamResult[];
}

// ── Math helpers ──────────────────────────────────────────────────────────────

function mean(arr: number[]): number {
  if (!arr.length) return 0;
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

// Poisson PMF: P(X=k | lambda)
function poissonPMF(lambda: number, k: number): number {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  let p = Math.exp(-lambda);
  for (let i = 0; i < k; i++) p *= lambda / (i + 1);
  return p;
}

// ── Poisson simulation (analytical, 10k equivalent) ──────────────────────────

function runSimulation(lambdaHome: number, lambdaAway: number, n = 10000): {
  result: SimulationResult;
  scoreMatrix: Record<string, number>;
} {
  let homeWin = 0, draw = 0, awayWin = 0;
  let btts = 0, over25 = 0, under35 = 0;
  const scoreMatrix: Record<string, number> = {};

  const MAX_GOALS = 8;
  for (let h = 0; h <= MAX_GOALS; h++) {
    for (let a = 0; a <= MAX_GOALS; a++) {
      const prob = Math.round(poissonPMF(lambdaHome, h) * poissonPMF(lambdaAway, a) * n);
      if (prob === 0) continue;
      if (h > a) homeWin += prob;
      else if (h === a) draw += prob;
      else awayWin += prob;
      if (h > 0 && a > 0) btts += prob;
      if (h + a > 2.5) over25 += prob;
      if (h + a < 3.5) under35 += prob;
      scoreMatrix[`${h}-${a}`] = (scoreMatrix[`${h}-${a}`] ?? 0) + prob;
    }
  }

  const total = homeWin + draw + awayWin;
  const safeTotal = total || 1;

  return {
    result: {
      homeWin: round2(homeWin / safeTotal),
      draw:    round2(draw    / safeTotal),
      awayWin: round2(awayWin / safeTotal),
      bttsYes: round2(btts    / safeTotal),
      over25:  round2(over25  / safeTotal),
      under35: round2(under35 / safeTotal),
      doubleChanceX2: round2((draw + awayWin) / safeTotal),
      doubleChance1X: round2((homeWin + draw) / safeTotal),
      sims: n,
    },
    scoreMatrix,
  };
}

function topScores(matrix: Record<string, number>, total: number, limit = 6): Array<{ home: number; away: number; prob: number }> {
  return Object.entries(matrix)
    .map(([k, cnt]) => {
      const [h, a] = k.split("-").map(Number);
      return { home: h, away: a, prob: round2(cnt / total) };
    })
    .sort((a, b) => b.prob - a.prob)
    .slice(0, limit);
}

// ── Form rating ───────────────────────────────────────────────────────────────

function calcFormRating(form: ("W" | "D" | "L")[]): number {
  if (!form.length) return 50;
  const n = form.length;
  let weightedPts = 0, maxPts = 0;
  form.forEach((r, i) => {
    const w = i + 1; // more weight on recent matches
    const pts = r === "W" ? 3 : r === "D" ? 1 : 0;
    weightedPts += pts * w;
    maxPts += 3 * w;
  });
  return clamp(Math.round((weightedPts / maxPts) * 100), 5, 95);
}

// ── Goal insight: when will a 0.9-avg team exceed/underperform? ───────────────

function buildGoalInsight(allAvg: number, last5Avg: number, form: ("W" | "D" | "L")[]): GoalInsight {
  const trendPct = allAvg > 0.1 ? ((last5Avg - allAvg) / allAvg) * 100 : 0;
  const recentWins = form.filter(f => f === "W").length;
  const momentum = form.length > 0 ? recentWins / form.length : 0;

  let trend: "above" | "below" | "stable";
  let prediction: string;

  if (trendPct > 22) {
    trend = "above";
    const dir = momentum > 0.5 ? "High momentum + upward streak" : "Scoring surge";
    prediction = `${dir} (+${round1(trendPct)}%). Likely to EXCEED ${round2(allAvg)} goal average today.`;
  } else if (trendPct < -22) {
    trend = "below";
    const dir = momentum < 0.3 ? "Poor form + goal drought" : "Cooling from peak";
    prediction = `${dir} (${round1(trendPct)}%). Risk of UNDERPERFORMING ${round2(allAvg)} goal average.`;
  } else if (trendPct > 8) {
    trend = "above";
    prediction = `Modest uptick (+${round1(trendPct)}%). May SLIGHTLY exceed ${round2(allAvg)} goal average.`;
  } else if (trendPct < -8) {
    trend = "below";
    prediction = `Slight decline (${round1(trendPct)}%). May fall just SHORT of ${round2(allAvg)} average.`;
  } else {
    trend = "stable";
    prediction = `Stable production (${trendPct > 0 ? "+" : ""}${round1(trendPct)}%). Expect close to ${round2(allAvg)} goals today.`;
  }

  return { allTimeAvg: round2(allAvg), last5Avg: round2(last5Avg), trend, trendPct: round1(trendPct), prediction };
}

// ── Strengths / weaknesses detection ─────────────────────────────────────────

function detectStrengthsWeaknesses(rows: StatRow[], goalImpact: GoalImpact): { strengths: string[]; weaknesses: string[] } {
  const strengths: string[] = [];
  const weaknesses: string[] = [];

  const find = (label: string) => rows.find(r => r.label.toLowerCase().includes(label.toLowerCase()));

  const corners = find("corner");
  const shots   = find("shots on");
  const bigChance = find("big chance created") || find("big chance");
  const xg      = find("expected");
  const saves   = find("saves") || find("goalkeeper");
  const clear   = find("clearance");
  const fouls   = find("fouls");
  const inter   = find("interception");
  const passes  = find("passes");

  if (goalImpact.scoredPg >= 1.5) strengths.push("High goal output");
  else if (goalImpact.scoredPg < 0.8) weaknesses.push("Low goal output");

  if (goalImpact.concededPg <= 0.9) strengths.push("Solid defensive record");
  else if (goalImpact.concededPg >= 1.8) weaknesses.push("Leaks goals regularly");

  if (goalImpact.cleanSheetPct >= 30) strengths.push("Frequent clean sheets");
  if (goalImpact.bttsPct >= 60) weaknesses.push("Prone to BTTS");
  if (goalImpact.over25Pct >= 60) strengths.push("High-scoring matches");

  if (corners && corners.allAvg >= 5.5)  strengths.push("Corner box dominance");
  if (shots   && shots.allAvg >= 5.0)    strengths.push("High volume of shots");
  if (shots   && shots.allAvg < 2.5)     weaknesses.push("Low shots on target");
  if (bigChance && bigChance.allAvg >= 2.0) strengths.push("Creates big chances");
  if (bigChance && bigChance.allAvg < 0.8)  weaknesses.push("Few big chances created");
  if (xg && xg.allAvg >= 1.3)            strengths.push("Strong xG generation");
  if (saves && saves.allAvg >= 3.5)      strengths.push("Active shot-stopping");
  if (clear && clear.allAvg >= 15)       strengths.push("Strong defensive clearances");
  if (inter && inter.allAvg >= 15)       strengths.push("High interception rate");
  if (passes && passes.allAvg >= 450)    strengths.push("Possession-based play");
  if (fouls  && fouls.allAvg >= 14)      weaknesses.push("Foul-prone — card risk");

  return { strengths: strengths.slice(0, 4), weaknesses: weaknesses.slice(0, 4) };
}

// ── Overtune / undertune engine ───────────────────────────────────────────────

function buildOvertune(results: BETeamResult[] | SHMatchStatRow[], totalGames: number): OvertuneEngine {
  const notes: string[] = [];
  let overtuneCapacity = 50;
  let undertuneRisk    = 50;
  let adaptationLevel  = 50;

  const simpleResults = (results as BETeamResult[]).map ? (results as BETeamResult[]) : [];

  if (simpleResults.length >= 5) {
    // Analyze: after a loss, does scoring improve in the next match?
    let afterLossGoals = 0, afterLossCount = 0;
    let afterWinGoals  = 0, afterWinCount  = 0;

    for (let i = 1; i < simpleResults.length; i++) {
      const prev = simpleResults[i - 1];
      const curr = simpleResults[i];
      if (prev.result === "L") {
        afterLossGoals += curr.goalsScored;
        afterLossCount++;
      }
      if (prev.result === "W") {
        afterWinGoals += curr.goalsScored;
        afterWinCount++;
      }
    }

    const avgOverall = mean(simpleResults.map(r => r.goalsScored));
    const avgAfterLoss = afterLossCount > 0 ? afterLossGoals / afterLossCount : avgOverall;
    const avgAfterWin  = afterWinCount  > 0 ? afterWinGoals  / afterWinCount  : avgOverall;

    if (avgAfterLoss > avgOverall * 1.1) {
      overtuneCapacity = clamp(60 + Math.round((avgAfterLoss / avgOverall - 1) * 200), 50, 95);
      notes.push("Responds positively after losses");
      notes.push("Attack improves vs stronger opponents");
    } else {
      overtuneCapacity = clamp(40 - Math.round((1 - avgAfterLoss / avgOverall) * 100), 15, 50);
      notes.push("Struggles when conceding first");
      notes.push("Low resilience after defeats");
    }

    if (avgAfterWin < avgOverall * 0.9) {
      undertuneRisk = clamp(60 + Math.round((1 - avgAfterWin / avgOverall) * 200), 50, 85);
      notes.push("Performance drops after good results");
      notes.push("Goals scored remain unstable");
    } else {
      undertuneRisk = clamp(35, 20, 50);
      notes.push("Wins rarely create momentum drop");
    }

    // Count consecutive patterns
    let streak = 1;
    for (let i = 1; i < simpleResults.length; i++) {
      if (simpleResults[i].result === simpleResults[i - 1].result) streak++;
      else { streak = 1; }
    }
    if (streak >= 3) {
      notes.push(`Momentum grows in streaks (current: ${streak})`);
    }

    adaptationLevel = clamp(Math.round((overtuneCapacity + (100 - undertuneRisk)) / 2), 20, 90);
  }

  return {
    adaptationLevel,
    overtuneCapacity,
    undertuneRisk,
    notes: notes.slice(0, 4),
  };
}

// ── Dynamic rating ────────────────────────────────────────────────────────────

function buildDynamicRating(
  formRating: number,
  dnaScan: DnaScan,
  goalImpact: GoalImpact,
  overtune: OvertuneEngine,
): DynamicRating {
  const attack    = dnaScan.attackPower;
  const defense   = dnaScan.defensiveStability;
  const momentum  = dnaScan.momentumIndex;
  const adaptation = overtune.adaptationLevel;
  const recovery  = dnaScan.recoveryAfterDefeat;
  const psychology = clamp(Math.round((formRating * 0.6 + adaptation * 0.4)), 15, 95);
  const overall   = clamp(Math.round(
    formRating * 0.20 + attack * 0.20 + defense * 0.20 +
    momentum * 0.15 + psychology * 0.10 + adaptation * 0.10 + recovery * 0.05
  ), 15, 95);

  return {
    overall,
    form:       formRating,
    attack,
    defense,
    psychology,
    momentum,
    adaptation,
    recovery,
  };
}

// ── Pressure response index ───────────────────────────────────────────────────

function calcPressureScore(results: BETeamResult[]): number {
  if (results.length < 3) return 50;
  // How often does the team score after conceding in the first half?
  // Approximation: in matches where they conceded (lost), what % did they still score?
  const concededMatches = results.filter(r => r.goalsConceded > 0);
  if (!concededMatches.length) return 80;
  const scored = concededMatches.filter(r => r.goalsScored > 0).length;
  const baseScore = clamp(Math.round((scored / concededMatches.length) * 100), 20, 90);

  // Bonus for comeback wins (lost then won overall? Can't tell from aggregate...)
  // Instead use: recovery = wins in matches where also conceded
  const recoveries = concededMatches.filter(r => r.result === "W").length;
  const recoveryBonus = Math.round((recoveries / concededMatches.length) * 20);
  return clamp(baseScore + recoveryBonus, 20, 95);
}

// ── DNA scan builder ──────────────────────────────────────────────────────────

function buildDnaScan(
  formRating: number,
  avgScored: number,
  avgConceded: number,
  scoredL5: number,
  concededL5: number,
  bttsPct: number,
  form: ("W" | "D" | "L")[],
  statRows: StatRow[],
  pressureScore: number,
): DnaScan {
  const attackPower = clamp(Math.round(
    avgScored * 25 +
    (scoredL5 / (avgScored + 0.1) - 1) * 20 +
    formRating * 0.3 +
    10
  ), 15, 95);

  const defensiveStability = clamp(Math.round(
    (1.5 - avgConceded) * 35 +
    (1 - concededL5 / (avgConceded + 0.1)) * 15 +
    50
  ), 15, 95);

  const wins = form.filter(f => f === "W").length;
  const momentumIndex = clamp(Math.round(
    (wins / (form.length || 1)) * 70 + 15
  ), 15, 95);

  // Adaptation = how much stats vary per stat row
  const impacts = statRows.map(r => Math.abs(r.impact));
  const avgImpact = mean(impacts);
  const adaptationScore = clamp(Math.round(50 + avgImpact * 2), 20, 85);

  const recoveryAfterDefeat = clamp(pressureScore, 15, 95);

  const goalThreatIndex = clamp(Math.round(
    attackPower * 0.6 +
    (bttsPct > 0 ? bttsPct * 0.4 : momentumIndex * 0.4)
  ), 15, 95);

  const matchControlRating = clamp(Math.round(
    (defensiveStability + momentumIndex) / 2 * 0.8 + formRating * 0.2
  ), 15, 95);

  return {
    formRating,
    attackPower,
    defensiveStability,
    momentumIndex,
    adaptationScore,
    recoveryAfterDefeat,
    goalThreatIndex,
    matchControlRating,
  };
}

// ── SHMatchStatRow overtune adapter ───────────────────────────────────────────

function shResultsToBEResults(shGoalsRows: SHMatchStatRow[]): BETeamResult[] {
  return shGoalsRows.map(r => ({
    result: r.result,
    isHome: true, // approximate
    goalsScored: r.myValue,
    goalsConceded: r.opponentValue,
    opponent: "",
  }));
}

// ── Main builder: StatsHub ────────────────────────────────────────────────────

function buildSHTeam(name: string, shData: SHTeamStatHistory): WizardTeam {
  const sh = shData;
  const statHistory = sh.statHistory || [];

  // Find goals stat
  const goalsStat = statHistory.find(s => s.key === "_goals_from_score" || s.label === "Goals");
  const goalsMatches = goalsStat?.matches ?? [];

  const allGoalsScored     = goalsMatches.map(m => m.myValue);
  const allGoalsConceded   = goalsMatches.map(m => m.opponentValue);
  const last5GoalsScored   = allGoalsScored.slice(0, 5);
  const last5GoalsConceded = allGoalsConceded.slice(0, 5);

  const avgScored   = mean(allGoalsScored);
  const avgConceded = mean(allGoalsConceded);
  const scoredL5    = mean(last5GoalsScored);
  const concededL5  = mean(last5GoalsConceded);

  const form = goalsMatches.slice(0, 10).map(m => m.result);
  const formRating = calcFormRating(form);

  // Goal impact stats
  const totalGames = goalsMatches.length;
  const cleanSheets = goalsMatches.filter(m => m.opponentValue === 0).length;
  const bttsGames   = goalsMatches.filter(m => m.myValue > 0 && m.opponentValue > 0).length;
  const over25Games = goalsMatches.filter(m => m.myValue + m.opponentValue > 2.5).length;

  const goalImpact: GoalImpact = {
    scored:        allGoalsScored.reduce((s, v) => s + v, 0),
    scoredPg:      round2(avgScored),
    conceded:      allGoalsConceded.reduce((s, v) => s + v, 0),
    concededPg:    round2(avgConceded),
    cleanSheets,
    cleanSheetPct: totalGames > 0 ? Math.round(cleanSheets / totalGames * 100) : 0,
    btts:          bttsGames,
    bttsPct:       totalGames > 0 ? Math.round(bttsGames   / totalGames * 100) : 0,
    over25:        over25Games,
    over25Pct:     totalGames > 0 ? Math.round(over25Games / totalGames * 100) : 0,
    totalGames,
  };

  // Build stat rows for all available stats
  const statRows: StatRow[] = statHistory
    .filter(s => s.matches.length > 0)
    .map(s => {
      const allVals  = s.matches.map(m => m.myValue);
      const last5    = allVals.slice(0, 5);
      const allAvg   = round2(mean(allVals));
      const last5Avg = round2(mean(last5));
      const impact   = round1(allAvg > 0 ? ((last5Avg - allAvg) / allAvg) * 100 : 0);
      // Rating/100: normalize based on typical values per stat
      const rating   = clamp(Math.round(Math.min(allAvg * 8, 95)), 5, 95);
      const adj      = round1(impact * 0.025);
      return { label: s.label, allAvg, last5Avg, rating, impact, adjustment: adj };
    });

  const goalInsight = buildGoalInsight(avgScored, scoredL5, form);

  // Goal evolution (compare first half vs second half of data)
  const half = Math.floor(goalsMatches.length / 2);
  const firstHalfScore = mean(goalsMatches.slice(half).map(m => m.myValue));
  const lastHalfScore  = mean(goalsMatches.slice(0, half || 1).map(m => m.myValue));
  const attackEvo  = firstHalfScore > 0 ? round1(((lastHalfScore - firstHalfScore) / firstHalfScore) * 100) : 0;

  const firstHalfConc = mean(goalsMatches.slice(half).map(m => m.opponentValue));
  const lastHalfConc  = mean(goalsMatches.slice(0, half || 1).map(m => m.opponentValue));
  const defenseEvo = firstHalfConc > 0 ? round1(-((lastHalfConc - firstHalfConc) / firstHalfConc) * 100) : 0;

  const netTrend: "improving" | "declining" | "stable" =
    (attackEvo + defenseEvo) > 10 ? "improving" : (attackEvo + defenseEvo) < -10 ? "declining" : "stable";

  const goalEvolution: GoalEvolution = {
    goalsScored: goalImpact.scored,
    goalsConceded: goalImpact.conceded,
    attackEvolution: attackEvo,
    defenseEvolution: defenseEvo,
    netTrend,
  };

  // Convert SH rows to BETeamResult-like for overtune
  const beResults = shResultsToBEResults(goalsMatches);
  const overtuneEngine = buildOvertune(beResults, totalGames);

  const pressureScore = calcPressureScore(beResults);

  const { strengths, weaknesses } = detectStrengthsWeaknesses(statRows, goalImpact);

  const dnaScan = buildDnaScan(
    formRating, avgScored, avgConceded, scoredL5, concededL5,
    goalImpact.bttsPct, form, statRows, pressureScore
  );

  const dynamicRating = buildDynamicRating(formRating, dnaScan, goalImpact, overtuneEngine);

  return {
    name,
    formRating,
    form: form.slice(0, 9),
    dnaScan,
    goalInsight,
    goalImpact,
    goalEvolution,
    overtuneEngine,
    pressureScore,
    dynamicRating,
    statRows: statRows.slice(0, 16),
    strengths,
    weaknesses,
  };
}

// ── Main builder: BetExplorer ─────────────────────────────────────────────────

function buildBETeam(name: string, beData: BETeamStats): WizardTeam {
  const form = (beData.form ?? []).slice(0, 9);
  const formRating = calcFormRating(form);

  const avgScored   = beData.avgGoalsScored   ?? 0;
  const avgConceded = beData.avgGoalsConceded ?? 0;
  const scoredL5    = beData.avgGoalsScoredL5   ?? avgScored;
  const concededL5  = beData.avgGoalsConcededL5 ?? avgConceded;
  const totalGames  = beData.totalGames ?? form.length;

  const cleanSheets    = beData.cleanSheets    ?? 0;
  const cleanSheetPct  = beData.cleanSheetsPct ?? 0;
  const bttsPct        = beData.bttsPct ?? 0;

  // Estimate BTTS and over 2.5 counts
  const btts   = Math.round(bttsPct   / 100 * totalGames);
  const over25 = Math.round((bttsPct + 10) / 100 * totalGames); // approximation

  const goalImpact: GoalImpact = {
    scored:       Math.round(avgScored * totalGames),
    scoredPg:     round2(avgScored),
    conceded:     Math.round(avgConceded * totalGames),
    concededPg:   round2(avgConceded),
    cleanSheets,
    cleanSheetPct,
    btts,
    bttsPct,
    over25,
    over25Pct: Math.round((bttsPct + 10)),
    totalGames,
  };

  const goalInsight = buildGoalInsight(avgScored, scoredL5, form);

  // Stat rows from BE aggregated data
  const statRows: StatRow[] = [
    { label: "Goals Scored",    allAvg: round2(avgScored),         last5Avg: round2(scoredL5),   rating: clamp(Math.round(avgScored * 30 + 20), 5, 95), impact: round1(avgScored > 0 ? ((scoredL5 - avgScored) / avgScored) * 100 : 0), adjustment: 0 },
    { label: "Goals Conceded",  allAvg: round2(avgConceded),       last5Avg: round2(concededL5), rating: clamp(100 - Math.round(avgConceded * 30), 5, 95), impact: round1(avgConceded > 0 ? ((concededL5 - avgConceded) / avgConceded) * -100 : 0), adjustment: 0 },
    { label: "Clean Sheets",    allAvg: round2(cleanSheets / Math.max(1, totalGames) * 10), last5Avg: round2(cleanSheetPct / 10), rating: Math.round(cleanSheetPct), impact: 0, adjustment: 0 },
    { label: "BTTS %",          allAvg: bttsPct,                   last5Avg: bttsPct,            rating: Math.round(bttsPct), impact: 0, adjustment: 0 },
    { label: "Scored (Home)",   allAvg: round2(beData.avgGoalsScoredHome ?? avgScored),   last5Avg: round2(beData.avgGoalsScoredHome ?? avgScored), rating: 50, impact: 0, adjustment: 0 },
    { label: "Scored (Away)",   allAvg: round2(beData.avgGoalsScoredAway ?? avgScored),   last5Avg: round2(beData.avgGoalsScoredAway ?? avgScored), rating: 50, impact: 0, adjustment: 0 },
    { label: "Conceded (Home)", allAvg: round2(beData.avgGoalsConcededHome ?? avgConceded), last5Avg: round2(beData.avgGoalsConcededHome ?? avgConceded), rating: 50, impact: 0, adjustment: 0 },
    { label: "Conceded (Away)", allAvg: round2(beData.avgGoalsConcededAway ?? avgConceded), last5Avg: round2(beData.avgGoalsConcededAway ?? avgConceded), rating: 50, impact: 0, adjustment: 0 },
  ].map(r => ({ ...r, adjustment: round1(r.impact * 0.025) }));

  // Goal evolution from results history
  const results = beData.results ?? [];
  const half = Math.floor(results.length / 2);
  const firstHalfScore = mean(results.slice(half).map(r => r.goalsScored));
  const lastHalfScore  = mean(results.slice(0, half || 1).map(r => r.goalsScored));
  const attackEvo  = firstHalfScore > 0 ? round1(((lastHalfScore - firstHalfScore) / firstHalfScore) * 100) : 0;

  const firstHalfConc = mean(results.slice(half).map(r => r.goalsConceded));
  const lastHalfConc  = mean(results.slice(0, half || 1).map(r => r.goalsConceded));
  const defenseEvo = firstHalfConc > 0 ? round1(-((lastHalfConc - firstHalfConc) / firstHalfConc) * 100) : 0;
  const netTrend: "improving" | "declining" | "stable" =
    (attackEvo + defenseEvo) > 10 ? "improving" : (attackEvo + defenseEvo) < -10 ? "declining" : "stable";

  const goalEvolution: GoalEvolution = {
    goalsScored:   goalImpact.scored,
    goalsConceded: goalImpact.conceded,
    attackEvolution: attackEvo,
    defenseEvolution: defenseEvo,
    netTrend,
  };

  const overtuneEngine = buildOvertune(results, totalGames);
  const pressureScore  = calcPressureScore(results);

  const { strengths, weaknesses } = detectStrengthsWeaknesses(statRows, goalImpact);

  const dnaScan = buildDnaScan(
    formRating, avgScored, avgConceded, scoredL5, concededL5,
    bttsPct, form, statRows, pressureScore
  );

  const dynamicRating = buildDynamicRating(formRating, dnaScan, goalImpact, overtuneEngine);

  return {
    name,
    formRating,
    form: form.slice(0, 9),
    dnaScan,
    goalInsight,
    goalImpact,
    goalEvolution,
    overtuneEngine,
    pressureScore,
    dynamicRating,
    statRows,
    strengths,
    weaknesses,
  };
}

// ── Wizard verdict ────────────────────────────────────────────────────────────

function buildVerdict(
  home: WizardTeam,
  away: WizardTeam,
  sim: SimulationResult,
): WizardVerdict {
  const advantages: Array<{ team: "home" | "away"; label: string }> = [];

  if (home.dnaScan.attackPower > away.dnaScan.attackPower + 8)
    advantages.push({ team: "home", label: "Attack Advantage" });
  else if (away.dnaScan.attackPower > home.dnaScan.attackPower + 8)
    advantages.push({ team: "away", label: "Attack Advantage" });

  if (home.dnaScan.defensiveStability > away.dnaScan.defensiveStability + 8)
    advantages.push({ team: "home", label: "Defensive Advantage" });
  else if (away.dnaScan.defensiveStability > home.dnaScan.defensiveStability + 8)
    advantages.push({ team: "away", label: "Defensive Advantage" });

  if (home.formRating > away.formRating + 10)
    advantages.push({ team: "home", label: "Form Advantage" });
  else if (away.formRating > home.formRating + 10)
    advantages.push({ team: "away", label: "Form Advantage" });

  if (home.overtuneEngine.overtuneCapacity > away.overtuneEngine.overtuneCapacity + 10)
    advantages.push({ team: "home", label: "Momentum Advantage" });
  else if (away.overtuneEngine.overtuneCapacity > home.overtuneEngine.overtuneCapacity + 10)
    advantages.push({ team: "away", label: "Momentum Advantage" });

  if (home.goalInsight.trend === "above")
    advantages.push({ team: "home", label: "Scoring Surge" });
  if (away.goalInsight.trend === "above")
    advantages.push({ team: "away", label: "Scoring Surge" });

  if (home.dynamicRating.overall > away.dynamicRating.overall + 5)
    advantages.push({ team: "home", label: "Psychological Advantage" });
  else if (away.dynamicRating.overall > home.dynamicRating.overall + 5)
    advantages.push({ team: "away", label: "Psychological Advantage" });

  // Determine edge
  const homeScore = home.dynamicRating.overall;
  const awayScore = away.dynamicRating.overall;
  const gap = homeScore - awayScore;

  let edge: "home" | "away" | "draw" | "x2";
  let recommendation: string;
  let wizardPrediction: string;

  if (Math.abs(gap) <= 4) {
    edge = "draw";
    recommendation = "Evenly matched — draw is possible";
    wizardPrediction = `${home.name} OR DRAW (X2)`;
  } else if (gap > 4) {
    if (sim.homeWin > 0.45) {
      edge = "home";
      recommendation = `${home.name} holds data edge (${homeScore} vs ${awayScore})`;
      wizardPrediction = `${home.name} TO WIN`;
    } else {
      edge = "x2";
      recommendation = "Slight home edge but away resilience noted";
      wizardPrediction = `${home.name} WIN OR DRAW (1X)`;
    }
  } else {
    if (sim.awayWin > 0.4) {
      edge = "away";
      recommendation = `${away.name} holds data edge (${awayScore} vs ${homeScore})`;
      wizardPrediction = `${away.name} TO WIN`;
    } else {
      edge = "x2";
      recommendation = "Away data advantage — double chance recommended";
      wizardPrediction = `${away.name} TO WIN OR DRAW (X2)`;
    }
  }

  const confidenceLevel = clamp(Math.round(
    50 + Math.abs(gap) * 2 + advantages.length * 4 + Math.abs(sim.homeWin - sim.awayWin) * 30
  ), 40, 94);

  return { recommendation, edge, confidenceLevel, advantages, wizardPrediction };
}

// ── Main entry point ──────────────────────────────────────────────────────────

export function analyzeMatch(params: {
  homeName: string;
  awayName: string;
  homeTeamStatsJson:   string | null;
  awayTeamStatsJson:   string | null;
  beHomeStatsJson:     string | null;
  beAwayStatsJson:     string | null;
}): WizardOutput {
  const {
    homeName, awayName,
    homeTeamStatsJson, awayTeamStatsJson,
    beHomeStatsJson, beAwayStatsJson,
  } = params;

  function safe<T>(json: string | null): T | null {
    if (!json) return null;
    try { return JSON.parse(json) as T; } catch { return null; }
  }

  const shHome = safe<SHTeamStatHistory>(homeTeamStatsJson);
  const shAway = safe<SHTeamStatHistory>(awayTeamStatsJson);
  const beHome = safe<BETeamStats>(beHomeStatsJson);
  const beAway = safe<BETeamStats>(beAwayStatsJson);

  let dataSource: WizardOutput["dataSource"] = "minimal";
  let homeTeam: WizardTeam;
  let awayTeam: WizardTeam;

  if (shHome && shHome.statHistory?.length > 0) {
    dataSource = "statshub";
    homeTeam = buildSHTeam(homeName, shHome);
    if (shAway && shAway.statHistory?.length > 0) {
      awayTeam = buildSHTeam(awayName, shAway);
    } else if (beAway) {
      awayTeam = buildBETeam(awayName, beAway);
    } else {
      awayTeam = buildBETeam(awayName, { avgGoalsScored: 1.1, avgGoalsConceded: 1.3, avgGoalsScoredL5: 1.0, avgGoalsConcededL5: 1.2, avgGoalsScoredHome: 1.1, avgGoalsConcededHome: 1.2, avgGoalsScoredAway: 1.0, avgGoalsConcededAway: 1.4, cleanSheets: 2, cleanSheetsPct: 25, bttsPct: 48, form: [], wins: 0, draws: 0, losses: 0, totalGames: 0, results: [] });
    }
  } else if (beHome) {
    dataSource = "betexplorer";
    homeTeam = buildBETeam(homeName, beHome);
    if (beAway) {
      awayTeam = buildBETeam(awayName, beAway);
    } else {
      awayTeam = buildBETeam(awayName, { avgGoalsScored: 1.1, avgGoalsConceded: 1.3, avgGoalsScoredL5: 1.0, avgGoalsConcededL5: 1.2, avgGoalsScoredHome: 1.1, avgGoalsConcededHome: 1.2, avgGoalsScoredAway: 1.0, avgGoalsConcededAway: 1.4, cleanSheets: 2, cleanSheetsPct: 25, bttsPct: 48, form: [], wins: 0, draws: 0, losses: 0, totalGames: 0, results: [] });
    }
  } else {
    // Minimal fallback
    const mkMinimal = (name: string): WizardTeam => buildBETeam(name, {
      avgGoalsScored: 1.2, avgGoalsConceded: 1.2, avgGoalsScoredL5: 1.2, avgGoalsConcededL5: 1.2,
      avgGoalsScoredHome: 1.2, avgGoalsConcededHome: 1.2, avgGoalsScoredAway: 1.2, avgGoalsConcededAway: 1.2,
      cleanSheets: 2, cleanSheetsPct: 20, bttsPct: 50, form: [], wins: 0, draws: 0, losses: 0, totalGames: 0, results: [],
    });
    homeTeam = mkMinimal(homeName);
    awayTeam = mkMinimal(awayName);
  }

  // Poisson lambdas: home attack × away defense factor
  const lambdaHome = clamp(
    homeTeam.goalImpact.scoredPg * (1 + (homeTeam.goalInsight.trendPct / 200)) *
    (1 + (awayTeam.goalImpact.concededPg - 1) * 0.3),
    0.2, 5
  );
  const lambdaAway = clamp(
    awayTeam.goalImpact.scoredPg * (1 + (awayTeam.goalInsight.trendPct / 200)) *
    (1 + (homeTeam.goalImpact.concededPg - 1) * 0.3),
    0.2, 5
  );

  const { result: simulation, scoreMatrix } = runSimulation(lambdaHome, lambdaAway, 10000);
  const mostLikelyScores = topScores(scoreMatrix, 10000);
  const verdict = buildVerdict(homeTeam, awayTeam, simulation);

  return {
    dataSource,
    homeTeam,
    awayTeam,
    matchup: { simulation, mostLikelyScores, lambdaHome: round2(lambdaHome), lambdaAway: round2(lambdaAway), verdict },
    generatedAt: Date.now(),
  };
}
