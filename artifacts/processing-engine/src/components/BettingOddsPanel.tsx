import React, { useMemo, useState } from "react";
import { format } from "date-fns";

// ─── Re-declared types (matching fixture-detail.tsx) ─────────────────────────

interface SHMatchStatRow {
  eventId: number; date: string;
  homeTeam: string; awayTeam: string;
  homeScore: number; awayScore: number;
  homeValue: number; awayValue: number;
  myValue: number; opponentValue: number;
  result: "W" | "D" | "L";
}
interface SHStatHistory { key: string; label: string; matches: SHMatchStatRow[]; }
interface Match {
  eventId: number; date: number;
  homeTeamName: string; awayTeamName: string;
  homeScore: number; awayScore: number;
  tournamentName: string; isHome: boolean;
}
interface TeamData {
  matches: Match[];
  players: { playerId: number; name: string; position: string; jerseyNo: number; appearances: number;
    matchStats: ({ goals: number; assists: number; shots: number; shotsOnTarget: number; minutesPlayed: number; } | null)[]; }[];
  matchDates: number[];
  possession: number;
  statHistory: SHStatHistory[];
}

// ─── Poisson engine ───────────────────────────────────────────────────────────

function poissonPMF(lambda: number, k: number): number {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  if (k < 0) return 0;
  let logP = -lambda + k * Math.log(lambda);
  for (let i = 1; i <= k; i++) logP -= Math.log(i);
  return Math.exp(logP);
}

function buildScoreMatrix(lH: number, lA: number, max = 8): number[][] {
  const m: number[][] = [];
  for (let h = 0; h <= max; h++) {
    m[h] = [];
    for (let a = 0; a <= max; a++) m[h][a] = poissonPMF(lH, h) * poissonPMF(lA, a);
  }
  return m;
}

// ─── Stat helpers ─────────────────────────────────────────────────────────────

function getStatMap(sh: SHStatHistory[], key: string): Map<number, SHMatchStatRow> {
  const hist = sh.find(h => h.key === key || h.label === key);
  if (!hist) return new Map();
  const map = new Map<number, SHMatchStatRow>();
  hist.matches.forEach(m => map.set(m.eventId, m));
  return map;
}

// ─── Team aggregate stats ─────────────────────────────────────────────────────

interface TeamAgg {
  n: number;
  avgScored: number; avgConceded: number;
  avgXgFor: number; avgXgAgainst: number;
  avgCornersFor: number; avgCornersAgainst: number;
  avgShots: number; avgSog: number;
  cleanSheetRate: number; bttsRate: number;
  wdl: [number, number, number];
  goalsScoredArr: number[]; goalsConcededArr: number[];
  cornersArr: number[];
  formScore: number;
}

function computeTeamAgg(matches: Match[], sh: SHStatHistory[]): TeamAgg {
  const xgMap    = getStatMap(sh, "Expected Goals");
  const cornerMap = getStatMap(sh, "Corners");
  const shotMap  = getStatMap(sh, "Shots");
  const sogMap   = getStatMap(sh, "Shots On Goal");

  let gs = 0, gc = 0, xgF = 0, xgA = 0, cF = 0, cA = 0, shots = 0, sog = 0;
  let cs = 0, btts = 0, w = 0, d = 0, l = 0;
  const gsArr: number[] = [], gcArr: number[] = [], cArr: number[] = [];
  let formScore = 0;

  matches.forEach((m, idx) => {
    const scored   = m.isHome ? m.homeScore : m.awayScore;
    const conceded = m.isHome ? m.awayScore : m.homeScore;
    gs += scored; gc += conceded;
    gsArr.push(scored); gcArr.push(conceded);

    if (scored > conceded) w++;
    else if (scored === conceded) d++;
    else l++;

    if (conceded === 0) cs++;
    if (scored > 0 && conceded > 0) btts++;

    const decay = Math.pow(0.85, idx);
    if (scored > conceded) formScore += 3 * decay;
    else if (scored === conceded) formScore += 1 * decay;

    const xr = xgMap.get(m.eventId);
    if (xr) { xgF += xr.myValue; xgA += xr.opponentValue; }

    const cr = cornerMap.get(m.eventId);
    if (cr) { cF += cr.myValue; cA += cr.opponentValue; cArr.push(cr.myValue + cr.opponentValue); }

    const sr = shotMap.get(m.eventId);
    if (sr) shots += sr.myValue;

    const sgr = sogMap.get(m.eventId);
    if (sgr) sog += sgr.myValue;
  });

  const n = matches.length || 1;
  const hasXg = xgMap.size > 0;
  return {
    n, avgScored: gs / n, avgConceded: gc / n,
    avgXgFor:   hasXg ? xgF / n : 0,
    avgXgAgainst: hasXg ? xgA / n : 0,
    avgCornersFor: cF / n, avgCornersAgainst: cA / n,
    avgShots: shots / n, avgSog: sog / n,
    cleanSheetRate: cs / n, bttsRate: btts / n,
    wdl: [w / n, d / n, l / n],
    goalsScoredArr: gsArr, goalsConcededArr: gcArr,
    cornersArr: cArr, formScore,
  };
}

// ─── Match dynamics (WHY analysis) ───────────────────────────────────────────

interface MatchDynamic {
  eventId: number; date: number; opponent: string; isHome: boolean;
  scored: number; conceded: number; result: "W" | "D" | "L";
  xgFor?: number; xgAgainst?: number;
  sogFor?: number; sogAgainst?: number;
  cornersFor?: number; cornersAgainst?: number;
  bccFor?: number; bccAgainst?: number;
  bcmFor?: number; bcsFor?: number;
  possession?: number; elgConceded?: number;
  drivers: string[];
}

