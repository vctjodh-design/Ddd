/**
 * ML Prediction Model — Poisson (statistical) + Random Forest ensemble.
 * Predicts 1X2, DC, BTTS, Correct Score, and Total Corners.
 * Identifies value bets by comparing model probability to bookmaker implied odds.
 */
import { RandomForestClassifier } from "ml-random-forest";
import { getDb } from "./db.js";

// ── Internal types ────────────────────────────────────────────────────────────

interface SHMatchRow {
  myValue: number;
  opponentValue: number;
  result: "W" | "D" | "L";
  date?: string;
}

interface SHStatHistory {
  key: string;
  label: string;
  matches: SHMatchRow[];
}

interface SHTeamStats {
  teamId: number;
  possession: number;
  statHistory: SHStatHistory[];
}

interface OddsEntry {
  bookmaker: string;
  odds: (number | null)[];
  line?: number;
}

interface PlayerEntry {
  position?: string;
  isSubstitute?: boolean;
  rating?: number;
  goals?: number;
}

interface PlayerGame {
  matchTs?: number;
  players: PlayerEntry[];
}

// ── Low-level math ────────────────────────────────────────────────────────────

function safeJson<T>(s: string | null | undefined): T | null {
  if (!s) return null;
  try { return JSON.parse(s) as T; } catch { return null; }
}

function poissonPMF(lambda: number, k: number): number {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  if (k > 20) return 0;
  let logP = -lambda + k * Math.log(lambda);
  for (let i = 1; i <= k; i++) logP -= Math.log(i);
  return Math.exp(logP);
}

function erf(x: number): number {
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741;
  const a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x);
  const t = 1 / (1 + p * x);
  const y = 1 - (((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-x * x));
  return sign * y;
}

function normalCDF(x: number, mean: number, std: number): number {
  if (std <= 0) return x >= mean ? 1 : 0;
  return 0.5 * (1 + erf((x - mean) / (std * Math.SQRT2)));
}

// ── Stat helpers ──────────────────────────────────────────────────────────────

function findStat(ts: SHTeamStats | null, ...labels: string[]): SHStatHistory | null {
  if (!ts?.statHistory) return null;
  for (const label of labels) {
    const s = ts.statHistory.find(h => h.label.toLowerCase().includes(label.toLowerCase()));
    if (s?.matches.length) return s;
  }
  return null;
}

function statAvg(stat: SHStatHistory | null, field: "myValue" | "opponentValue", n?: number): number {
  if (!stat?.matches.length) return 0;
  const ms = n ? stat.matches.slice(0, n) : stat.matches;
  if (!ms.length) return 0;
  return ms.reduce((s, m) => s + (m[field] ?? 0), 0) / ms.length;
}

function formCount(stat: SHStatHistory | null, r: "W" | "D" | "L", n = 5): number {
  if (!stat?.matches.length) return 0;
  return stat.matches.slice(0, n).filter(m => m.result === r).length;
}

// ── Odds helpers ──────────────────────────────────────────────────────────────

function parseOdds(json: string | null | undefined): OddsEntry[] {
  return safeJson<OddsEntry[]>(json ?? null) ?? [];
}

function bestOdd(entries: OddsEntry[], idx: number): number | null {
  let best: number | null = null;
  for (const e of entries) {
    const v = e.odds[idx];
    if (v && v > 0 && (best === null || v > best)) best = v;
  }
  return best;
}

function oddsToProb(odds: number | null): number {
  return odds && odds > 0 ? 1 / odds : 0;
}

function deVig(probs: number[]): number[] {
  const sum = probs.reduce((a, b) => a + b, 0);
  return sum > 0 ? probs.map(p => p / sum) : probs.map(() => 0);
}

function avgPlayerRating(games: PlayerGame[] | null): number {
  if (!games?.length) return 0;
  const game = games[0];
  const starters = (game?.players ?? []).filter(p => !p.isSubstitute && (p.rating ?? 0) > 0);
  if (!starters.length) return 0;
  return starters.reduce((s, p) => s + (p.rating ?? 0), 0) / starters.length;
}