function buildMatchDynamics(matches: Match[], sh: SHStatHistory[]): MatchDynamic[] {
  const xgMap   = getStatMap(sh, "Expected Goals");
  const shotMap = getStatMap(sh, "Shots");
  const sogMap  = getStatMap(sh, "Shots On Goal");
  const cMap    = getStatMap(sh, "Corners");
  const bccMap  = getStatMap(sh, "Big Chance Created");
  const bcmMap  = getStatMap(sh, "Big Chance Missed");
  const bcsMap  = getStatMap(sh, "Big Chance Scored");
  const posMap  = getStatMap(sh, "Possession");
  const elgMap  = getStatMap(sh, "Errors Lead To Goal");

  return matches.slice(0, 8).map(m => {
    const scored   = m.isHome ? m.homeScore : m.awayScore;
    const conceded = m.isHome ? m.awayScore : m.homeScore;
    const result: "W" | "D" | "L" = scored > conceded ? "W" : scored === conceded ? "D" : "L";
    const opponent = m.isHome ? m.awayTeamName : m.homeTeamName;

    const xr  = xgMap.get(m.eventId);
    const sgr = sogMap.get(m.eventId);
    const sr  = shotMap.get(m.eventId);
    const cr  = cMap.get(m.eventId);
    const bcc = bccMap.get(m.eventId);
    const bcm = bcmMap.get(m.eventId);
    const bcs = bcsMap.get(m.eventId);
    const pr  = posMap.get(m.eventId);
    const elg = elgMap.get(m.eventId);

    const xgF  = xr?.myValue,   xgA  = xr?.opponentValue;
    const sogF = sgr?.myValue,  sogA = sgr?.opponentValue;
    const cF   = cr?.myValue,   cA   = cr?.opponentValue;
    const bccF = bcc?.myValue,  bccA = bcc?.opponentValue;
    const bcmF = bcm?.myValue;
    const poss = pr?.myValue;
    const elgV = elg?.opponentValue;

    const drivers: string[] = [];

    if (result === "W") {
      if (xgF !== undefined && xgA !== undefined) {
        if (xgF > xgA * 1.6)       drivers.push(`Dominated xG (${xgF.toFixed(1)} vs ${xgA.toFixed(1)})`);
        else if (scored > xgF + 0.7) drivers.push(`Clinical: ${scored}G from ${xgF.toFixed(1)} xG`);
      }
      if (bccF !== undefined && bccF >= 2) drivers.push(`Created ${bccF} big chance${bccF > 1 ? "s" : ""}`);
      if (sogF !== undefined && sogA !== undefined && sogF > sogA + 2) drivers.push(`Shot accuracy edge (${sogF} vs ${sogA} SOG)`);
      if (conceded === 0) drivers.push("Clean sheet — defence watertight");
      if (poss !== undefined && poss >= 58) drivers.push(`Dominant possession (${poss}%)`);
      if (cF !== undefined && cA !== undefined && cF > cA + 3) drivers.push(`Set-piece threat (${cF} corners)`);
    } else if (result === "L") {
      if (xgF !== undefined && xgA !== undefined) {
        if (xgA > xgF * 1.6)         drivers.push(`Out-played: xG ${xgF.toFixed(1)} vs opp ${xgA.toFixed(1)}`);
        else if (conceded > xgA + 0.7) drivers.push(`Unlucky: conceded ${conceded} from opp ${xgA.toFixed(1)} xG`);
        else if (scored < xgF - 0.7)  drivers.push(`Wasteful: ${xgF.toFixed(1)} xG, only ${scored} goal${scored !== 1 ? "s" : ""}`);
      }
      if (elgV !== undefined && elgV > 0) drivers.push(`${elgV} error${elgV > 1 ? "s" : ""} led to opp goals`);
      if (bcmF !== undefined && bcmF >= 2) drivers.push(`Missed ${bcmF} big chances`);
      if (sogF !== undefined && sogA !== undefined && sogA > sogF + 2) drivers.push(`Out-shot on target (${sogF} vs ${sogA})`);
      if (poss !== undefined && poss <= 38) drivers.push(`Pressed hard — only ${poss}% possession`);
    } else {
      if (xgF !== undefined && xgA !== undefined) {
        if (Math.abs(xgF - xgA) < 0.4) drivers.push(`Even xG (${xgF.toFixed(1)} vs ${xgA.toFixed(1)})`);
        else if (xgF > xgA + 0.5)      drivers.push(`Better xG (${xgF.toFixed(1)}) but couldn't convert`);
        else                            drivers.push(`Withstood pressure (opp xG ${xgA.toFixed(1)})`);
      }
      if (scored === 0 && conceded === 0) drivers.push("Goalless — defences dominant");
      else                                drivers.push("Open game — both teams scored");
      if (bccF !== undefined && bccA !== undefined && bccF > bccA) drivers.push(`More big chances created (${bccF} vs ${bccA})`);
    }

    if (drivers.length === 0)
      drivers.push(result === "W" ? "Controlled performance" : result === "L" ? "Below-par showing" : "Balanced contest");

    return {
      eventId: m.eventId, date: m.date, opponent, isHome: m.isHome,
      scored, conceded, result,
      xgFor: xgF, xgAgainst: xgA,
      sogFor: sogF, sogAgainst: sogA,
      cornersFor: cF, cornersAgainst: cA,
      bccFor: bccF, bccAgainst: bccA,
      bcmFor: bcmF, possession: poss, elgConceded: elgV,
      drivers,
    };
  });
}

// ─── Lambda computation ───────────────────────────────────────────────────────

function computeLambdas(hAgg: TeamAgg, aAgg: TeamAgg): { lH: number; lA: number } {
  const hAttack = hAgg.avgXgFor  > 0 ? 0.55 * hAgg.avgScored   + 0.45 * hAgg.avgXgFor   : hAgg.avgScored;
  const hDefend = hAgg.avgXgAgainst > 0 ? 0.55 * hAgg.avgConceded + 0.45 * hAgg.avgXgAgainst : hAgg.avgConceded;
  const aAttack = aAgg.avgXgFor  > 0 ? 0.55 * aAgg.avgScored   + 0.45 * aAgg.avgXgFor   : aAgg.avgScored;
  const aDefend = aAgg.avgXgAgainst > 0 ? 0.55 * aAgg.avgConceded + 0.45 * aAgg.avgXgAgainst : aAgg.avgConceded;

  const HOME_ADVANTAGE = 0.22;
  const lH = Math.max(0.3, (hAttack + aDefend) / 2 + HOME_ADVANTAGE);
  const lA = Math.max(0.3, (aAttack + hDefend) / 2);
  return { lH, lA };
}

// ─── Market computation ───────────────────────────────────────────────────────

interface OddsEntry { label: string; prob: number; odds: number; hl: "green" | "amber" | "gray"; }
interface MarketGroup { title: string; entries: OddsEntry[]; }