// ── Feature extraction ────────────────────────────────────────────────────────

export interface MatchFeatures {
  oddsHome: number; oddsDraw: number; oddsAway: number;
  oddsBttsY: number; oddsOver25: number;
  homeGoalsAvg: number; homeGoalsConcAvg: number;
  homeGoalsL5: number; homeGoalsConcL5: number;
  homeCornersAvg: number; homeCornersL5: number;
  homeShotsAvg: number; homeXgAvg: number;
  homeFormW: number; homeFormD: number; homeFormL: number;
  homePossession: number;
  awayGoalsAvg: number; awayGoalsConcAvg: number;
  awayGoalsL5: number; awayGoalsConcL5: number;
  awayCornersAvg: number; awayCornersL5: number;
  awayShotsAvg: number; awayXgAvg: number;
  awayFormW: number; awayFormD: number; awayFormL: number;
  awayPossession: number;
  homeRating: number; awayRating: number;
}

type MatchLike = {
  home_team_stats_json?: string | null;
  away_team_stats_json?: string | null;
  home_stats_json?: string | null;
  away_stats_json?: string | null;
  home_player_stats_json?: string | null;
  away_player_stats_json?: string | null;
  po_1x2_json?: string | null;
  odds_1x2_json?: string | null;
  po_btts_json?: string | null;
  odds_btts_json?: string | null;
  po_ou_json?: string | null;
  odds_ou_json?: string | null;
  po_dc_json?: string | null;
  odds_dc_json?: string | null;
};

export function extractFeatures(m: MatchLike): MatchFeatures {
  const hs = safeJson<SHTeamStats>(m.home_team_stats_json ?? m.home_stats_json ?? null);
  const as_ = safeJson<SHTeamStats>(m.away_team_stats_json ?? m.away_stats_json ?? null);

  const hG  = findStat(hs,  "Goals", "Goal");
  const aG  = findStat(as_, "Goals", "Goal");
  const hC  = findStat(hs,  "Corner Kicks", "Corners", "Corner");
  const aC  = findStat(as_, "Corner Kicks", "Corners", "Corner");
  const hS  = findStat(hs,  "Shots on Target", "Total Shots", "Shots");
  const aS  = findStat(as_, "Shots on Target", "Total Shots", "Shots");
  const hXG = findStat(hs,  "Expected Goals", "xG");
  const aXG = findStat(as_, "Expected Goals", "xG");

  const ox = parseOdds(m.po_1x2_json ?? m.odds_1x2_json);
  const ob = parseOdds(m.po_btts_json ?? m.odds_btts_json);
  const ou = parseOdds(m.po_ou_json ?? m.odds_ou_json);

  const [homeI, drawI, awayI] = deVig([oddsToProb(bestOdd(ox,0)), oddsToProb(bestOdd(ox,1)), oddsToProb(bestOdd(ox,2))]);
  const [bttsYI] = deVig([oddsToProb(bestOdd(ob,0)), oddsToProb(bestOdd(ob,1))]);
  const ou25 = ou.find(e => e.line != null && Math.abs((e.line as number) - 2.5) < 0.01);
  const [overI] = ou25
    ? deVig([oddsToProb(ou25.odds[0] ?? null), oddsToProb(ou25.odds[1] ?? null)])
    : [0];

  const hp = safeJson<PlayerGame[]>(m.home_player_stats_json ?? null);
  const ap = safeJson<PlayerGame[]>(m.away_player_stats_json ?? null);

  return {
    oddsHome: homeI ?? 0, oddsDraw: drawI ?? 0, oddsAway: awayI ?? 0,
    oddsBttsY: bttsYI ?? 0, oddsOver25: overI ?? 0,
    homeGoalsAvg: statAvg(hG, "myValue"), homeGoalsConcAvg: statAvg(hG, "opponentValue"),
    homeGoalsL5: statAvg(hG, "myValue", 5), homeGoalsConcL5: statAvg(hG, "opponentValue", 5),
    homeCornersAvg: statAvg(hC, "myValue"), homeCornersL5: statAvg(hC, "myValue", 5),
    homeShotsAvg: statAvg(hS, "myValue"), homeXgAvg: statAvg(hXG, "myValue"),
    homeFormW: formCount(hG, "W"), homeFormD: formCount(hG, "D"), homeFormL: formCount(hG, "L"),
    homePossession: hs?.possession ?? 50,
    awayGoalsAvg: statAvg(aG, "myValue"), awayGoalsConcAvg: statAvg(aG, "opponentValue"),
    awayGoalsL5: statAvg(aG, "myValue", 5), awayGoalsConcL5: statAvg(aG, "opponentValue", 5),
    awayCornersAvg: statAvg(aC, "myValue"), awayCornersL5: statAvg(aC, "myValue", 5),
    awayShotsAvg: statAvg(aS, "myValue"), awayXgAvg: statAvg(aXG, "myValue"),
    awayFormW: formCount(aG, "W"), awayFormD: formCount(aG, "D"), awayFormL: formCount(aG, "L"),
    awayPossession: as_?.possession ?? 50,
    homeRating: avgPlayerRating(hp), awayRating: avgPlayerRating(ap),
  };
}

function toVector(f: MatchFeatures): number[] {
  return [
    f.oddsHome, f.oddsDraw, f.oddsAway, f.oddsBttsY, f.oddsOver25,
    f.homeGoalsAvg, f.homeGoalsConcAvg, f.homeGoalsL5, f.homeGoalsConcL5,
    f.homeCornersAvg, f.homeCornersL5, f.homeShotsAvg, f.homeXgAvg,
    f.homeFormW, f.homeFormD, f.homeFormL, f.homePossession,
    f.awayGoalsAvg, f.awayGoalsConcAvg, f.awayGoalsL5, f.awayGoalsConcL5,
    f.awayCornersAvg, f.awayCornersL5, f.awayShotsAvg, f.awayXgAvg,
    f.awayFormW, f.awayFormD, f.awayFormL, f.awayPossession,
    f.homeRating, f.awayRating,
  ];
}

// ── Poisson model ─────────────────────────────────────────────────────────────

const LEAGUE_GOALS_AVG = 1.35;
const MAX_GOALS = 8;

interface PoissonResult {
  lambdaHome: number;
  lambdaAway: number;
  homeWin: number; draw: number; awayWin: number;
  bttsYes: number; over25: number;
  correctScores: Array<{ home: number; away: number; prob: number }>;
}

function poissonPredict(f: MatchFeatures): PoissonResult {
  const hAtk = f.homeGoalsAvg > 0 ? f.homeGoalsAvg / LEAGUE_GOALS_AVG : 1.0;
  const hDef = f.homeGoalsConcAvg > 0 ? f.homeGoalsConcAvg / LEAGUE_GOALS_AVG : 1.0;
  const aAtk = f.awayGoalsAvg > 0 ? f.awayGoalsAvg / LEAGUE_GOALS_AVG : 1.0;
  const aDef = f.awayGoalsConcAvg > 0 ? f.awayGoalsConcAvg / LEAGUE_GOALS_AVG : 1.0;

  // Only apply home advantage multiplier when real goal stats exist.
  // Without stats both teams default to 1.0, so a fixed multiplier creates
  // artificial home bias on every no-data match.
  const hasStats = f.homeGoalsAvg > 0 || f.awayGoalsAvg > 0;
  const homeAdv  = hasStats ? 1.1  : 1.03;
  const awayDisadv = hasStats ? 0.9 : 0.97;

  const lH = Math.max(0.1, hAtk * aDef * LEAGUE_GOALS_AVG * homeAdv);
  const lA = Math.max(0.1, aAtk * hDef * LEAGUE_GOALS_AVG * awayDisadv);

  let homeWin = 0, draw = 0, awayWin = 0, btts = 0, over25 = 0;
  const scores: Array<{ home: number; away: number; prob: number }> = [];

  for (let h = 0; h <= MAX_GOALS; h++) {
    for (let a = 0; a <= MAX_GOALS; a++) {
      const p = poissonPMF(lH, h) * poissonPMF(lA, a);
      if (h > a) homeWin += p;
      else if (h === a) draw += p;
      else awayWin += p;
      if (h > 0 && a > 0) btts += p;
      if (h + a > 2.5) over25 += p;
      if (p > 0.001) scores.push({ home: h, away: a, prob: p });
    }
  }

  scores.sort((a, b) => b.prob - a.prob);
  return { lambdaHome: lH, lambdaAway: lA, homeWin, draw, awayWin, bttsYes: btts, over25, correctScores: scores.slice(0, 12) };
}