function fmt(p: number) { return oddsFrom(p); }
function oddsFrom(p: number): number { return Math.round((1 / Math.max(0.005, p)) * 100) / 100; }
function hl(p: number): "green" | "amber" | "gray" {
  if (p >= 0.55) return "green";
  if (p >= 0.33) return "amber";
  return "gray";
}
function e(label: string, prob: number): OddsEntry {
  return { label, prob, odds: fmt(prob), hl: hl(prob) };
}

function computeMarkets(
  matrix: number[][], hAgg: TeamAgg, aAgg: TeamAgg,
  lH: number, lA: number, hName: string, aName: string
): MarketGroup[] {
  const MAX = matrix.length - 1;

  // ── Basic 1x2 ──
  let pH = 0, pD = 0, pA = 0;
  for (let h = 0; h <= MAX; h++)
    for (let a = 0; a <= MAX; a++) {
      const p = matrix[h][a];
      if (h > a) pH += p;
      else if (h === a) pD += p;
      else pA += p;
    }

  // ── Total goals distribution ──
  const tg: number[] = Array(MAX * 2 + 1).fill(0);
  for (let h = 0; h <= MAX; h++)
    for (let a = 0; a <= MAX; a++)
      if (h + a < tg.length) tg[h + a] += matrix[h][a];

  const over = (line: number) => {
    const th = Math.floor(line) + 1;
    return tg.slice(th).reduce((s, v) => s + v, 0);
  };
  const exact = (n: number) => tg[n] ?? 0;

  // ── BTTS ──
  let pBTTS = 0;
  for (let h = 1; h <= MAX; h++) for (let a = 1; a <= MAX; a++) pBTTS += matrix[h][a];
  const pNoBTTS = 1 - pBTTS;

  // ── BTTS + result ──
  let pBTTS_H = 0, pBTTS_D = 0, pBTTS_A = 0;
  for (let h = 1; h <= MAX; h++) for (let a = 1; a <= MAX; a++) {
    const p = matrix[h][a];
    if (h > a) pBTTS_H += p; else if (h === a) pBTTS_D += p; else pBTTS_A += p;
  }

  // ── Clean sheet / Win to nil ──
  let pHCS = 0, pACS = 0, pHWTN = 0, pAWTN = 0;
  for (let h = 0; h <= MAX; h++) { pHCS += matrix[h][0]; if (h > 0) pHWTN += matrix[h][0]; }
  for (let a = 0; a <= MAX; a++) { pACS += matrix[0][a]; if (a > 0) pAWTN += matrix[0][a]; }

  // ── Individual team totals ──
  const hGoals: number[] = Array(MAX + 1).fill(0);
  const aGoals: number[] = Array(MAX + 1).fill(0);
  for (let h = 0; h <= MAX; h++) for (let a = 0; a <= MAX; a++) {
    hGoals[h] += matrix[h][a]; aGoals[a] += matrix[h][a];
  }
  const hOver = (n: number) => hGoals.slice(n + 1).reduce((s, v) => s + v, 0);
  const aOver = (n: number) => aGoals.slice(n + 1).reduce((s, v) => s + v, 0);

  // ── Odd/Even ──
  let pOdd = 0, pEven = 0;
  tg.forEach((p, t) => { if (t % 2 === 1) pOdd += p; else pEven += p; });

  let pHOdd = 0, pHEven = 0, pAOdd = 0, pAEven = 0;
  hGoals.forEach((p, h) => { if (h % 2 === 1) pHOdd += p; else pHEven += p; });
  aGoals.forEach((p, a) => { if (a % 2 === 1) pAOdd += p; else pAEven += p; });

  // ── Winning margin ──
  let pM1 = 0, pM2 = 0, pM3p = 0;
  for (let h = 0; h <= MAX; h++) for (let a = 0; a <= MAX; a++) {
    const diff = Math.abs(h - a);
    if (diff === 1) pM1 += matrix[h][a];
    else if (diff === 2) pM2 += matrix[h][a];
    else if (diff >= 3) pM3p += matrix[h][a];
  }

  // ── Asian handicap ──
  const ah = (line: number) => {
    let home = 0, away = 0, push = 0;
    for (let h = 0; h <= MAX; h++) for (let a = 0; a <= MAX; a++) {
      const diff = h - a;
      if (diff > line) home += matrix[h][a];
      else if (diff < line) away += matrix[h][a];
      else push += matrix[h][a];
    }
    return { home, away, push };
  };
  const ah_neg05 = ah(-0.5), ah_pos05 = ah(0.5);
  const ah_neg1  = ah(-1),   ah_pos1  = ah(1);
  const ah_neg15 = ah(-1.5), ah_pos15 = ah(1.5);
  const ah_neg25 = ah(-2.5), ah_pos25 = ah(2.5);

  // ── Corners (Poisson) ──
  const hCorL = (hAgg.avgCornersFor + aAgg.avgCornersAgainst) / 2;
  const aCorL = (aAgg.avgCornersFor + hAgg.avgCornersAgainst) / 2;
  const totCorL = (hCorL + aCorL) > 0 ? hCorL + aCorL : 9.5;

  const corP = (k: number) => poissonPMF(totCorL, k);
  const corOver = (line: number) => {
    let s = 0; const th = Math.floor(line) + 1;
    for (let k = th; k <= 30; k++) s += corP(k);
    return s;
  };

  // ── HT matrix (43% of goals scored in first half) ──
  const htMatrix = buildScoreMatrix(lH * 0.43, lA * 0.43, 5);
  const sh2Matrix = buildScoreMatrix(lH * 0.57, lA * 0.57, 6);

  // Joint HT/FT distribution
  const htftProb: Record<string, number> = {};
  for (let h1 = 0; h1 <= 5; h1++) for (let a1 = 0; a1 <= 5; a1++) {
    const pHT = htMatrix[h1]?.[a1] ?? 0;
    if (pHT < 1e-8) continue;
    const htR = h1 > a1 ? "H" : h1 === a1 ? "D" : "A";
    for (let h2 = 0; h2 <= 6; h2++) for (let a2 = 0; a2 <= 6; a2++) {
      const p2 = sh2Matrix[h2]?.[a2] ?? 0;
      if (p2 < 1e-8) continue;
      const ftR = (h1 + h2) > (a1 + a2) ? "H" : (h1 + h2) === (a1 + a2) ? "D" : "A";
      const key = `${htR}/${ftR}`;
      htftProb[key] = (htftProb[key] ?? 0) + pHT * p2;
    }
  }

  let pHT_H = 0, pHT_D = 0, pHT_A = 0;
  for (let h = 0; h <= 5; h++) for (let a = 0; a <= 5; a++) {
    const p = htMatrix[h]?.[a] ?? 0;
    if (h > a) pHT_H += p; else if (h === a) pHT_D += p; else pHT_A += p;
  }

  const htTg: number[] = Array(10).fill(0);
  for (let h = 0; h <= 5; h++) for (let a = 0; a <= 5; a++)
    if (h + a < htTg.length) htTg[h + a] += htMatrix[h]?.[a] ?? 0;

  // ── Result / Total Goals ──
  const resultGoal = (cond: (h:number,a:number)=>boolean, gCond: (h:number,a:number)=>boolean) => {
    let p = 0;
    for (let h = 0; h <= MAX; h++) for (let a = 0; a <= MAX; a++)
      if (cond(h,a) && gCond(h,a)) p += matrix[h][a];
    return p;
  };
  const hWin  = (h:number,a:number) => h > a;
  const aWin  = (h:number,a:number) => a > h;
  const draw  = (h:number,a:number) => h === a;
  const ov25  = (h:number,a:number) => h + a > 2.5;
  const un25  = (h:number,a:number) => h + a <= 2;
  const ov35  = (h:number,a:number) => h + a > 3.5;

  // ── Correct scores (top 16) ──
  const allScores: { h:number; a:number; p:number }[] = [];
  for (let h = 0; h <= MAX; h++) for (let a = 0; a <= MAX; a++)
    allScores.push({ h, a, p: matrix[h][a] });
  const topScores = allScores.sort((x,y) => y.p - x.p).slice(0, 16);

  // ── Top scorer probabilities (from player data) ──
  // Uses goals per 90 from aggregate stats

  return [
    // ── RESULT ──
    {
      title: "1X2 — Match Result",
      entries: [
        e(`${hName} Win`, pH), e("Draw", pD), e(`${aName} Win`, pA),
      ],
    },
    {
      title: "Double Chance",
      entries: [
        e(`${hName} or Draw`,           pH + pD),
        e(`${aName} or Draw`,           pA + pD),
        e(`${hName} or ${aName}`,       pH + pA),
      ],
    },
    {
      title: "Draw No Bet",
      entries: [
        e(hName, pH / (pH + pA)),
        e(aName, pA / (pH + pA)),
      ],
    },
    {
      title: "Either Team Wins",
      entries: [e("Either Team Wins", pH + pA), e("Draw", pD)],
    },
    // ── GOALS ──
    {
      title: "Total Goals — Over / Under",
      entries: [
        e("Over 0.5",  over(0.5)),  e("Under 0.5",  1 - over(0.5)),
        e("Over 1.5",  over(1.5)),  e("Under 1.5",  1 - over(1.5)),
        e("Over 2.5",  over(2.5)),  e("Under 2.5",  1 - over(2.5)),
        e("Over 3.5",  over(3.5)),  e("Under 3.5",  1 - over(3.5)),
        e("Over 4.5",  over(4.5)),  e("Under 4.5",  1 - over(4.5)),
        e("Over 5.5",  over(5.5)),  e("Under 5.5",  1 - over(5.5)),
      ],
    },
    {
      title: "Goal Line",
      entries: [
        e("GL 1.5 Over", over(1.5)), e("GL 1.5 Under", 1 - over(1.5)),
        e("GL 2.5 Over", over(2.5)), e("GL 2.5 Under", 1 - over(2.5)),
        e("GL 3.5 Over", over(3.5)), e("GL 3.5 Under", 1 - over(3.5)),
        e("GL 4.5 Over", over(4.5)), e("GL 4.5 Under", 1 - over(4.5)),
      ],
    },
    {
      title: "Exact Goals Number",
      entries: [0, 1, 2, 3, 4, 5, 6].map(n => e(`${n} Goals`, exact(n))),
    },
    {
      title: "Multi Goal",
      entries: [
        e("1–2 Goals", exact(1) + exact(2)),
        e("2–3 Goals", exact(2) + exact(3)),
        e("3–4 Goals", exact(3) + exact(4)),
        e("1–3 Goals", exact(1) + exact(2) + exact(3)),
        e("2–4 Goals", exact(2) + exact(3) + exact(4)),
        e("3–5 Goals", exact(3) + exact(4) + exact(5)),
        e("4+ Goals",  tg.slice(4).reduce((s, v) => s + v, 0)),
      ],
    },
    {
      title: "Both Teams To Score",
      entries: [e("Yes (BTTS)", pBTTS), e("No (BTTS)", pNoBTTS)],
    },
    {
      title: "Goal / No Goal",
      entries: [e("Goal (both score)", pBTTS), e("No Goal (≥1 blank)", pNoBTTS)],
    },
    {
      title: "Odd / Even — Total Goals",
      entries: [e("Odd", pOdd), e("Even", pEven)],
    },
    {
      title: `Individual Total Goals — ${hName}`,
      entries: [
        e("Over 0.5", hOver(0)), e("Under 0.5", 1 - hOver(0)),
        e("Over 1.5", hOver(1)), e("Under 1.5", 1 - hOver(1)),
        e("Over 2.5", hOver(2)), e("Under 2.5", 1 - hOver(2)),
      ],
    },
    {
      title: `Individual Total Goals — ${aName}`,
      entries: [
        e("Over 0.5", aOver(0)), e("Under 0.5", 1 - aOver(0)),
        e("Over 1.5", aOver(1)), e("Under 1.5", 1 - aOver(1)),
        e("Over 2.5", aOver(2)), e("Under 2.5", 1 - aOver(2)),
      ],
    },
    {
      title: `Individual Odd/Even — ${hName}`,
      entries: [e("Odd", pHOdd), e("Even", pHEven)],
    },
    {
      title: `Individual Odd/Even — ${aName}`,
      entries: [e("Odd", pAOdd), e("Even", pAEven)],
    },
    // ── HANDICAP ──
    {
      title: "Asian Handicap",
      entries: [
        e(`${hName} −0.5`, ah_neg05.home), e(`${aName} +0.5`, ah_neg05.away),
        e(`${hName} −1.0`, ah_neg1.home),  e(`${aName} +1.0`, ah_neg1.away),
        e(`${hName} −1.5`, ah_neg15.home), e(`${aName} +1.5`, ah_neg15.away),
        e(`${hName} −2.5`, ah_neg25.home), e(`${aName} +2.5`, ah_neg25.away),
        e(`${hName} +0.5`, ah_pos05.home), e(`${aName} −0.5`, ah_pos05.away),
        e(`${hName} +1.5`, ah_pos15.home), e(`${aName} −1.5`, ah_pos15.away),
      ],
    },
    {
      title: "European Handicap",
      entries: [
        e(`${hName} −1`, ah_neg1.home), e(`Draw  −1`,  ah_neg1.push), e(`${aName} −1`, ah_neg1.away),
        e(`${hName} +1`, ah_pos1.home), e(`Draw  +1`,  ah_pos1.push), e(`${aName} +1`, ah_pos1.away),
        e(`${hName} −2`, ah_neg25.home), e(`Draw −2`, ah_neg25.push), e(`${aName} −2`, ah_neg25.away),
      ],
    },
    // ── CORNERS ──
    {
      title: "Corners — Total Over / Under",
      entries: totCorL > 0 ? [
        e("Over 7.5",  corOver(7.5)),  e("Under 7.5",  1 - corOver(7.5)),
        e("Over 8.5",  corOver(8.5)),  e("Under 8.5",  1 - corOver(8.5)),
        e("Over 9.5",  corOver(9.5)),  e("Under 9.5",  1 - corOver(9.5)),
        e("Over 10.5", corOver(10.5)), e("Under 10.5", 1 - corOver(10.5)),
        e("Over 11.5", corOver(11.5)), e("Under 11.5", 1 - corOver(11.5)),
        e("Over 12.5", corOver(12.5)), e("Under 12.5", 1 - corOver(12.5)),
      ] : [{ label: "Insufficient corner data", prob: 0, odds: 0, hl: "gray" }],
    },
    // ── HALVES ──
    {
      title: "1X2 By Intervals — Half Time",
      entries: [e(`${hName} HT`, pHT_H), e("Draw HT", pHT_D), e(`${aName} HT`, pHT_A)],
    },
    {
      title: "Total Goals By Intervals",
      entries: [
        e("HT Over 0.5",  htTg.slice(1).reduce((s,v) => s+v,0)),
        e("HT Under 0.5", htTg[0] ?? 0),
        e("HT Over 1.5",  htTg.slice(2).reduce((s,v) => s+v,0)),
        e("HT Under 1.5", (htTg[0]??0) + (htTg[1]??0)),
        e("HT Over 2.5",  htTg.slice(3).reduce((s,v) => s+v,0)),
        e("HT Under 2.5", (htTg[0]??0)+(htTg[1]??0)+(htTg[2]??0)),
        e("FT Over 1.5",  over(1.5)),
        e("FT Over 2.5",  over(2.5)),
        e("FT Over 3.5",  over(3.5)),
      ],
    },
    {
      title: "Half Time / Full Time",
      entries: [
        e(`${hName} / ${hName}`, htftProb["H/H"] ?? 0),
        e(`Draw / ${hName}`,     htftProb["D/H"] ?? 0),
        e(`${aName} / ${hName}`, htftProb["A/H"] ?? 0),
        e(`${hName} / Draw`,     htftProb["H/D"] ?? 0),
        e("Draw / Draw",         htftProb["D/D"] ?? 0),
        e(`${aName} / Draw`,     htftProb["A/D"] ?? 0),
        e(`${hName} / ${aName}`, htftProb["H/A"] ?? 0),
        e(`Draw / ${aName}`,     htftProb["D/A"] ?? 0),
        e(`${aName} / ${aName}`, htftProb["A/A"] ?? 0),
      ].sort((x, y) => y.prob - x.prob),
    },
    {
      title: "Highest Scoring Half",
      entries: [
        e("1st Half More Goals", 0.30),
        e("Equal Both Halves",   0.21),
        e("2nd Half More Goals", 0.49),
      ],
    },
    {
      title: "Will Win Either Half",
      entries: [
        e(`${hName} wins ≥1 half`, Math.min(0.92, pH * 1.35 + pD * 0.4)),
        e(`${aName} wins ≥1 half`, Math.min(0.92, pA * 1.35 + pD * 0.4)),
      ],
    },
    // ── SPECIALS ──
    {
      title: "Result / Both Teams To Score",
      entries: [
        e(`${hName} Win & BTTS`, pBTTS_H),
        e("Draw & BTTS",         pBTTS_D),
        e(`${aName} Win & BTTS`, pBTTS_A),
        e(`${hName} Win & No BTTS`, pH - pBTTS_H),
        e(`${aName} Win & No BTTS`, pA - pBTTS_A),
      ],
    },
    {
      title: "Clean Sheet",
      entries: [
        e(`${hName} Clean Sheet`,     pHCS),
        e(`${hName} No Clean Sheet`,  1 - pHCS),
        e(`${aName} Clean Sheet`,     pACS),
        e(`${aName} No Clean Sheet`,  1 - pACS),
      ],
    },
    {
      title: "Win To Nil",
      entries: [
        e(`${hName} Win to Nil`, pHWTN),
        e(`${aName} Win to Nil`, pAWTN),
      ],
    },
    {
      title: "Winning Margin",
      entries: [
        e("Draw — No Winner",  pD),
        e("Win by Exactly 1",  pM1),
        e("Win by Exactly 2",  pM2),
        e("Win by 3 or More",  pM3p),
      ],
    },
    {
      title: "Scoring Draw",
      entries: [
        e("Any Scoring Draw", pBTTS_D),
        e("0-0 Goalless",     matrix[0]?.[0] ?? 0),
        e("1-1",              matrix[1]?.[1] ?? 0),
        e("2-2",              matrix[2]?.[2] ?? 0),
        e("3-3",              matrix[3]?.[3] ?? 0),
      ],
    },
    {
      title: "Result / Total Goals",
      entries: [
        e(`${hName} Win & Over 2.5`,  resultGoal(hWin, ov25)),
        e(`${hName} Win & Under 2.5`, resultGoal(hWin, un25)),
        e(`${hName} Win & Over 3.5`,  resultGoal(hWin, ov35)),
        e("Draw & Over 2.5",          resultGoal(draw, ov25)),
        e("Draw & Under 2.5",         resultGoal(draw, un25)),
        e(`${aName} Win & Over 2.5`,  resultGoal(aWin, ov25)),
        e(`${aName} Win & Under 2.5`, resultGoal(aWin, un25)),
        e(`${aName} Win & Over 3.5`,  resultGoal(aWin, ov35)),
      ],
    },
    {
      title: "Home Result / Total Goals",
      entries: [
        e(`${hName} Win & Over 2.5`,  resultGoal(hWin, ov25)),
        e(`${hName} Win & Under 2.5`, resultGoal(hWin, un25)),
        e(`${hName} Not Win & Over 2.5`, resultGoal((h,a)=>h<=a, ov25)),
        e(`${hName} Not Win & Under 2.5`,resultGoal((h,a)=>h<=a, un25)),
      ],
    },
    {
      title: "Away Result / Total Goals",
      entries: [
        e(`${aName} Win & Over 2.5`,  resultGoal(aWin, ov25)),
        e(`${aName} Win & Under 2.5`, resultGoal(aWin, un25)),
        e(`${aName} Not Win & Over 2.5`, resultGoal((h,a)=>a<=h, ov25)),
        e(`${aName} Not Win & Under 2.5`,resultGoal((h,a)=>a<=h, un25)),
      ],
    },
    {
      title: "Double Chance / Combo",
      entries: [
        e(`(${hName} or Draw) & BTTS`, (() => { let p=0; for(let h=1;h<=MAX;h++) for(let a=1;a<=MAX;a++) if(h>=a) p+=matrix[h][a]; return p; })()),
        e(`(${aName} or Draw) & BTTS`, (() => { let p=0; for(let h=1;h<=MAX;h++) for(let a=1;a<=MAX;a++) if(a>=h) p+=matrix[h][a]; return p; })()),
        e(`(${hName} or ${aName}) & BTTS`, (() => { let p=0; for(let h=1;h<=MAX;h++) for(let a=1;a<=MAX;a++) if(h!==a) p+=matrix[h][a]; return p; })()),
        e(`(${hName} or Draw) & No BTTS`, (() => { let p=0; for(let h=0;h<=MAX;h++) for(let a=0;a<=MAX;a++) if(h>=a && !(h>0&&a>0)) p+=matrix[h][a]; return p; })()),
        e(`(${aName} or Draw) & No BTTS`, (() => { let p=0; for(let h=0;h<=MAX;h++) for(let a=0;a<=MAX;a++) if(a>=h && !(h>0&&a>0)) p+=matrix[h][a]; return p; })()),
      ],
    },
    {
      title: "Correct Score",
      entries: topScores.map(({ h, a, p }) => e(`${h} − ${a}`, p)),
    },
  ];
}