// ── RF probability estimation (vote counting over trees) ──────────────────────

type AnyTree = { predict: (X: number[][]) => number[] };

function rfVoteProbs(rf: RandomForestClassifier, x: number[], classes: number[]): number[] {
  const estimators = (rf as unknown as { estimators: AnyTree[] }).estimators;
  if (!estimators?.length) {
    const pred = (rf.predict([x]) as number[])[0];
    return classes.map(c => c === pred ? 1 : 0);
  }
  const votes = new Map<number, number>();
  for (const tree of estimators) {
    const p = (tree.predict([x]) as number[])[0];
    votes.set(p, (votes.get(p) ?? 0) + 1);
  }
  const total = estimators.length;
  return classes.map(c => (votes.get(c) ?? 0) / total);
}

function blendProbs(a: number[], b: number[], wB: number): number[] {
  const wA = 1 - wB;
  const r = a.map((v, i) => wA * v + wB * (b[i] ?? 0));
  const sum = r.reduce((s, v) => s + v, 0);
  return sum > 0 ? r.map(v => v / sum) : r;
}

// ── Model persistence ─────────────────────────────────────────────────────────

interface StoredState {
  rf1x2: object | null;
  rfBtts: object | null;
  nSamples: number;
  accuracy1x2: number;
  accuracyBtts: number;
  trainedAt: number;
}

let _cachedState: StoredState | null | undefined = undefined;

function loadState(): StoredState | null {
  if (_cachedState !== undefined) return _cachedState;
  const db = getDb();
  const row = db.prepare("SELECT data_json FROM model_store WHERE name='main'").get() as { data_json: string } | undefined;
  if (!row) { _cachedState = null; return null; }
  try { _cachedState = JSON.parse(row.data_json) as StoredState; return _cachedState; }
  catch { _cachedState = null; return null; }
}

function saveState(s: StoredState) {
  _cachedState = s;
  const db = getDb();
  db.prepare(`
    INSERT INTO model_store (name, data_json, n_samples, trained_at)
    VALUES ('main', ?, ?, ?)
    ON CONFLICT(name) DO UPDATE SET
      data_json=excluded.data_json,
      n_samples=excluded.n_samples,
      trained_at=excluded.trained_at,
      updated_at=unixepoch()
  `).run(JSON.stringify(s), s.nSamples, s.trainedAt);
}

// ── Training ──────────────────────────────────────────────────────────────────

interface TrainingRow {
  home_team_stats_json?: string | null;
  away_team_stats_json?: string | null;
  home_stats_json?: string | null;
  away_stats_json?: string | null;
  home_player_stats_json?: string | null;
  away_player_stats_json?: string | null;
  po_1x2_json?: string | null;
  odds_1x2_json?: string | null;
  po_btts_json?: string | null;
  odds_btts_json?: string | null;
  po_ou_json?: string | null;
  odds_ou_json?: string | null;
  home_score: number;
  away_score: number;
}

export function trainModel(): { nSamples: number; accuracy1x2: number; accuracyBtts: number } {
  const db = getDb();

  const rows = db.prepare(`
    SELECT home_team_stats_json, away_team_stats_json,
           home_player_stats_json, away_player_stats_json,
           po_1x2_json, po_btts_json, po_ou_json,
           home_score, away_score
    FROM processing_matches
    WHERE home_score IS NOT NULL AND away_score IS NOT NULL
      AND (home_team_stats_json IS NOT NULL OR po_1x2_json IS NOT NULL)

    UNION ALL

    SELECT home_stats_json AS home_team_stats_json,
           away_stats_json AS away_team_stats_json,
           NULL AS home_player_stats_json,
           NULL AS away_player_stats_json,
           odds_1x2_json AS po_1x2_json,
           odds_btts_json AS po_btts_json,
           odds_ou_json AS po_ou_json,
           home_score, away_score
    FROM stored_matches
    WHERE home_score IS NOT NULL AND away_score IS NOT NULL
      AND (home_stats_json IS NOT NULL OR odds_1x2_json IS NOT NULL)
  `).all() as TrainingRow[];

  const X: number[][] = [];
  const y1x2: number[] = [];
  const yBtts: number[] = [];

  for (const row of rows) {
    const f = extractFeatures(row as MatchLike);
    const vec = toVector(f);
    if (vec.filter(v => v > 0).length < 2) continue;
    X.push(vec);
    const hs = row.home_score as number;
    const as_ = row.away_score as number;
    y1x2.push(hs > as_ ? 0 : hs === as_ ? 1 : 2);
    yBtts.push(hs > 0 && as_ > 0 ? 1 : 0);
  }

  if (X.length < 10) {
    const s: StoredState = { rf1x2: null, rfBtts: null, nSamples: X.length, accuracy1x2: 0, accuracyBtts: 0, trainedAt: Date.now() };
    saveState(s);
    return { nSamples: X.length, accuracy1x2: 0, accuracyBtts: 0 };
  }

  // 80/20 split for accuracy estimate
  const split = Math.floor(X.length * 0.8);
  const Xtr = X.slice(0, split), Xte = X.slice(split);
  const y1tr = y1x2.slice(0, split), y1te = y1x2.slice(split);
  const ybtr = yBtts.slice(0, split), ybte = yBtts.slice(split);

  const opts = { nEstimators: 100, maxFeatures: 0.7 as number | string, seed: 42 };
  const rf1x2eval = new RandomForestClassifier(opts);
  rf1x2eval.train(Xtr, y1tr);
  const rfBttsEval = new RandomForestClassifier(opts);
  rfBttsEval.train(Xtr, ybtr);

  let c1x2 = 0, cBtts = 0;
  if (Xte.length > 0) {
    const p1 = rf1x2eval.predict(Xte) as number[];
    const pb = rfBttsEval.predict(Xte) as number[];
    for (let i = 0; i < Xte.length; i++) {
      if (p1[i] === y1te[i]) c1x2++;
      if (pb[i] === ybte[i]) cBtts++;
    }
  }

  const acc1x2 = Xte.length > 0 ? Math.round((c1x2 / Xte.length) * 1000) / 10 : 0;
  const accBtts = Xte.length > 0 ? Math.round((cBtts / Xte.length) * 1000) / 10 : 0;

  // Retrain on full dataset for deployment
  const rf1x2 = new RandomForestClassifier(opts);
  rf1x2.train(X, y1x2);
  const rfBtts = new RandomForestClassifier(opts);
  rfBtts.train(X, yBtts);

  const s: StoredState = {
    rf1x2: rf1x2.toJSON() as object,
    rfBtts: rfBtts.toJSON() as object,
    nSamples: X.length,
    accuracy1x2: acc1x2,
    accuracyBtts: accBtts,
    trainedAt: Date.now(),
  };
  saveState(s);
  return { nSamples: X.length, accuracy1x2: acc1x2, accuracyBtts: accBtts };
}

// ── Prediction ────────────────────────────────────────────────────────────────