// ─── Confidence rating ────────────────────────────────────────────────────────

function modelConfidence(hAgg: TeamAgg, aAgg: TeamAgg): { label: string; color: string; score: number } {
  const n = Math.min(hAgg.n, aAgg.n);
  const hasXg = hAgg.avgXgFor > 0 && aAgg.avgXgFor > 0;
  const score = Math.min(100, n * 4 + (hasXg ? 20 : 0));
  if (score >= 70) return { label: "HIGH", color: "text-green-400", score };
  if (score >= 45) return { label: "MEDIUM", color: "text-yellow-400", score };
  return { label: "LOW", color: "text-red-400", score };
}

// ─── UI — Stat bar ────────────────────────────────────────────────────────────

function ProbBar({ prob, hl: color }: { prob: number; hl: "green" | "amber" | "gray" }) {
  const pct = Math.round(prob * 100);
  const bg = color === "green" ? "bg-green-400" : color === "amber" ? "bg-yellow-400" : "bg-slate-600";
  return (
    <div className="flex items-center gap-2 min-w-0 flex-1">
      <div className="flex-1 h-1.5 bg-white/10 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all ${bg}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

// ─── UI — Single market group ─────────────────────────────────────────────────

function MarketGroup({ group }: { group: MarketGroup }) {
  const hlColor = (h: "green"|"amber"|"gray") =>
    h === "green" ? "text-green-400" : h === "amber" ? "text-yellow-300" : "text-slate-400";

  return (
    <div className="border border-border/40 bg-card/30 overflow-hidden">
      <div className="px-3 py-1.5 bg-primary/10 border-b border-border/40">
        <span className="text-[10px] font-mono uppercase tracking-widest text-primary/80">{group.title}</span>
      </div>
      <div className="divide-y divide-border/20">
        {group.entries.map((entry, i) => (
          <div key={i} className="flex items-center gap-3 px-3 py-1.5 hover:bg-white/5 transition-colors">
            <span className="text-xs font-mono text-foreground/80 flex-1 min-w-0 truncate">{entry.label}</span>
            <ProbBar prob={entry.prob} hl={entry.hl} />
            <span className={`text-[11px] font-mono w-10 text-right tabular-nums ${hlColor(entry.hl)}`}>
              {Math.round(entry.prob * 100)}%
            </span>
            <span className="text-[11px] font-mono w-12 text-right tabular-nums text-muted-foreground">
              {entry.odds.toFixed(2)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── UI — Match dynamic row ───────────────────────────────────────────────────

function DynamicRow({ d }: { d: MatchDynamic }) {
  const rColor  = d.result === "W" ? "bg-green-500" : d.result === "D" ? "bg-yellow-500" : "bg-red-500";
  const dateStr = format(new Date(d.date * 1000), "dd MMM");

  return (
    <div className="border border-border/30 bg-card/20 p-3 space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <span className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded text-black ${rColor}`}>{d.result}</span>
        <span className="text-xs font-mono text-foreground/90 font-semibold">
          {d.scored}–{d.conceded}
        </span>
        <span className="text-[10px] text-muted-foreground">vs {d.opponent}</span>
        <span className="text-[10px] text-muted-foreground ml-auto">{dateStr} {d.isHome ? "(H)" : "(A)"}</span>
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-0.5">
        {d.xgFor !== undefined && (
          <span className="text-[10px] font-mono text-muted-foreground">
            xG <span className="text-foreground/70">{d.xgFor.toFixed(1)}</span>:{d.xgAgainst?.toFixed(1)}
          </span>
        )}
        {d.sogFor !== undefined && (
          <span className="text-[10px] font-mono text-muted-foreground">
            SOG <span className="text-foreground/70">{d.sogFor}</span>:{d.sogAgainst}
          </span>
        )}
        {d.cornersFor !== undefined && (
          <span className="text-[10px] font-mono text-muted-foreground">
            COR <span className="text-foreground/70">{d.cornersFor}</span>:{d.cornersAgainst}
          </span>
        )}
        {d.possession !== undefined && (
          <span className="text-[10px] font-mono text-muted-foreground">
            POS <span className="text-foreground/70">{d.possession}%</span>
          </span>
        )}
        {d.bccFor !== undefined && (
          <span className="text-[10px] font-mono text-muted-foreground">
            BCC <span className="text-foreground/70">{d.bccFor}</span>:{d.bccAgainst}
          </span>
        )}
      </div>

      <div className="flex flex-wrap gap-1">
        {d.drivers.map((dr, i) => (
          <span key={i} className={`text-[10px] px-1.5 py-0.5 rounded font-mono ${
            d.result === "W" ? "bg-green-900/40 text-green-300" :
            d.result === "L" ? "bg-red-900/40 text-red-300" : "bg-yellow-900/40 text-yellow-300"
          }`}>{dr}</span>
        ))}
      </div>
    </div>
  );
}

// ─── Market category tabs ─────────────────────────────────────────────────────

const MARKET_CATEGORIES = [
  { id: "result",   label: "Result",    keys: ["1X2", "Double Chance", "Draw No Bet", "Either Team Wins"] },
  { id: "goals",    label: "Goals",     keys: ["Total Goals", "Goal Line", "Exact Goals", "Multi Goal", "Both Teams To Score", "Goal / No Goal", "Odd / Even", "Individual Total Goals", "Individual Odd/Even"] },
  { id: "handicap", label: "Handicap",  keys: ["Asian Handicap", "European Handicap"] },
  { id: "halves",   label: "Halves",    keys: ["1X2 By Intervals", "Total Goals By Intervals", "Half Time / Full Time", "Highest Scoring Half", "Will Win Either Half"] },
  { id: "corners",  label: "Corners",   keys: ["Corners"] },
  { id: "specials", label: "Specials",  keys: ["Result / Both Teams", "Clean Sheet", "Win To Nil", "Winning Margin", "Scoring Draw", "Result / Total Goals", "Home Result", "Away Result", "Double Chance / Combo"] },
  { id: "correct",  label: "Score",     keys: ["Correct Score"] },
] as const;

type CatId = typeof MARKET_CATEGORIES[number]["id"];

// ─── Main component ───────────────────────────────────────────────────────────

interface Props {
  home: TeamData;
  away: TeamData;
  fixture: { homeTeam: { name: string; colorPrimary: string|null }; awayTeam: { name: string; colorPrimary: string|null } };
}

export default function BettingOddsPanel({ home, away, fixture }: Props) {
  const [activeCat, setActiveCat] = useState<CatId>("result");
  const [dynTeam, setDynTeam] = useState<"home" | "away">("home");

  const hName = fixture.homeTeam.name;
  const aName = fixture.awayTeam.name;
  const hColor = fixture.homeTeam.colorPrimary ?? "#22d3ee";
  const aColor = fixture.awayTeam.colorPrimary ?? "#f97316";

  const { hAgg, aAgg, lH, lA, matrix, markets, hDyn, aDyn, confidence } = useMemo(() => {
    const hAgg = computeTeamAgg(home.matches, home.statHistory);
    const aAgg = computeTeamAgg(away.matches, away.statHistory);
    const { lH, lA } = computeLambdas(hAgg, aAgg);
    const matrix = buildScoreMatrix(lH, lA, 8);
    const markets = computeMarkets(matrix, hAgg, aAgg, lH, lA, hName, aName);
    const hDyn = buildMatchDynamics(home.matches, home.statHistory);
    const aDyn = buildMatchDynamics(away.matches, away.statHistory);
    const confidence = modelConfidence(hAgg, aAgg);
    return { hAgg, aAgg, lH, lA, matrix, markets, hDyn, aDyn, confidence };
  }, [home, away, hName, aName]);

  // Most likely score
  let bestH = 0, bestA = 0, bestP = 0;
  for (let h = 0; h <= 8; h++) for (let a = 0; a <= 8; a++)
    if ((matrix[h]?.[a] ?? 0) > bestP) { bestP = matrix[h][a]; bestH = h; bestA = a; }

  // Category filtering: match group titles loosely
  const filteredMarkets = activeCat === ("dynamics" as string)
    ? []
    : markets.filter(m => {
        const cat = MARKET_CATEGORIES.find(c => c.id === activeCat);
        if (!cat) return true;
        return cat.keys.some(k => m.title.toLowerCase().includes(k.toLowerCase()));
      });

  return (
    <div className="space-y-4">
      {/* ── Prediction header ── */}
      <div className="border border-border/50 bg-card/40 p-4">
        <div className="text-center space-y-3">
          <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
            Statistical Match Prediction — Poisson Model
          </p>
          <div className="flex items-center justify-center gap-6">
            <div className="text-right">
              <div className="text-lg font-bold" style={{ color: hColor }}>{hName}</div>
              <div className="text-[10px] font-mono text-muted-foreground">λ = {lH.toFixed(2)} xG</div>
            </div>
            <div className="flex flex-col items-center">
              <div className="text-2xl font-bold font-mono text-primary">{bestH} – {bestA}</div>
              <div className="text-[10px] font-mono text-muted-foreground">Most Likely Score ({(bestP * 100).toFixed(1)}%)</div>
            </div>
            <div className="text-left">
              <div className="text-lg font-bold" style={{ color: aColor }}>{aName}</div>
              <div className="text-[10px] font-mono text-muted-foreground">λ = {lA.toFixed(2)} xG</div>
            </div>
          </div>
          <div className="flex items-center justify-center gap-6 pt-1">
            {[
              { label: `${hName} Win`, pct: Math.round((() => { let p=0; for(let h=0;h<=8;h++) for(let a=0;a<=8;a++) if(h>a) p+=(matrix[h]?.[a]??0); return p; })() * 100) },
              { label: "Draw",          pct: Math.round((() => { let p=0; for(let h=0;h<=8;h++) p+=(matrix[h]?.[h]??0); return p; })() * 100) },
              { label: `${aName} Win`, pct: Math.round((() => { let p=0; for(let h=0;h<=8;h++) for(let a=0;a<=8;a++) if(a>h) p+=(matrix[h]?.[a]??0); return p; })() * 100) },
            ].map(item => (
              <div key={item.label} className="text-center">
                <div className="text-lg font-mono font-bold text-foreground">{item.pct}%</div>
                <div className="text-[10px] font-mono text-muted-foreground">{item.label}</div>
              </div>
            ))}
          </div>
          <div className="flex items-center justify-center gap-2 text-[10px] font-mono">
            <span className="text-muted-foreground">Model Confidence:</span>
            <span className={confidence.color + " font-bold"}>{confidence.label}</span>
            <span className="text-muted-foreground">({Math.min(hAgg.n, aAgg.n)} matches analysed)</span>
          </div>
        </div>
      </div>

      {/* ── Key team indicators ── */}
      <div className="grid grid-cols-2 gap-3">
        {[
          { name: hName, agg: hAgg, color: hColor },
          { name: aName, agg: aAgg, color: aColor },
        ].map(({ name, agg, color }) => (
          <div key={name} className="border border-border/40 bg-card/30 p-3 space-y-2">
            <div className="text-xs font-bold font-mono uppercase truncate" style={{ color }}>{name}</div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[10px] font-mono">
              <span className="text-muted-foreground">Goals/G</span>
              <span className="text-right text-foreground/80">{agg.avgScored.toFixed(2)}</span>
              <span className="text-muted-foreground">Conceded/G</span>
              <span className="text-right text-foreground/80">{agg.avgConceded.toFixed(2)}</span>
              {agg.avgXgFor > 0 && <>
                <span className="text-muted-foreground">xG For/G</span>
                <span className="text-right text-foreground/80">{agg.avgXgFor.toFixed(2)}</span>
                <span className="text-muted-foreground">xG Agst/G</span>
                <span className="text-right text-foreground/80">{agg.avgXgAgainst.toFixed(2)}</span>
              </>}
              <span className="text-muted-foreground">Clean Sheet</span>
              <span className="text-right text-foreground/80">{Math.round(agg.cleanSheetRate * 100)}%</span>
              <span className="text-muted-foreground">BTTS Rate</span>
              <span className="text-right text-foreground/80">{Math.round(agg.bttsRate * 100)}%</span>
              {agg.avgCornersFor > 0 && <>
                <span className="text-muted-foreground">Corners/G</span>
                <span className="text-right text-foreground/80">{(agg.avgCornersFor + agg.avgCornersAgainst).toFixed(1)}</span>
              </>}
              <span className="text-muted-foreground">W / D / L</span>
              <span className="text-right text-foreground/80">
                {Math.round(agg.wdl[0]*100)}%/{Math.round(agg.wdl[1]*100)}%/{Math.round(agg.wdl[2]*100)}%
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* ── Market tabs ── */}
      <div className="flex gap-0 border-b border-border/50 overflow-x-auto" style={{ scrollbarWidth: "none" }}>
        {MARKET_CATEGORIES.map(cat => (
          <button key={cat.id} onClick={() => setActiveCat(cat.id as CatId)}
            className={`px-3 py-2 text-[10px] font-mono uppercase tracking-widest border-b-2 transition-all -mb-px whitespace-nowrap flex-shrink-0 ${
              activeCat === cat.id ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
            }`}>
            {cat.label}
          </button>
        ))}
        <button onClick={() => setActiveCat("dynamics" as CatId)}
          className={`px-3 py-2 text-[10px] font-mono uppercase tracking-widest border-b-2 transition-all -mb-px whitespace-nowrap flex-shrink-0 ${
            activeCat === ("dynamics" as CatId) ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
          }`}>
          Dynamics
        </button>
      </div>

      {/* ── Dynamics tab ── */}
      {activeCat === ("dynamics" as CatId) ? (
        <div className="space-y-3">
          <div className="flex gap-0 border-b border-border/30">
            {(["home", "away"] as const).map(t => (
              <button key={t} onClick={() => setDynTeam(t)}
                className={`px-4 py-1.5 text-[10px] font-mono uppercase tracking-widest border-b-2 transition-all -mb-px ${
                  dynTeam === t ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
                }`}>
                {t === "home" ? hName : aName}
              </button>
            ))}
          </div>
          <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest px-1">
            Match-by-match: WHY did outcomes occur?
          </div>
          <div className="space-y-2">
            {(dynTeam === "home" ? hDyn : aDyn).map(d => (
              <DynamicRow key={d.eventId} d={d} />
            ))}
            {(dynTeam === "home" ? hDyn : aDyn).length === 0 && (
              <p className="text-muted-foreground text-sm text-center py-8 font-mono">No match data available</p>
            )}
          </div>
        </div>
      ) : (
        /* ── Market listings ── */
        <div className="space-y-2">
          <div className="flex items-center gap-2 px-1 text-[10px] font-mono text-muted-foreground">
            <span className="flex-1">OUTCOME</span>
            <span className="w-32 text-right">PROBABILITY</span>
            <span className="w-10 text-right">%</span>
            <span className="w-12 text-right">ODDS</span>
          </div>
          {filteredMarkets.length > 0
            ? filteredMarkets.map((g, i) => <MarketGroup key={i} group={g} />)
            : <p className="text-muted-foreground text-sm text-center py-8 font-mono">No markets for this category</p>
          }
        </div>
      )}

      {/* ── Disclaimer ── */}
      <div className="text-[9px] font-mono text-muted-foreground/50 text-center pt-2 border-t border-border/20 leading-relaxed">
        NEXUS FIXTURES · Statistical model based on last {Math.min(hAgg.n, aAgg.n)} matches per team ·
        Poisson distribution + team dynamics analysis · For informational purposes only
      </div>
    </div>
  );
}