export interface PredictionOutput {
  method: string;
  nSamples: number;
  accuracy1x2: number;
  accuracyBtts: number;
  trainedAt: number;
  featureQuality: "full" | "partial" | "minimal";
  lambdaHome: number;
  lambdaAway: number;
  onex2: { H: number; D: number; A: number };
  dc: { "1X": number; "12": number; X2: number };
  btts: { yes: number; no: number };
  corners: { predicted: number; stdDev: number; over85: number; over95: number; over105: number };
  correctScores: Array<{ home: number; away: number; prob: number }>;
  bestOdds: {
    onex2: { H: number | null; D: number | null; A: number | null };
    btts: { yes: number | null; no: number | null };
    dc: { "1X": number | null; "12": number | null; X2: number | null };
    ou: { over85: number | null; under85: number | null; over95: number | null; under95: number | null; over105: number | null; under105: number | null };
  };
  impliedProbs: {
    onex2: { H: number; D: number; A: number };
    btts: { yes: number; no: number };
    dc: { "1X": number; "12": number; X2: number };
  };
  valueBets: Array<{ market: string; outcome: string; modelProb: number; impliedProb: number; edge: number; bestOdds: number | null }>;
}

export function predictMatch(m: MatchLike): PredictionOutput {
  const features = extractFeatures(m);
  const poisson = poissonPredict(features);
  const state = loadState();
  const vec = toVector(features);

  const nonZero = vec.filter(v => v > 0).length;
  const featureQuality: "full" | "partial" | "minimal" =
    nonZero >= 15 ? "full" : nonZero >= 5 ? "partial" : "minimal";

  // ── 1X2 ──────────────────────────────────────────────────────────────────
  let onex2Arr = [poisson.homeWin, poisson.draw, poisson.awayWin];
  let method = "Statistical (Poisson)";

  if (state?.rf1x2 && state.nSamples >= 10) {
    try {
      const rf1x2 = RandomForestClassifier.load(state.rf1x2);
      const rfProbs = rfVoteProbs(rf1x2, vec, [0, 1, 2]);
      const rfW = Math.min(0.6, 0.3 + state.nSamples * 0.01);
      onex2Arr = blendProbs(onex2Arr, rfProbs, rfW);
      method = `RF+Poisson blend (${Math.round(rfW * 100)}% RF)`;
    } catch { /* fall back */ }
  }

  // Blend in market consensus — weight scales up as data gets thinner.
  // "minimal": model has no real stats, so market is the best anchor (65%).
  // "partial": some stats but unreliable, moderate correction (40%).
  // "full": stats are rich, small nudge toward market (15%).
  if (features.oddsHome > 0) {
    const mktArr = [features.oddsHome, features.oddsDraw, features.oddsAway];
    const mktW = featureQuality === "minimal" ? 0.65 : featureQuality === "partial" ? 0.40 : 0.15;
    onex2Arr = blendProbs(onex2Arr, mktArr, mktW);
  }

  const onex2 = { H: onex2Arr[0], D: onex2Arr[1], A: onex2Arr[2] };

  // ── BTTS ─────────────────────────────────────────────────────────────────
  let bttsArr = [1 - poisson.bttsYes, poisson.bttsYes];

  if (state?.rfBtts && state.nSamples >= 10) {
    try {
      const rfBtts = RandomForestClassifier.load(state.rfBtts);
      const rfProbs = rfVoteProbs(rfBtts, vec, [0, 1]);
      const rfW = Math.min(0.6, 0.3 + state.nSamples * 0.01);
      bttsArr = blendProbs(bttsArr, rfProbs, rfW);
    } catch { /* fall back */ }
  }

  const btts = { yes: bttsArr[1], no: bttsArr[0] };

  // ── DC ────────────────────────────────────────────────────────────────────
  const dc = {
    "1X": Math.min(1, onex2.H + onex2.D),
    "12": Math.min(1, onex2.H + onex2.A),
    X2: Math.min(1, onex2.D + onex2.A),
  };

  // ── Corners ───────────────────────────────────────────────────────────────
  const hCorn = features.homeCornersAvg > 0 ? features.homeCornersAvg : 5.0;
  const aCorn = features.awayCornersAvg > 0 ? features.awayCornersAvg : 4.5;
  const cMean = hCorn + aCorn;
  const cStd = Math.sqrt(hCorn * 0.5 + aCorn * 0.5) * 1.4;
  const corners = {
    predicted: Math.round(cMean * 10) / 10,
    stdDev: Math.round(cStd * 10) / 10,
    over85:  Math.round((1 - normalCDF(8.5,  cMean, cStd)) * 1000) / 10,
    over95:  Math.round((1 - normalCDF(9.5,  cMean, cStd)) * 1000) / 10,
    over105: Math.round((1 - normalCDF(10.5, cMean, cStd)) * 1000) / 10,
  };

  // ── Best bookmaker odds ───────────────────────────────────────────────────
  const ox = parseOdds(m.po_1x2_json ?? m.odds_1x2_json);
  const ob = parseOdds(m.po_btts_json ?? m.odds_btts_json);
  const ou = parseOdds(m.po_ou_json ?? m.odds_ou_json);
  const od = parseOdds(m.po_dc_json ?? m.odds_dc_json);

  function ouLine(line: number, idx: number): number | null {
    const e = ou.find(e => e.line != null && Math.abs((e.line as number) - line) < 0.01);
    return e ? (e.odds[idx] ?? null) : null;
  }

  const bestOdds = {
    onex2: { H: bestOdd(ox, 0), D: bestOdd(ox, 1), A: bestOdd(ox, 2) },
    btts:  { yes: bestOdd(ob, 0), no: bestOdd(ob, 1) },
    dc:    { "1X": bestOdd(od, 0), "12": bestOdd(od, 2), X2: bestOdd(od, 1) },
    ou: {
      over85: ouLine(8.5, 0),   under85: ouLine(8.5, 1),
      over95: ouLine(9.5, 0),   under95: ouLine(9.5, 1),
      over105: ouLine(10.5, 0), under105: ouLine(10.5, 1),
    },
  };

  // ── Implied probabilities (de-vigged) ─────────────────────────────────────
  const imp1 = deVig([oddsToProb(bestOdds.onex2.H), oddsToProb(bestOdds.onex2.D), oddsToProb(bestOdds.onex2.A)]);
  const impB = deVig([oddsToProb(bestOdds.btts.yes), oddsToProb(bestOdds.btts.no)]);
  const impD = deVig([oddsToProb(bestOdds.dc["1X"]), oddsToProb(bestOdds.dc["12"]), oddsToProb(bestOdds.dc.X2)]);

  const impliedProbs = {
    onex2: { H: imp1[0] ?? 0, D: imp1[1] ?? 0, A: imp1[2] ?? 0 },
    btts:  { yes: impB[0] ?? 0, no: impB[1] ?? 0 },
    dc:    { "1X": impD[0] ?? 0, "12": impD[1] ?? 0, X2: impD[2] ?? 0 },
  };

  // ── Value bets (edge >= 4%) ───────────────────────────────────────────────
  const THRESHOLD = 0.04;
  const valueBets: PredictionOutput["valueBets"] = [];

  function chk(market: string, outcome: string, modelP: number, impliedP: number, odds: number | null) {
    if (impliedP <= 0 || odds === null) return;
    const edge = modelP - impliedP;
    if (edge >= THRESHOLD) valueBets.push({ market, outcome, modelProb: modelP, impliedProb: impliedP, edge, bestOdds: odds });
  }

  chk("1X2", "Home", onex2.H, impliedProbs.onex2.H, bestOdds.onex2.H);
  chk("1X2", "Draw", onex2.D, impliedProbs.onex2.D, bestOdds.onex2.D);
  chk("1X2", "Away", onex2.A, impliedProbs.onex2.A, bestOdds.onex2.A);
  chk("BTTS", "Yes",  btts.yes, impliedProbs.btts.yes, bestOdds.btts.yes);
  chk("BTTS", "No",   btts.no,  impliedProbs.btts.no,  bestOdds.btts.no);
  chk("DC", "1X", dc["1X"], impliedProbs.dc["1X"], bestOdds.dc["1X"]);
  chk("DC", "12", dc["12"], impliedProbs.dc["12"], bestOdds.dc["12"]);
  chk("DC", "X2", dc.X2,    impliedProbs.dc.X2,    bestOdds.dc.X2);
  valueBets.sort((a, b) => b.edge - a.edge);

  return {
    method, featureQuality,
    nSamples: state?.nSamples ?? 0,
    accuracy1x2: state?.accuracy1x2 ?? 0,
    accuracyBtts: state?.accuracyBtts ?? 0,
    trainedAt: state?.trainedAt ?? 0,
    lambdaHome: Math.round(poisson.lambdaHome * 100) / 100,
    lambdaAway: Math.round(poisson.lambdaAway * 100) / 100,
    onex2, dc, btts, corners,
    correctScores: poisson.correctScores,
    bestOdds, impliedProbs, valueBets,
  };
}

export function modelStatus() {
  const s = loadState();
  return {
    trained: !!(s?.rf1x2),
    nSamples: s?.nSamples ?? 0,
    accuracy1x2: s?.accuracy1x2 ?? 0,
    accuracyBtts: s?.accuracyBtts ?? 0,
    trainedAt: s?.trainedAt ?? 0,
  };
}

/**
 * Look up a match by fuzzy team-name match + kickoff timestamp, then predict.
 * Checks processing_matches first (exact date), then stored_matches (match_date).
 */
export function predictByTeams(homeTeam: string, awayTeam: string, kickoffTs: number): PredictionOutput | null {
  const db = getDb();

  // Normalise: lowercase, strip punctuation for comparison
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, "").trim();
  const hn = norm(homeTeam);
  const an = norm(awayTeam);

  // 1) processing_matches — match by date (YYYY-MM-DD) from kickoffTs
  const dateStr = new Date(kickoffTs * 1000).toISOString().slice(0, 10);
  const pmRows = db.prepare(
    "SELECT * FROM processing_matches WHERE date = ? ORDER BY created_at DESC"
  ).all(dateStr) as Record<string, unknown>[];

  const pmRow = pmRows.find(r => {
    return norm(String(r.home_team ?? "")).includes(hn.split(" ")[0]) &&
           norm(String(r.away_team ?? "")).includes(an.split(" ")[0]);
  }) ?? null;

  if (pmRow) return predictMatch(pmRow as MatchLike);

  // 2) stored_matches — match_date is YYYY-MM-DD
  const smRows = db.prepare(
    "SELECT * FROM stored_matches WHERE match_date = ? ORDER BY id DESC"
  ).all(dateStr) as Record<string, unknown>[];

  const smRow = smRows.find(r => {
    return norm(String(r.home_team ?? "")).includes(hn.split(" ")[0]) &&
           norm(String(r.away_team ?? "")).includes(an.split(" ")[0]);
  }) ?? null;

  if (smRow) return predictMatch(smRow as MatchLike);

  // 3) Try ±1 day window for timezone edge cases (processing_matches)
  const dayBefore = new Date((kickoffTs - 86400) * 1000).toISOString().slice(0, 10);
  const dayAfter  = new Date((kickoffTs + 86400) * 1000).toISOString().slice(0, 10);
  for (const d of [dayBefore, dayAfter]) {
    const rows = db.prepare(
      "SELECT * FROM processing_matches WHERE date = ? ORDER BY created_at DESC"
    ).all(d) as Record<string, unknown>[];
    const row = rows.find(r =>
      norm(String(r.home_team ?? "")).includes(hn.split(" ")[0]) &&
      norm(String(r.away_team ?? "")).includes(an.split(" ")[0])
    ) ?? null;
    if (row) return predictMatch(row as MatchLike);
  }

  return null;
}
