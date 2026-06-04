import React, { useMemo, useState } from "react";
import { format } from "date-fns";

// ─── Types ─────────────────────────────────────────────────────────────────────

interface PlayerMatchStats {
  goals: number; assists: number; shots: number; shotsOnTarget: number; minutesPlayed: number;
  tackles?: number; interceptions?: number; fouls?: number; foulsWon?: number;
  keyPasses?: number; clearances?: number; saves?: number;
  xG?: number; xA?: number; passes?: number;
}
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
    matchStats: (PlayerMatchStats | null)[]; }[];
  matchDates: number[];
  possession: number;
  statHistory: SHStatHistory[];
}

// ─── Poisson engine ────────────────────────────────────────────────────────────

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
function extractWinProbs(lH: number, lA: number): [number, number, number] {
  let pH = 0, pD = 0, pA = 0;
  for (let h = 0; h <= 8; h++) for (let a = 0; a <= 8; a++) {
    const p = poissonPMF(lH, h) * poissonPMF(lA, a);
    if (h > a) pH += p; else if (h === a) pD += p; else pA += p;
  }
  return [pH, pD, pA];
}
function clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)); }

// ─── Stat helpers ──────────────────────────────────────────────────────────────

function getStatMap(sh: SHStatHistory[], key: string): Map<number, SHMatchStatRow> {
  const hist = sh.find(h => h.key === key || h.label === key);
  if (!hist) return new Map();
  const map = new Map<number, SHMatchStatRow>();
  hist.matches.forEach(m => map.set(m.eventId, m));
  return map;
}
function avgStatFromHistory(sh: SHStatHistory[], label: string, useMyValue = true): number {
  const hist = sh.find(h => h.label === label || h.key === label);
  if (!hist || !hist.matches.length) return 0;
  const total = hist.matches.reduce((s, m) => s + (useMyValue ? m.myValue : m.opponentValue), 0);
  return total / hist.matches.length;
}

// ─── Team aggregate stats ──────────────────────────────────────────────────────

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
  possession: number;
}

function computeTeamAgg(matches: Match[], sh: SHStatHistory[], possession: number): TeamAgg {
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
    avgXgFor:     hasXg ? xgF / n : 0,
    avgXgAgainst: hasXg ? xgA / n : 0,
    avgCornersFor: cF / n, avgCornersAgainst: cA / n,
    avgShots: shots / n, avgSog: sog / n,
    cleanSheetRate: cs / n, bttsRate: btts / n,
    wdl: [w / n, d / n, l / n],
    goalsScoredArr: gsArr, goalsConcededArr: gcArr,
    cornersArr: cArr, formScore,
    possession: possession || avgStatFromHistory(sh, "Possession"),
  };
}

// ─── Match dynamics ────────────────────────────────────────────────────────────

interface MatchDynamic {
  eventId: number; date: number; opponent: string; isHome: boolean;
  scored: number; conceded: number; result: "W" | "D" | "L";
  xgFor?: number; xgAgainst?: number;
  sogFor?: number; sogAgainst?: number;
  cornersFor?: number; cornersAgainst?: number;
  bccFor?: number; bccAgainst?: number;
  bcmFor?: number; possession?: number; elgConceded?: number;
  drivers: string[];
}

function buildMatchDynamics(matches: Match[], sh: SHStatHistory[]): MatchDynamic[] {
  const xgMap   = getStatMap(sh, "Expected Goals");
  const sogMap  = getStatMap(sh, "Shots On Goal");
  const shotMap = getStatMap(sh, "Shots");
  const cMap    = getStatMap(sh, "Corners");
  const bccMap  = getStatMap(sh, "Big Chance Created");
  const bcmMap  = getStatMap(sh, "Big Chance Missed");
  const posMap  = getStatMap(sh, "Possession");
  const elgMap  = getStatMap(sh, "Errors Lead To Goal");

  return matches.slice(0, 8).map(m => {
    const scored   = m.isHome ? m.homeScore : m.awayScore;
    const conceded = m.isHome ? m.awayScore : m.homeScore;
    const result: "W" | "D" | "L" = scored > conceded ? "W" : scored === conceded ? "D" : "L";
    const opponent = m.isHome ? m.awayTeamName : m.homeTeamName;
    const xr  = xgMap.get(m.eventId);
    const sgr = sogMap.get(m.eventId);
    const cr  = cMap.get(m.eventId);
    const bcc = bccMap.get(m.eventId);
    const bcm = bcmMap.get(m.eventId);
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
        if (xgF > xgA * 1.6)        drivers.push(`Dominated xG (${xgF.toFixed(1)} vs ${xgA.toFixed(1)})`);
        else if (scored > xgF + 0.7) drivers.push(`Clinical: ${scored}G from ${xgF.toFixed(1)} xG`);
      }
      if (bccF !== undefined && bccF >= 2) drivers.push(`Created ${bccF} big chances`);
      if (sogF !== undefined && sogA !== undefined && sogF > sogA + 2) drivers.push(`Shot accuracy edge (${sogF} vs ${sogA} SOG)`);
      if (conceded === 0) drivers.push("Clean sheet — defence watertight");
      if (poss !== undefined && poss >= 58) drivers.push(`Dominant possession (${poss}%)`);
      if (cF !== undefined && cA !== undefined && cF > cA + 3) drivers.push(`Set-piece threat (${cF} corners)`);
    } else if (result === "L") {
      if (xgF !== undefined && xgA !== undefined) {
        if (xgA > xgF * 1.6)          drivers.push(`Out-played: xG ${xgF.toFixed(1)} vs opp ${xgA.toFixed(1)}`);
        else if (conceded > xgA + 0.7) drivers.push(`Unlucky: conceded ${conceded} from opp ${xgA.toFixed(1)} xG`);
        else if (scored < xgF - 0.7)   drivers.push(`Wasteful: ${xgF.toFixed(1)} xG, only ${scored} goals`);
      }
      if (elgV !== undefined && elgV > 0) drivers.push(`${elgV} error${elgV > 1 ? "s" : ""} led to opp goals`);
      if (bcmF !== undefined && bcmF >= 2) drivers.push(`Missed ${bcmF} big chances`);
      if (sogF !== undefined && sogA !== undefined && sogA > sogF + 2) drivers.push(`Out-shot on target (${sogF} vs ${sogA})`);
      if (poss !== undefined && poss <= 38) drivers.push(`Pressed hard — only ${poss}% possession`);
    } else {
      if (xgF !== undefined && xgA !== undefined) {
        if (Math.abs(xgF - xgA) < 0.4) drivers.push(`Even xG (${xgF.toFixed(1)} vs ${xgA.toFixed(1)})`);
        else if (xgF > xgA + 0.5)       drivers.push(`Better xG (${xgF.toFixed(1)}) but couldn't convert`);
        else                             drivers.push(`Withstood pressure (opp xG ${xgA.toFixed(1)})`);
      }
      if (scored === 0 && conceded === 0) drivers.push("Goalless — defences dominant");
      else                                drivers.push("Open game — both teams scored");
      if (bccF !== undefined && bccA !== undefined && bccF > bccA) drivers.push(`More big chances (${bccF} vs ${bccA})`);
    }
    if (drivers.length === 0)
      drivers.push(result === "W" ? "Controlled performance" : result === "L" ? "Below-par showing" : "Balanced contest");

    return {
      eventId: m.eventId, date: m.date, opponent, isHome: m.isHome,
      scored, conceded, result,
      xgFor: xgF, xgAgainst: xgA, sogFor: sogF, sogAgainst: sogA,
      cornersFor: cF, cornersAgainst: cA, bccFor: bccF, bccAgainst: bccA,
      bcmFor: bcmF, possession: poss, elgConceded: elgV, drivers,
    };
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// STAGE 2 — POSITION MATCHUP ENGINE
// ═══════════════════════════════════════════════════════════════════════════════

function classifyPos(pos: string): "GK" | "DEF" | "MID" | "FWD" {
  const p = (pos || "").toUpperCase().trim();
  if (["G","GK","GOALKEEPER"].includes(p)) return "GK";
  if (["D","CB","LB","RB","WB","LWB","RWB","DEF","DEFENDER"].includes(p) ||
      (p.startsWith("D") && p.length <= 3 && p.length > 1)) return "DEF";
  if (["F","ST","CF","LW","RW","SS","FWD","FORWARD","ATT","W","SS"].includes(p) ||
      (p.startsWith("F") && p.length <= 3 && p.length > 1)) return "FWD";
  return "MID";
}

interface PosMetrics {
  shots90: number; sot90: number; xG90: number; goals90: number; foulsWon90: number;
  tackles90: number; interceptions90: number; clearances90: number; fouls90: number;
  keyPasses90: number; saves90: number; passes90: number;
  playerCount: number; totalMins: number;
}

function computePosMetrics(players: TeamData["players"], pos: "GK"|"DEF"|"MID"|"FWD"): PosMetrics | null {
  const group = players.filter(p => classifyPos(p.position) === pos && p.appearances >= 2);
  if (!group.length) return null;
  let shots=0, sot=0, xG=0, goals=0, foulsWon=0, keyPasses=0;
  let tackles=0, interceptions=0, clearances=0, fouls=0, saves=0, passes=0, minsTotal=0;
  for (const player of group) {
    for (const ms of player.matchStats) {
      if (!ms) continue;
      shots += ms.shots ?? 0; sot += ms.shotsOnTarget ?? 0;
      xG += ms.xG ?? 0; goals += ms.goals ?? 0; foulsWon += ms.foulsWon ?? 0;
      keyPasses += ms.keyPasses ?? 0; tackles += ms.tackles ?? 0;
      interceptions += ms.interceptions ?? 0; clearances += ms.clearances ?? 0;
      fouls += ms.fouls ?? 0; saves += ms.saves ?? 0; passes += ms.passes ?? 0;
      minsTotal += ms.minutesPlayed ?? 0;
    }
  }
  if (minsTotal === 0) return null;
  const p90 = (v: number) => (v / minsTotal) * 90;
  return {
    shots90: p90(shots), sot90: p90(sot), xG90: p90(xG),
    goals90: p90(goals), foulsWon90: p90(foulsWon), keyPasses90: p90(keyPasses),
    tackles90: p90(tackles), interceptions90: p90(interceptions),
    clearances90: p90(clearances), fouls90: p90(fouls),
    saves90: p90(saves), passes90: p90(passes),
    playerCount: group.length, totalMins: minsTotal,
  };
}

function attackThreat(m: PosMetrics | null): number {
  if (!m) return 5; // league average assumed
  return Math.min(12, m.shots90 * 1.2 + m.sot90 * 1.5 + m.xG90 * 8 + m.foulsWon90 * 0.4);
}
function defStrength(m: PosMetrics | null): number {
  if (!m) return 5;
  return Math.min(12, m.tackles90 * 0.8 + m.interceptions90 * 1.1 + m.clearances90 * 0.4 - m.fouls90 * 0.3);
}
function midStrength(m: PosMetrics | null): number {
  if (!m) return 5;
  return Math.min(12, m.passes90 * 0.04 + m.keyPasses90 * 1.5 + m.foulsWon90 * 0.8 + m.tackles90 * 0.5);
}
function gkQuality(m: PosMetrics | null): number {
  if (!m) return 3;
  return Math.min(8, m.saves90 * 0.9 + m.passes90 * 0.015);
}

interface Stage2Detail {
  label: string; homeAdj: number; awayAdj: number;
  homeScore: number | null; awayScore: number | null;
  verdict: string;
}
interface Stage2Result {
  lH_adj: number; lA_adj: number;
  details: Stage2Detail[];
  available: boolean;
  lH: number; lA: number;
  hWin: number; draw: number; aWin: number;
}

function computeStage2(
  hAgg_lH: number, hAgg_lA: number,
  homePlayers: TeamData["players"], awayPlayers: TeamData["players"],
  hName: string, aName: string
): Stage2Result {
  const homeFWD = computePosMetrics(homePlayers, "FWD");
  const awayDEF = computePosMetrics(awayPlayers, "DEF");
  const awayFWD = computePosMetrics(awayPlayers, "FWD");
  const homeDEF = computePosMetrics(homePlayers, "DEF");
  const homeMID = computePosMetrics(homePlayers, "MID");
  const awayMID = computePosMetrics(awayPlayers, "MID");
  const homeGK  = computePosMetrics(homePlayers, "GK");
  const awayGK  = computePosMetrics(awayPlayers, "GK");

  const available = !!(homeFWD || awayFWD || homeDEF || awayDEF || homeMID || awayMID);

  const details: Stage2Detail[] = [];
  let lH_delta = 0, lA_delta = 0;

  // ── FWD vs DEF (striker vs centre-backs) ──
  const hAttScore = attackThreat(homeFWD);
  const aDefScore = defStrength(awayDEF);
  const aAttScore = attackThreat(awayFWD);
  const hDefScore = defStrength(homeDEF);

  // Matchup ratio: attack edge over defense (benchmark ~5.0 each)
  const fwdMatchHome = (hAttScore / 5.0) / (aDefScore / 5.0 + 0.5);
  const fwdMatchAway = (aAttScore / 5.0) / (hDefScore / 5.0 + 0.5);
  const fwdAdjHome = (homeFWD || awayDEF) ? clamp((fwdMatchHome - 1.0) * 0.10, -0.10, 0.12) : 0;
  const fwdAdjAway = (awayFWD || homeDEF) ? clamp((fwdMatchAway - 1.0) * 0.10, -0.10, 0.12) : 0;
  lH_delta += fwdAdjHome;
  lA_delta += fwdAdjAway;
  details.push({
    label: "Strikers vs Centre-Backs",
    homeAdj: fwdAdjHome, awayAdj: fwdAdjAway,
    homeScore: (homeFWD || awayDEF) ? hAttScore : null,
    awayScore: (awayFWD || homeDEF) ? aAttScore : null,
    verdict: fwdAdjHome > 0.05 ? `${hName} strikers have clear edge over away defence`
      : fwdAdjAway > 0.05 ? `${aName} strikers have clear edge over home defence`
      : Math.abs(fwdAdjHome) <= 0.02 && Math.abs(fwdAdjAway) <= 0.02 ? "Balanced FWD vs DEF across both sides"
      : "Slight positional edge — contested matchup",
  });

  // ── Midfield battle ──
  const hMidScore = midStrength(homeMID);
  const aMidScore = midStrength(awayMID);
  const midRatio = hMidScore / Math.max(aMidScore, 0.5);
  const midAdjH = (homeMID || awayMID) ? clamp((midRatio - 1.0) * 0.06, -0.07, 0.07) : 0;
  const midAdjA = (homeMID || awayMID) ? clamp((1 / midRatio - 1.0) * 0.06, -0.07, 0.07) : 0;
  lH_delta += midAdjH;
  lA_delta += midAdjA;
  details.push({
    label: "Midfield Control & Press Resistance",
    homeAdj: midAdjH, awayAdj: midAdjA,
    homeScore: homeMID ? hMidScore : null,
    awayScore: awayMID ? aMidScore : null,
    verdict: midAdjH > 0.03 ? `${hName} midfield controls tempo and territory`
      : midAdjA > 0.03 ? `${aName} midfield controls tempo and territory`
      : "Midfield battle evenly contested",
  });

  // ── Goalkeeper impact (reduces opponent lambda) ──
  const hGKScore = gkQuality(homeGK);
  const aGKScore = gkQuality(awayGK);
  const GK_BENCH = 3.0;
  // Away GK quality → reduces home lambda; Home GK quality → reduces away lambda
  const gkAdjReduceH = awayGK ? clamp((aGKScore - GK_BENCH) / GK_BENCH * (-0.08), -0.08, 0.03) : 0;
  const gkAdjReduceA = homeGK ? clamp((hGKScore - GK_BENCH) / GK_BENCH * (-0.08), -0.08, 0.03) : 0;
  lH_delta += gkAdjReduceH;  // away GK suppresses home scoring
  lA_delta += gkAdjReduceA;  // home GK suppresses away scoring
  details.push({
    label: "Goalkeeper Shot-Stopping Impact",
    homeAdj: gkAdjReduceH, awayAdj: gkAdjReduceA,
    homeScore: homeGK ? hGKScore : null,
    awayScore: awayGK ? aGKScore : null,
    verdict: aGKScore > GK_BENCH + 1.5 ? `${aName} goalkeeper significantly reduces home scoring threat`
      : hGKScore > GK_BENCH + 1.5 ? `${hName} goalkeeper significantly reduces away scoring threat`
      : (homeGK || awayGK) ? "Goalkeepers within typical range — modest impact"
      : "No goalkeeper data available",
  });

  // ── Winger / Fullback flank battle ──
  // Proxy: home FWD foulsWon/90 (dribbling threat) vs away DEF tackles/90
  const flankAttH = homeFWD ? homeFWD.foulsWon90 * 0.6 + (homeFWD.shots90 - homeFWD.sot90) * 0.4 : 2;
  const flankDefA = awayDEF ? awayDEF.tackles90 * 0.7 + awayDEF.interceptions90 * 0.3 : 5;
  const flankAttA = awayFWD ? awayFWD.foulsWon90 * 0.6 + (awayFWD.shots90 - awayFWD.sot90) * 0.4 : 2;
  const flankDefH = homeDEF ? homeDEF.tackles90 * 0.7 + homeDEF.interceptions90 * 0.3 : 5;
  const flankAdjH = (homeFWD || awayDEF) ? clamp((flankAttH / Math.max(flankDefA, 1) - 1) * 0.05, -0.05, 0.06) : 0;
  const flankAdjA = (awayFWD || homeDEF) ? clamp((flankAttA / Math.max(flankDefH, 1) - 1) * 0.05, -0.05, 0.06) : 0;
  lH_delta += flankAdjH;
  lA_delta += flankAdjA;
  details.push({
    label: "Wingers vs Fullbacks (Flank Dominance)",
    homeAdj: flankAdjH, awayAdj: flankAdjA,
    homeScore: homeFWD ? flankAttH : null,
    awayScore: awayFWD ? flankAttA : null,
    verdict: flankAdjH > 0.03 ? `${hName} wingers threaten wide areas`
      : flankAdjA > 0.03 ? `${aName} wingers pose flank danger`
      : "Balanced wide play expected",
  });

  const finalLH = Math.max(0.3, hAgg_lH * (1 + lH_delta));
  const finalLA = Math.max(0.3, hAgg_lA * (1 + lA_delta));
  const [hWin, draw, aWin] = extractWinProbs(finalLH, finalLA);

  return { lH_adj: lH_delta, lA_adj: lA_delta, details, available, lH: finalLH, lA: finalLA, hWin, draw, aWin };
}

// ═══════════════════════════════════════════════════════════════════════════════
// STAGE 3 — PRESSURE MODELING
// ═══════════════════════════════════════════════════════════════════════════════

interface Stage3Result {
  homeOPI: number; awayOPI: number;
  homeDPI: number; awayDPI: number;
  opiVsDpi_home: string; opiVsDpi_away: string;
  lH_adj: number; lA_adj: number;
  lH: number; lA: number;
  hWin: number; draw: number; aWin: number;
}

function computeStage3(prevLH: number, prevLA: number, hAgg: TeamAgg, aAgg: TeamAgg, hSH: SHStatHistory[], aSH: SHStatHistory[], hName: string, aName: string): Stage3Result {
  // Offensive Pressure Index — how much pressure does this team apply?
  const opiOf = (sh: SHStatHistory[], shots: number, corners: number): number => {
    const bcc     = avgStatFromHistory(sh, "Big Chance Created");
    const crosses = avgStatFromHistory(sh, "Crosses");
    const finalThird = avgStatFromHistory(sh, "Touches In Opp Box");
    const raw = (shots / 12) * 3.0
      + (corners / 5) * 2.0
      + (bcc / 1.5)  * 2.5
      + (crosses / 8) * 1.5
      + (finalThird > 0 ? (finalThird / 15) * 1.0 : 0);
    return clamp(raw, 0, 10);
  };
  // Defensive Pressure Index — how well does this team suppress the opponent?
  const dpiOf = (sh: SHStatHistory[]): number => {
    const tackles  = avgStatFromHistory(sh, "Tackles");
    const intcpt   = avgStatFromHistory(sh, "Interception Won");
    const clears   = avgStatFromHistory(sh, "Total Clearance");
    const gkSaves  = avgStatFromHistory(sh, "Goalkeeper Saves");
    const fouls    = avgStatFromHistory(sh, "Fouls"); // lower = reads game better
    const raw = (tackles / 15) * 3.0
      + (intcpt / 8)  * 3.0
      + (clears / 12) * 1.5
      + (gkSaves > 0 ? (gkSaves / 5) * 1.5 : 0)
      + (fouls > 0 ? clamp((1 - fouls / 18), 0, 1) * 1.0 : 0);
    return clamp(raw, 0, 10);
  };

  const homeOPI = opiOf(hSH, hAgg.avgShots, hAgg.avgCornersFor);
  const awayOPI = opiOf(aSH, aAgg.avgShots, aAgg.avgCornersFor);
  const homeDPI = dpiOf(hSH);
  const awayDPI = dpiOf(aSH);

  // If home OPI > away DPI → home can pierce the defensive block → slight home lambda boost
  // If away DPI > home OPI → away neutralises home → slight home lambda reduction
  const homeOPIvADPI = homeOPI - awayDPI;
  const awayOPIvHDPI = awayOPI - homeDPI;
  const lH_adj = clamp(homeOPIvADPI / 10 * 0.07, -0.06, 0.07);
  const lA_adj = clamp(awayOPIvHDPI / 10 * 0.07, -0.06, 0.07);

  const finalLH = Math.max(0.3, prevLH * (1 + lH_adj));
  const finalLA = Math.max(0.3, prevLA * (1 + lA_adj));
  const [hWin, draw, aWin] = extractWinProbs(finalLH, finalLA);

  const opiLabel = (opi: number, dpi: number, attName: string, defName: string) =>
    opi > dpi + 2 ? `${attName} sustained pressure overwhelms ${defName} block`
    : opi > dpi + 0.5 ? `${attName} creates more than ${defName} can absorb`
    : dpi > opi + 2 ? `${defName} neutralises ${attName} offensive output`
    : "Balanced pressure exchange expected";

  return {
    homeOPI, awayOPI, homeDPI, awayDPI,
    opiVsDpi_home: opiLabel(homeOPI, awayDPI, hName, aName),
    opiVsDpi_away: opiLabel(awayOPI, homeDPI, aName, hName),
    lH_adj, lA_adj, lH: finalLH, lA: finalLA, hWin, draw, aWin,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// STAGE 4 — TACTICAL INTERACTION LAYER
// ═══════════════════════════════════════════════════════════════════════════════

interface Stage4Result {
  homeStyle: string; awayStyle: string;
  interaction: string;
  lH_adj: number; lA_adj: number;
  lH: number; lA: number;
  hWin: number; draw: number; aWin: number;
}

function detectStyle(agg: TeamAgg, sh: SHStatHistory[]): string {
  const poss    = agg.possession || avgStatFromHistory(sh, "Possession");
  const corners = agg.avgCornersFor;
  const crosses = avgStatFromHistory(sh, "Crosses");
  const fouls   = avgStatFromHistory(sh, "Fouls");
  const shots   = agg.avgShots;
  const xgEff   = agg.avgXgFor > 0 ? agg.avgScored / agg.avgXgFor : 1.0;

  if (poss > 56) return "Possession-based";
  if (poss < 42) return fouls > 14 ? "Physical/Counter" : "Direct/Counter";
  if (corners > 6 && crosses > 10) return "Wide/Crossing";
  if (shots > 16 && xgEff > 1.1) return "Clinical/High-tempo";
  if (fouls > 15) return "Physical/Press";
  return "Balanced";
}

function computeStage4(prevLH: number, prevLA: number, hAgg: TeamAgg, aAgg: TeamAgg, hSH: SHStatHistory[], aSH: SHStatHistory[], hName: string, aName: string): Stage4Result {
  const homeStyle = detectStyle(hAgg, hSH);
  const awayStyle = detectStyle(aAgg, aSH);

  let lH_adj = 0, lA_adj = 0, interaction = "";

  // High possession home vs direct/counter away → counter-threat is real, slightly increases away lambda
  if (homeStyle.includes("Possession") && awayStyle.includes("Counter")) {
    lH_adj = 0.02; lA_adj = 0.04;
    interaction = `${hName} build-up play creates counter-attack opportunities for ${aName}`;
  }
  // Direct home vs possession away → home transitions disrupt away rhythm
  else if (homeStyle.includes("Counter") && awayStyle.includes("Possession")) {
    lH_adj = 0.04; lA_adj = 0.02;
    interaction = `${hName} transitions threaten ${aName}'s possession structure`;
  }
  // Both possession: slow tempo, more draws, fewer goals
  else if (homeStyle.includes("Possession") && awayStyle.includes("Possession")) {
    lH_adj = -0.02; lA_adj = -0.02;
    interaction = "Both possession teams — expect controlled, lower-scoring match";
  }
  // Wide/crossing vs physical: set-piece danger
  else if (homeStyle.includes("Wide") || awayStyle.includes("Wide")) {
    lH_adj = homeStyle.includes("Wide") ? 0.03 : 0.01;
    lA_adj = awayStyle.includes("Wide") ? 0.03 : 0.01;
    interaction = "Wide play and crossing threat — set-pieces and aerial duels decisive";
  }
  // Physical vs clinical
  else if (homeStyle.includes("Physical") && awayStyle.includes("Clinical")) {
    lH_adj = 0.01; lA_adj = 0.03;
    interaction = `${aName} clinical efficiency may punish ${hName}'s physical approach`;
  }
  else if (awayStyle.includes("Physical") && homeStyle.includes("Clinical")) {
    lH_adj = 0.03; lA_adj = 0.01;
    interaction = `${hName} clinical efficiency may punish ${aName}'s physical approach`;
  }
  // Default: slight home advantage from tactical familiarity
  else {
    lH_adj = 0.02; lA_adj = 0.00;
    interaction = `Balanced tactical matchup — home advantage applies`;
  }

  const finalLH = Math.max(0.3, prevLH * (1 + lH_adj));
  const finalLA = Math.max(0.3, prevLA * (1 + lA_adj));
  const [hWin, draw, aWin] = extractWinProbs(finalLH, finalLA);

  return { homeStyle, awayStyle, interaction, lH_adj, lA_adj, lH: finalLH, lA: finalLA, hWin, draw, aWin };
}

// ═══════════════════════════════════════════════════════════════════════════════
// MASTER PIPELINE — All 5 stages
// ═══════════════════════════════════════════════════════════════════════════════

interface StageReport {
  stage1: { lH: number; lA: number; hWin: number; draw: number; aWin: number; hFormScore: number; aFormScore: number; hXg: number; aXg: number; };
  stage2: Stage2Result;
  stage3: Stage3Result;
  stage4: Stage4Result;
  final:  { lH: number; lA: number; hWin: number; draw: number; aWin: number; totalAdjH: number; totalAdjA: number; };
}

function computeMultiStageLambdas(
  hAgg: TeamAgg, aAgg: TeamAgg,
  homePlayers: TeamData["players"], awayPlayers: TeamData["players"],
  hSH: SHStatHistory[], aSH: SHStatHistory[],
  hName: string, aName: string
): { lH: number; lA: number; report: StageReport } {

  // ── Stage 1: Team Baseline ──
  const hAttack = hAgg.avgXgFor  > 0 ? 0.55 * hAgg.avgScored + 0.45 * hAgg.avgXgFor   : hAgg.avgScored;
  const hDefend = hAgg.avgXgAgainst > 0 ? 0.55 * hAgg.avgConceded + 0.45 * hAgg.avgXgAgainst : hAgg.avgConceded;
  const aAttack = aAgg.avgXgFor  > 0 ? 0.55 * aAgg.avgScored + 0.45 * aAgg.avgXgFor   : aAgg.avgScored;
  const aDefend = aAgg.avgXgAgainst > 0 ? 0.55 * aAgg.avgConceded + 0.45 * aAgg.avgXgAgainst : aAgg.avgConceded;
  // Form score adjusts attack expectation slightly
  const formAdj = clamp((hAgg.formScore - aAgg.formScore) / 20 * 0.06, -0.04, 0.04);
  const HOME_ADV = 0.22;
  const lH_stage1 = Math.max(0.3, (hAttack + aDefend) / 2 + HOME_ADV + formAdj);
  const lA_stage1 = Math.max(0.3, (aAttack + hDefend) / 2 - formAdj);
  const [h1Win, d1, a1Win] = extractWinProbs(lH_stage1, lA_stage1);

  const stage1 = {
    lH: lH_stage1, lA: lA_stage1, hWin: h1Win, draw: d1, aWin: a1Win,
    hFormScore: hAgg.formScore, aFormScore: aAgg.formScore,
    hXg: hAgg.avgXgFor, aXg: aAgg.avgXgFor,
  };

  // ── Stage 2: Position Matchups ──
  const stage2 = computeStage2(lH_stage1, lA_stage1, homePlayers, awayPlayers, hName, aName);

  // ── Stage 3: Pressure Model ──
  const stage3 = computeStage3(stage2.lH, stage2.lA, hAgg, aAgg, hSH, aSH, hName, aName);

  // ── Stage 4: Tactical Interaction ──
  const stage4 = computeStage4(stage3.lH, stage3.lA, hAgg, aAgg, hSH, aSH, hName, aName);

  // ── Final ──
  const totalAdjH = (stage4.lH / lH_stage1) - 1;
  const totalAdjA = (stage4.lA / lA_stage1) - 1;
  const [fWin, fDraw, fAWin] = extractWinProbs(stage4.lH, stage4.lA);
  const finalResult = { lH: stage4.lH, lA: stage4.lA, hWin: fWin, draw: fDraw, aWin: fAWin, totalAdjH, totalAdjA };

  return {
    lH: stage4.lH, lA: stage4.lA,
    report: { stage1, stage2, stage3, stage4, final: finalResult },
  };
}

// ─── Market computation ────────────────────────────────────────────────────────

interface OddsEntry { label: string; prob: number; odds: number; hl: "green" | "amber" | "gray"; }
interface MarketGroup { title: string; entries: OddsEntry[]; }

function oddsFrom(p: number): number { return Math.round((1 / Math.max(0.005, p)) * 100) / 100; }
function hlOf(p: number): "green" | "amber" | "gray" { return p >= 0.55 ? "green" : p >= 0.33 ? "amber" : "gray"; }
function e(label: string, prob: number): OddsEntry { return { label, prob, odds: oddsFrom(prob), hl: hlOf(prob) }; }

function computeMarkets(matrix: number[][], hAgg: TeamAgg, aAgg: TeamAgg, lH: number, lA: number, hName: string, aName: string): MarketGroup[] {
  const MAX = matrix.length - 1;
  let pH = 0, pD = 0, pA = 0;
  for (let h = 0; h <= MAX; h++) for (let a = 0; a <= MAX; a++) {
    const p = matrix[h][a];
    if (h > a) pH += p; else if (h === a) pD += p; else pA += p;
  }
  const tg: number[] = Array(MAX * 2 + 1).fill(0);
  for (let h = 0; h <= MAX; h++) for (let a = 0; a <= MAX; a++) if (h + a < tg.length) tg[h + a] += matrix[h][a];
  const over  = (line: number) => tg.slice(Math.floor(line) + 1).reduce((s, v) => s + v, 0);
  const exact = (n: number) => tg[n] ?? 0;
  let pBTTS = 0;
  for (let h = 1; h <= MAX; h++) for (let a = 1; a <= MAX; a++) pBTTS += matrix[h][a];
  const pNoBTTS = 1 - pBTTS;
  let pBTTS_H = 0, pBTTS_D = 0, pBTTS_A = 0;
  for (let h = 1; h <= MAX; h++) for (let a = 1; a <= MAX; a++) {
    const p = matrix[h][a];
    if (h > a) pBTTS_H += p; else if (h === a) pBTTS_D += p; else pBTTS_A += p;
  }
  let pHCS = 0, pACS = 0, pHWTN = 0, pAWTN = 0;
  for (let h = 0; h <= MAX; h++) { pHCS += matrix[h][0]; if (h > 0) pHWTN += matrix[h][0]; }
  for (let a = 0; a <= MAX; a++) { pACS += matrix[0][a]; if (a > 0) pAWTN += matrix[0][a]; }
  const hGoals: number[] = Array(MAX + 1).fill(0);
  const aGoals: number[] = Array(MAX + 1).fill(0);
  for (let h = 0; h <= MAX; h++) for (let a = 0; a <= MAX; a++) { hGoals[h] += matrix[h][a]; aGoals[a] += matrix[h][a]; }
  const hOver = (n: number) => hGoals.slice(n + 1).reduce((s, v) => s + v, 0);
  const aOver = (n: number) => aGoals.slice(n + 1).reduce((s, v) => s + v, 0);
  let pOdd = 0, pEven = 0;
  tg.forEach((p, t) => { if (t % 2 === 1) pOdd += p; else pEven += p; });
  let pHOdd = 0, pHEven = 0, pAOdd = 0, pAEven = 0;
  hGoals.forEach((p, h) => { if (h % 2 === 1) pHOdd += p; else pHEven += p; });
  aGoals.forEach((p, a) => { if (a % 2 === 1) pAOdd += p; else pAEven += p; });
  let pM1 = 0, pM2 = 0, pM3p = 0;
  for (let h = 0; h <= MAX; h++) for (let a = 0; a <= MAX; a++) {
    const diff = Math.abs(h - a);
    if (diff === 1) pM1 += matrix[h][a]; else if (diff === 2) pM2 += matrix[h][a]; else if (diff >= 3) pM3p += matrix[h][a];
  }
  const ah = (line: number) => {
    let home = 0, away = 0, push = 0;
    for (let h = 0; h <= MAX; h++) for (let a = 0; a <= MAX; a++) {
      const diff = h - a;
      if (diff > line) home += matrix[h][a]; else if (diff < line) away += matrix[h][a]; else push += matrix[h][a];
    }
    return { home, away, push };
  };
  const ah_neg05=ah(-0.5),ah_pos05=ah(0.5),ah_neg1=ah(-1),ah_pos1=ah(1),ah_neg15=ah(-1.5),ah_pos15=ah(1.5),ah_neg25=ah(-2.5),ah_pos25=ah(2.5);
  const hCorL = (hAgg.avgCornersFor + aAgg.avgCornersAgainst) / 2;
  const aCorL = (aAgg.avgCornersFor + hAgg.avgCornersAgainst) / 2;
  const totCorL = (hCorL + aCorL) > 0 ? hCorL + aCorL : 9.5;
  const corOver = (line: number) => { let s = 0; const th = Math.floor(line)+1; for (let k=th;k<=30;k++) s+=poissonPMF(totCorL,k); return s; };
  const htMatrix = buildScoreMatrix(lH * 0.43, lA * 0.43, 5);
  const sh2Matrix = buildScoreMatrix(lH * 0.57, lA * 0.57, 6);
  const htftProb: Record<string, number> = {};
  for (let h1=0;h1<=5;h1++) for (let a1=0;a1<=5;a1++) {
    const pHT=htMatrix[h1]?.[a1]??0; if (pHT<1e-8) continue;
    const htR=h1>a1?"H":h1===a1?"D":"A";
    for (let h2=0;h2<=6;h2++) for (let a2=0;a2<=6;a2++) {
      const p2=sh2Matrix[h2]?.[a2]??0; if (p2<1e-8) continue;
      const ftR=(h1+h2)>(a1+a2)?"H":(h1+h2)===(a1+a2)?"D":"A";
      const key=`${htR}/${ftR}`; htftProb[key]=(htftProb[key]??0)+pHT*p2;
    }
  }
  let pHT_H=0,pHT_D=0,pHT_A=0;
  for (let h=0;h<=5;h++) for (let a=0;a<=5;a++) { const p=htMatrix[h]?.[a]??0; if(h>a)pHT_H+=p; else if(h===a)pHT_D+=p; else pHT_A+=p; }
  const htTg:number[]=Array(10).fill(0);
  for (let h=0;h<=5;h++) for (let a=0;a<=5;a++) if(h+a<htTg.length) htTg[h+a]+=(htMatrix[h]?.[a]??0);
  const resultGoal=(cond:(h:number,a:number)=>boolean,gCond:(h:number,a:number)=>boolean)=>{let p=0;for(let h=0;h<=MAX;h++)for(let a=0;a<=MAX;a++)if(cond(h,a)&&gCond(h,a))p+=matrix[h][a];return p;};
  const hWin=(h:number,a:number)=>h>a,aWin=(h:number,a:number)=>a>h,draw=(h:number,a:number)=>h===a;
  const ov25=(h:number,a:number)=>h+a>2.5,un25=(h:number,a:number)=>h+a<=2,ov35=(h:number,a:number)=>h+a>3.5;
  const allScores:{h:number;a:number;p:number}[]=[];
  for (let h=0;h<=MAX;h++) for (let a=0;a<=MAX;a++) allScores.push({h,a,p:matrix[h][a]});
  const topScores=allScores.sort((x,y)=>y.p-x.p).slice(0,16);

  return [
    { title:"1X2 — Match Result", entries:[e(`${hName} Win`,pH),e("Draw",pD),e(`${aName} Win`,pA)] },
    { title:"Double Chance", entries:[e(`${hName} or Draw`,pH+pD),e(`${aName} or Draw`,pA+pD),e(`${hName} or ${aName}`,pH+pA)] },
    { title:"Draw No Bet", entries:[e(hName,pH/(pH+pA)),e(aName,pA/(pH+pA))] },
    { title:"Either Team Wins", entries:[e("Either Team Wins",pH+pA),e("Draw",pD)] },
    { title:"Total Goals — Over / Under", entries:[e("Over 0.5",over(0.5)),e("Under 0.5",1-over(0.5)),e("Over 1.5",over(1.5)),e("Under 1.5",1-over(1.5)),e("Over 2.5",over(2.5)),e("Under 2.5",1-over(2.5)),e("Over 3.5",over(3.5)),e("Under 3.5",1-over(3.5)),e("Over 4.5",over(4.5)),e("Under 4.5",1-over(4.5)),e("Over 5.5",over(5.5)),e("Under 5.5",1-over(5.5))] },
    { title:"Goal Line", entries:[e("GL 1.5 Over",over(1.5)),e("GL 1.5 Under",1-over(1.5)),e("GL 2.5 Over",over(2.5)),e("GL 2.5 Under",1-over(2.5)),e("GL 3.5 Over",over(3.5)),e("GL 3.5 Under",1-over(3.5)),e("GL 4.5 Over",over(4.5)),e("GL 4.5 Under",1-over(4.5))] },
    { title:"Exact Goals Number", entries:[0,1,2,3,4,5,6].map(n=>e(`${n} Goals`,exact(n))) },
    { title:"Multi Goal", entries:[e("1–2 Goals",exact(1)+exact(2)),e("2–3 Goals",exact(2)+exact(3)),e("3–4 Goals",exact(3)+exact(4)),e("1–3 Goals",exact(1)+exact(2)+exact(3)),e("2–4 Goals",exact(2)+exact(3)+exact(4)),e("3–5 Goals",exact(3)+exact(4)+exact(5)),e("4+ Goals",tg.slice(4).reduce((s,v)=>s+v,0))] },
    { title:"Both Teams To Score", entries:[e("Yes (BTTS)",pBTTS),e("No (BTTS)",pNoBTTS)] },
    { title:"Goal / No Goal", entries:[e("Goal (both score)",pBTTS),e("No Goal (≥1 blank)",pNoBTTS)] },
    { title:"Odd / Even — Total Goals", entries:[e("Odd",pOdd),e("Even",pEven)] },
    { title:`Individual Total Goals — ${hName}`, entries:[e("Over 0.5",hOver(0)),e("Under 0.5",1-hOver(0)),e("Over 1.5",hOver(1)),e("Under 1.5",1-hOver(1)),e("Over 2.5",hOver(2)),e("Under 2.5",1-hOver(2))] },
    { title:`Individual Total Goals — ${aName}`, entries:[e("Over 0.5",aOver(0)),e("Under 0.5",1-aOver(0)),e("Over 1.5",aOver(1)),e("Under 1.5",1-aOver(1)),e("Over 2.5",aOver(2)),e("Under 2.5",1-aOver(2))] },
    { title:`Individual Odd/Even — ${hName}`, entries:[e("Odd",pHOdd),e("Even",pHEven)] },
    { title:`Individual Odd/Even — ${aName}`, entries:[e("Odd",pAOdd),e("Even",pAEven)] },
    { title:"Asian Handicap", entries:[e(`${hName} −0.5`,ah_neg05.home),e(`${aName} +0.5`,ah_neg05.away),e(`${hName} −1.0`,ah_neg1.home),e(`${aName} +1.0`,ah_neg1.away),e(`${hName} −1.5`,ah_neg15.home),e(`${aName} +1.5`,ah_neg15.away),e(`${hName} −2.5`,ah_neg25.home),e(`${aName} +2.5`,ah_neg25.away),e(`${hName} +0.5`,ah_pos05.home),e(`${aName} −0.5`,ah_pos05.away),e(`${hName} +1.5`,ah_pos15.home),e(`${aName} −1.5`,ah_pos15.away)] },
    { title:"European Handicap", entries:[e(`${hName} −1`,ah_neg1.home),e(`Draw −1`,ah_neg1.push),e(`${aName} −1`,ah_neg1.away),e(`${hName} +1`,ah_pos1.home),e(`Draw +1`,ah_pos1.push),e(`${aName} +1`,ah_pos1.away),e(`${hName} −2`,ah_neg25.home),e(`Draw −2`,ah_neg25.push),e(`${aName} −2`,ah_neg25.away)] },
    { title:"Corners — Total Over / Under", entries: totCorL>0 ? [e("Over 7.5",corOver(7.5)),e("Under 7.5",1-corOver(7.5)),e("Over 8.5",corOver(8.5)),e("Under 8.5",1-corOver(8.5)),e("Over 9.5",corOver(9.5)),e("Under 9.5",1-corOver(9.5)),e("Over 10.5",corOver(10.5)),e("Under 10.5",1-corOver(10.5)),e("Over 11.5",corOver(11.5)),e("Under 11.5",1-corOver(11.5)),e("Over 12.5",corOver(12.5)),e("Under 12.5",1-corOver(12.5))] : [{label:"Insufficient corner data",prob:0,odds:0,hl:"gray"}] },
    { title:"1X2 By Intervals — Half Time", entries:[e(`${hName} HT`,pHT_H),e("Draw HT",pHT_D),e(`${aName} HT`,pHT_A)] },
    { title:"Total Goals By Intervals", entries:[e("HT Over 0.5",htTg.slice(1).reduce((s,v)=>s+v,0)),e("HT Under 0.5",htTg[0]??0),e("HT Over 1.5",htTg.slice(2).reduce((s,v)=>s+v,0)),e("HT Under 1.5",(htTg[0]??0)+(htTg[1]??0)),e("HT Over 2.5",htTg.slice(3).reduce((s,v)=>s+v,0)),e("HT Under 2.5",(htTg[0]??0)+(htTg[1]??0)+(htTg[2]??0)),e("FT Over 1.5",over(1.5)),e("FT Over 2.5",over(2.5)),e("FT Over 3.5",over(3.5))] },
    { title:"Half Time / Full Time", entries:[e(`${hName}/${hName}`,htftProb["H/H"]??0),e(`Draw/${hName}`,htftProb["D/H"]??0),e(`${aName}/${hName}`,htftProb["A/H"]??0),e(`${hName}/Draw`,htftProb["H/D"]??0),e("Draw/Draw",htftProb["D/D"]??0),e(`${aName}/Draw`,htftProb["A/D"]??0),e(`${hName}/${aName}`,htftProb["H/A"]??0),e(`Draw/${aName}`,htftProb["D/A"]??0),e(`${aName}/${aName}`,htftProb["A/A"]??0)].sort((x,y)=>y.prob-x.prob) },
    { title:"Highest Scoring Half", entries:[e("1st Half More Goals",0.30),e("Equal Both Halves",0.21),e("2nd Half More Goals",0.49)] },
    { title:"Will Win Either Half", entries:[e(`${hName} wins ≥1 half`,Math.min(0.92,pH*1.35+pD*0.4)),e(`${aName} wins ≥1 half`,Math.min(0.92,pA*1.35+pD*0.4))] },
    { title:"Result / Both Teams To Score", entries:[e(`${hName} Win & BTTS`,pBTTS_H),e("Draw & BTTS",pBTTS_D),e(`${aName} Win & BTTS`,pBTTS_A),e(`${hName} Win & No BTTS`,pH-pBTTS_H),e(`${aName} Win & No BTTS`,pA-pBTTS_A)] },
    { title:"Clean Sheet", entries:[e(`${hName} Clean Sheet`,pHCS),e(`${hName} No Clean Sheet`,1-pHCS),e(`${aName} Clean Sheet`,pACS),e(`${aName} No Clean Sheet`,1-pACS)] },
    { title:"Win To Nil", entries:[e(`${hName} Win to Nil`,pHWTN),e(`${aName} Win to Nil`,pAWTN)] },
    { title:"Winning Margin", entries:[e("Draw — No Winner",pD),e("Win by Exactly 1",pM1),e("Win by Exactly 2",pM2),e("Win by 3 or More",pM3p)] },
    { title:"Scoring Draw", entries:[e("Any Scoring Draw",pBTTS_D),e("0-0 Goalless",matrix[0]?.[0]??0),e("1-1",matrix[1]?.[1]??0),e("2-2",matrix[2]?.[2]??0),e("3-3",matrix[3]?.[3]??0)] },
    { title:"Result / Total Goals", entries:[e(`${hName} Win & Over 2.5`,resultGoal(hWin,ov25)),e(`${hName} Win & Under 2.5`,resultGoal(hWin,un25)),e(`${hName} Win & Over 3.5`,resultGoal(hWin,ov35)),e("Draw & Over 2.5",resultGoal(draw,ov25)),e("Draw & Under 2.5",resultGoal(draw,un25)),e(`${aName} Win & Over 2.5`,resultGoal(aWin,ov25)),e(`${aName} Win & Under 2.5`,resultGoal(aWin,un25)),e(`${aName} Win & Over 3.5`,resultGoal(aWin,ov35))] },
    { title:"Home Result / Total Goals", entries:[e(`${hName} Win & Over 2.5`,resultGoal(hWin,ov25)),e(`${hName} Win & Under 2.5`,resultGoal(hWin,un25)),e(`${hName} Not Win & Over 2.5`,resultGoal((h,a)=>h<=a,ov25)),e(`${hName} Not Win & Under 2.5`,resultGoal((h,a)=>h<=a,un25))] },
    { title:"Away Result / Total Goals", entries:[e(`${aName} Win & Over 2.5`,resultGoal(aWin,ov25)),e(`${aName} Win & Under 2.5`,resultGoal(aWin,un25)),e(`${aName} Not Win & Over 2.5`,resultGoal((h,a)=>a<=h,ov25)),e(`${aName} Not Win & Under 2.5`,resultGoal((h,a)=>a<=h,un25))] },
    { title:"Double Chance / Combo", entries:[e(`(${hName} or Draw) & BTTS`,(()=>{let p=0;for(let h=1;h<=MAX;h++)for(let a=1;a<=MAX;a++)if(h>=a)p+=matrix[h][a];return p;})()),e(`(${aName} or Draw) & BTTS`,(()=>{let p=0;for(let h=1;h<=MAX;h++)for(let a=1;a<=MAX;a++)if(a>=h)p+=matrix[h][a];return p;})()),e(`(${hName} or ${aName}) & BTTS`,(()=>{let p=0;for(let h=1;h<=MAX;h++)for(let a=1;a<=MAX;a++)if(h!==a)p+=matrix[h][a];return p;})()),e(`(${hName} or Draw) & No BTTS`,(()=>{let p=0;for(let h=0;h<=MAX;h++)for(let a=0;a<=MAX;a++)if(h>=a&&!(h>0&&a>0))p+=matrix[h][a];return p;})()),e(`(${aName} or Draw) & No BTTS`,(()=>{let p=0;for(let h=0;h<=MAX;h++)for(let a=0;a<=MAX;a++)if(a>=h&&!(h>0&&a>0))p+=matrix[h][a];return p;})())] },
    { title:"Correct Score", entries:topScores.map(({h,a,p})=>e(`${h} − ${a}`,p)) },
  ];
}

// ─── Confidence rating ─────────────────────────────────────────────────────────

function modelConfidence(hAgg: TeamAgg, aAgg: TeamAgg, hasPlayers: boolean): { label: string; color: string; score: number } {
  const n = Math.min(hAgg.n, aAgg.n);
  const hasXg = hAgg.avgXgFor > 0 && aAgg.avgXgFor > 0;
  const score = Math.min(100, n * 3.5 + (hasXg ? 20 : 0) + (hasPlayers ? 15 : 0));
  if (score >= 70) return { label: "HIGH", color: "text-green-400", score };
  if (score >= 45) return { label: "MEDIUM", color: "text-yellow-400", score };
  return { label: "LOW", color: "text-red-400", score };
}

// ─── UI helpers ────────────────────────────────────────────────────────────────

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
            <span className={`text-[11px] font-mono w-10 text-right tabular-nums ${hlColor(entry.hl)}`}>{Math.round(entry.prob * 100)}%</span>
            <span className="text-[11px] font-mono w-12 text-right tabular-nums text-muted-foreground">{entry.odds.toFixed(2)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function DynamicRow({ d }: { d: MatchDynamic }) {
  const rColor = d.result==="W"?"bg-green-500":d.result==="D"?"bg-yellow-500":"bg-red-500";
  const dateStr = format(new Date(d.date * 1000), "dd MMM");
  return (
    <div className="border border-border/30 bg-card/20 p-3 space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <span className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded text-black ${rColor}`}>{d.result}</span>
        <span className="text-xs font-mono text-foreground/90 font-semibold">{d.scored}–{d.conceded}</span>
        <span className="text-[10px] text-muted-foreground">vs {d.opponent}</span>
        <span className="text-[10px] text-muted-foreground ml-auto">{dateStr} {d.isHome?"(H)":"(A)"}</span>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-0.5">
        {d.xgFor!==undefined&&<span className="text-[10px] font-mono text-muted-foreground">xG <span className="text-foreground/70">{d.xgFor.toFixed(1)}</span>:{d.xgAgainst?.toFixed(1)}</span>}
        {d.sogFor!==undefined&&<span className="text-[10px] font-mono text-muted-foreground">SOG <span className="text-foreground/70">{d.sogFor}</span>:{d.sogAgainst}</span>}
        {d.cornersFor!==undefined&&<span className="text-[10px] font-mono text-muted-foreground">COR <span className="text-foreground/70">{d.cornersFor}</span>:{d.cornersAgainst}</span>}
        {d.possession!==undefined&&<span className="text-[10px] font-mono text-muted-foreground">POS <span className="text-foreground/70">{d.possession}%</span></span>}
        {d.bccFor!==undefined&&<span className="text-[10px] font-mono text-muted-foreground">BCC <span className="text-foreground/70">{d.bccFor}</span>:{d.bccAgainst}</span>}
      </div>
      <div className="flex flex-wrap gap-1">
        {d.drivers.map((dr,i)=>(
          <span key={i} className={`text-[10px] px-1.5 py-0.5 rounded font-mono ${d.result==="W"?"bg-green-900/40 text-green-300":d.result==="L"?"bg-red-900/40 text-red-300":"bg-yellow-900/40 text-yellow-300"}`}>{dr}</span>
        ))}
      </div>
    </div>
  );
}

// ─── Model Pipeline Report UI ──────────────────────────────────────────────────

function AdjBadge({ adj }: { adj: number }) {
  const pct = (adj * 100).toFixed(1);
  const sign = adj > 0 ? "+" : "";
  const color = Math.abs(adj) < 0.01 ? "text-muted-foreground" : adj > 0 ? "text-green-400" : "text-red-400";
  return <span className={`text-[10px] font-mono font-bold tabular-nums ${color}`}>{sign}{pct}%</span>;
}

function WinProbRow({ hWin, draw, aWin, hName, aName, hColor, aColor }: {
  hWin: number; draw: number; aWin: number;
  hName: string; aName: string;
  hColor: string; aColor: string;
}) {
  return (
    <div className="flex items-center gap-3 mt-2">
      <div className="flex-1 text-center">
        <div className="text-base font-bold font-mono" style={{ color: hColor }}>{Math.round(hWin * 100)}%</div>
        <div className="text-[8px] font-mono text-muted-foreground uppercase truncate">{hName}</div>
      </div>
      <div className="text-center">
        <div className="text-base font-bold font-mono text-muted-foreground">{Math.round(draw * 100)}%</div>
        <div className="text-[8px] font-mono text-muted-foreground uppercase">Draw</div>
      </div>
      <div className="flex-1 text-center">
        <div className="text-base font-bold font-mono" style={{ color: aColor }}>{Math.round(aWin * 100)}%</div>
        <div className="text-[8px] font-mono text-muted-foreground uppercase truncate">{aName}</div>
      </div>
    </div>
  );
}

function ScoreBar({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  const pct = Math.min(100, (value / max) * 100);
  return (
    <div className="flex items-center gap-2">
      <span className="text-[9px] font-mono text-muted-foreground/60 w-8 text-right">{value.toFixed(1)}</span>
      <div className="flex-1 h-1.5 bg-white/8 rounded-full overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
      <span className="text-[9px] font-mono text-muted-foreground/50 w-16 truncate">{label}</span>
    </div>
  );
}

function StageBlock({ title, number, children }: { title: string; number: number; children: React.ReactNode }) {
  return (
    <div className="border border-border/40 bg-card/20 overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 bg-primary/8 border-b border-border/30">
        <div className="w-5 h-5 rounded-full bg-primary/20 border border-primary/40 flex items-center justify-center">
          <span className="text-[9px] font-mono font-bold text-primary">{number}</span>
        </div>
        <span className="text-[10px] font-mono uppercase tracking-[0.2em] text-primary/80">{title}</span>
      </div>
      <div className="p-3 space-y-2">{children}</div>
    </div>
  );
}

function ModelPipeline({ report, hName, aName, hColor, aColor }: {
  report: StageReport; hName: string; aName: string; hColor: string; aColor: string;
}) {
  return (
    <div className="space-y-3">
      {/* Stage 1 */}
      <StageBlock number={1} title="Team Baseline — Form & Expected Goals">
        <div className="grid grid-cols-2 gap-3 text-[10px] font-mono">
          {[
            { name: hName, color: hColor, lam: report.stage1.lH, xg: report.stage1.hXg, form: report.stage1.hFormScore },
            { name: aName, color: aColor, lam: report.stage1.lA, xg: report.stage1.aXg, form: report.stage1.aFormScore },
          ].map(t => (
            <div key={t.name} className="border border-border/25 p-2 space-y-1">
              <div className="font-bold truncate" style={{ color: t.color }}>{t.name}</div>
              <div className="text-muted-foreground">λ = <span className="text-foreground/80">{t.lam.toFixed(2)} xG</span></div>
              {t.xg > 0 && <div className="text-muted-foreground">xG/g = <span className="text-foreground/80">{t.xg.toFixed(2)}</span></div>}
              <div className="text-muted-foreground">Form = <span className="text-foreground/80">{t.form.toFixed(1)}</span></div>
            </div>
          ))}
        </div>
        <WinProbRow hWin={report.stage1.hWin} draw={report.stage1.draw} aWin={report.stage1.aWin} hName={hName} aName={aName} hColor={hColor} aColor={aColor} />
      </StageBlock>

      {/* Connector */}
      <div className="flex items-center gap-2 px-4">
        <div className="flex-1 h-px bg-primary/20" />
        <span className="text-[8px] font-mono text-primary/40 uppercase tracking-widest">↓ Player Matchup Adjustments</span>
        <div className="flex-1 h-px bg-primary/20" />
      </div>

      {/* Stage 2 */}
      <StageBlock number={2} title="Position Matchup Engine — FWD vs DEF, Midfield, GK">
        {!report.stage2.available ? (
          <p className="text-[9px] font-mono text-muted-foreground/50 text-center py-2">No player data — matchup analysis unavailable</p>
        ) : (
          <div className="space-y-2">
            {report.stage2.details.map((d, i) => (
              <div key={i} className="border border-border/20 bg-card/10 p-2 space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[9px] font-mono text-muted-foreground uppercase tracking-wide">{d.label}</span>
                  <div className="flex items-center gap-3 text-[9px] font-mono text-muted-foreground">
                    <span style={{ color: hColor }}>{hName}: <AdjBadge adj={d.homeAdj} /></span>
                    <span style={{ color: aColor }}>{aName}: <AdjBadge adj={d.awayAdj} /></span>
                  </div>
                </div>
                <p className="text-[9px] font-mono text-muted-foreground/60 leading-tight">{d.verdict}</p>
                {d.homeScore !== null && d.awayScore !== null && (
                  <div className="flex items-center gap-2 pt-0.5">
                    <ScoreBar label={hName} value={d.homeScore} max={12} color={hColor} />
                    <span className="text-[8px] text-muted-foreground/30 font-mono">vs</span>
                    <ScoreBar label={aName} value={d.awayScore} max={12} color={aColor} />
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
        <div className="border-t border-border/20 pt-2">
          <div className="flex items-center justify-between text-[9px] font-mono mb-1">
            <span className="text-muted-foreground/50">Adjusted lambdas:</span>
            <span style={{ color: hColor }}>{hName} λ={report.stage2.lH.toFixed(2)}</span>
            <span style={{ color: aColor }}>{aName} λ={report.stage2.lA.toFixed(2)}</span>
          </div>
          <WinProbRow hWin={report.stage2.hWin} draw={report.stage2.draw} aWin={report.stage2.aWin} hName={hName} aName={aName} hColor={hColor} aColor={aColor} />
        </div>
      </StageBlock>

      {/* Connector */}
      <div className="flex items-center gap-2 px-4">
        <div className="flex-1 h-px bg-primary/20" />
        <span className="text-[8px] font-mono text-primary/40 uppercase tracking-widest">↓ Pressure Modeling</span>
        <div className="flex-1 h-px bg-primary/20" />
      </div>

      {/* Stage 3 */}
      <StageBlock number={3} title="Pressure Modeling — Offensive vs Defensive Index">
        <div className="grid grid-cols-2 gap-3">
          {[
            { name: hName, color: hColor, opi: report.stage3.homeOPI, dpi: report.stage3.homeDPI, adj: report.stage3.lH_adj },
            { name: aName, color: aColor, opi: report.stage3.awayOPI, dpi: report.stage3.awayDPI, adj: report.stage3.lA_adj },
          ].map(t => (
            <div key={t.name} className="border border-border/20 p-2 space-y-1">
              <div className="text-[9px] font-mono font-bold truncate" style={{ color: t.color }}>{t.name}</div>
              <ScoreBar label="OPI (attack)" value={t.opi} max={10} color={t.color} />
              <ScoreBar label="DPI (defense)" value={t.dpi} max={10} color="#6b7280" />
              <div className="text-[8px] font-mono text-muted-foreground">λ adj: <AdjBadge adj={t.adj} /></div>
            </div>
          ))}
        </div>
        <div className="text-[9px] font-mono text-muted-foreground/60 space-y-0.5 pt-1">
          <p>↳ {report.stage3.opiVsDpi_home}</p>
          <p>↳ {report.stage3.opiVsDpi_away}</p>
        </div>
        <div className="border-t border-border/20 pt-2">
          <div className="flex items-center justify-between text-[9px] font-mono mb-1">
            <span className="text-muted-foreground/50">Adjusted:</span>
            <span style={{ color: hColor }}>{hName} λ={report.stage3.lH.toFixed(2)}</span>
            <span style={{ color: aColor }}>{aName} λ={report.stage3.lA.toFixed(2)}</span>
          </div>
          <WinProbRow hWin={report.stage3.hWin} draw={report.stage3.draw} aWin={report.stage3.aWin} hName={hName} aName={aName} hColor={hColor} aColor={aColor} />
        </div>
      </StageBlock>

      {/* Connector */}
      <div className="flex items-center gap-2 px-4">
        <div className="flex-1 h-px bg-primary/20" />
        <span className="text-[8px] font-mono text-primary/40 uppercase tracking-widest">↓ Tactical Interaction</span>
        <div className="flex-1 h-px bg-primary/20" />
      </div>

      {/* Stage 4 */}
      <StageBlock number={4} title="Tactical Interaction Layer — Style Matchup">
        <div className="grid grid-cols-2 gap-2">
          {[
            { name: hName, color: hColor, style: report.stage4.homeStyle, adj: report.stage4.lH_adj },
            { name: aName, color: aColor, style: report.stage4.awayStyle, adj: report.stage4.lA_adj },
          ].map(t => (
            <div key={t.name} className="border border-border/20 p-2 space-y-1">
              <div className="text-[9px] font-mono font-bold truncate" style={{ color: t.color }}>{t.name}</div>
              <div className="text-[9px] font-mono px-1.5 py-0.5 bg-primary/8 border border-primary/20 text-primary/70 inline-block">{t.style}</div>
              <div className="text-[8px] font-mono text-muted-foreground">λ adj: <AdjBadge adj={t.adj} /></div>
            </div>
          ))}
        </div>
        <div className="text-[9px] font-mono text-muted-foreground/60 pt-1">↳ {report.stage4.interaction}</div>
        <div className="border-t border-border/20 pt-2">
          <div className="flex items-center justify-between text-[9px] font-mono mb-1">
            <span className="text-muted-foreground/50">Post-tactical:</span>
            <span style={{ color: hColor }}>{hName} λ={report.stage4.lH.toFixed(2)}</span>
            <span style={{ color: aColor }}>{aName} λ={report.stage4.lA.toFixed(2)}</span>
          </div>
          <WinProbRow hWin={report.stage4.hWin} draw={report.stage4.draw} aWin={report.stage4.aWin} hName={hName} aName={aName} hColor={hColor} aColor={aColor} />
        </div>
      </StageBlock>

      {/* Connector */}
      <div className="flex items-center gap-2 px-4">
        <div className="flex-1 h-px bg-primary/20" />
        <span className="text-[8px] font-mono text-primary/40 uppercase tracking-widest">↓ Player Availability (Stage 5)</span>
        <div className="flex-1 h-px bg-primary/20" />
      </div>

      {/* Stage 5 placeholder */}
      <div className="border border-dashed border-border/30 bg-card/10 p-3 space-y-1">
        <div className="flex items-center gap-2">
          <div className="w-5 h-5 rounded-full bg-muted/20 border border-border/30 flex items-center justify-center">
            <span className="text-[9px] font-mono text-muted-foreground/40">5</span>
          </div>
          <span className="text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground/40">Player Availability — Injuries, Suspensions, Rotation</span>
        </div>
        <p className="text-[9px] font-mono text-muted-foreground/35 leading-tight pl-7">
          Injury/suspension data not available via current data source.
          When available: losing a striker averaging 0.45 xG/g would reduce attack lambda proportionally.
          This stage would apply per-player absence adjustments before final odds generation.
        </p>
      </div>

      {/* Final Result */}
      <div className="border border-primary/40 bg-primary/5 p-4 shadow-[0_0_20px_rgba(0,255,255,0.08)]">
        <div className="text-[9px] font-mono uppercase tracking-[0.2em] text-primary/60 text-center mb-3">
          Final Adjusted Output — All Stages Applied
        </div>
        <div className="flex items-center justify-between gap-4 mb-3">
          <div className="text-center">
            <div className="text-xs font-mono font-bold" style={{ color: hColor }}>{hName}</div>
            <div className="text-xl font-bold font-mono text-primary">{report.final.lH.toFixed(2)}</div>
            <div className="text-[8px] font-mono text-muted-foreground">λ (xG/game)</div>
            <div className="text-[9px] font-mono mt-1">
              Total: <AdjBadge adj={report.final.totalAdjH} />
            </div>
          </div>
          <div className="text-center space-y-1">
            <div className="text-[9px] font-mono text-muted-foreground">vs</div>
            <div className="text-2xl font-bold font-mono text-foreground">
              {/* Most likely score from matrix would require the matrix — just show probabilities */}
            </div>
          </div>
          <div className="text-center">
            <div className="text-xs font-mono font-bold" style={{ color: aColor }}>{aName}</div>
            <div className="text-xl font-bold font-mono text-primary">{report.final.lA.toFixed(2)}</div>
            <div className="text-[8px] font-mono text-muted-foreground">λ (xG/game)</div>
            <div className="text-[9px] font-mono mt-1">
              Total: <AdjBadge adj={report.final.totalAdjA} />
            </div>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2 pt-2 border-t border-primary/20">
          {[
            { label: `${hName} Win`, pct: Math.round(report.final.hWin * 100), color: hColor },
            { label: "Draw",         pct: Math.round(report.final.draw * 100), color: "#888" },
            { label: `${aName} Win`, pct: Math.round(report.final.aWin * 100), color: aColor },
          ].map(item => (
            <div key={item.label} className="text-center">
              <div className="text-xl font-bold font-mono" style={{ color: item.color }}>{item.pct}%</div>
              <div className="text-[8px] font-mono text-muted-foreground truncate">{item.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Methodology note */}
      <div className="text-[8px] font-mono text-muted-foreground/30 leading-relaxed space-y-0.5 border-t border-border/15 pt-2">
        <p>OPI = Offensive Pressure Index (shots, corners, big chances, crosses, final-third touches)</p>
        <p>DPI = Defensive Pressure Index (tackles, interceptions, clearances, GK saves, press discipline)</p>
        <p>All lambda adjustments are multiplicative and capped per stage to preserve model stability.</p>
        <p>Poisson independence assumption: home/away goals treated as independent random variables.</p>
      </div>
    </div>
  );
}

// ─── Market categories ─────────────────────────────────────────────────────────

const MARKET_CATEGORIES = [
  { id: "result",   label: "Result",   keys: ["1X2", "Double Chance", "Draw No Bet", "Either Team Wins"] },
  { id: "goals",    label: "Goals",    keys: ["Total Goals", "Goal Line", "Exact Goals", "Multi Goal", "Both Teams To Score", "Goal / No Goal", "Odd / Even", "Individual Total Goals", "Individual Odd/Even"] },
  { id: "handicap", label: "Handicap", keys: ["Asian Handicap", "European Handicap"] },
  { id: "halves",   label: "Halves",   keys: ["1X2 By Intervals", "Total Goals By Intervals", "Half Time / Full Time", "Highest Scoring Half", "Will Win Either Half"] },
  { id: "corners",  label: "Corners",  keys: ["Corners"] },
  { id: "specials", label: "Specials", keys: ["Result / Both Teams", "Clean Sheet", "Win To Nil", "Winning Margin", "Scoring Draw", "Result / Total Goals", "Home Result", "Away Result", "Double Chance / Combo"] },
  { id: "correct",  label: "Score",    keys: ["Correct Score"] },
] as const;
type CatId = typeof MARKET_CATEGORIES[number]["id"] | "dynamics" | "model";

// ─── Main Component ────────────────────────────────────────────────────────────

interface Props {
  home: TeamData;
  away: TeamData;
  fixture: { homeTeam: { name: string; colorPrimary: string|null }; awayTeam: { name: string; colorPrimary: string|null } };
}

export default function BettingOddsPanel({ home, away, fixture }: Props) {
  const [activeCat, setActiveCat] = useState<CatId>("model");
  const [dynTeam, setDynTeam]     = useState<"home" | "away">("home");

  const hName  = fixture.homeTeam.name;
  const aName  = fixture.awayTeam.name;
  const hColor = fixture.homeTeam.colorPrimary ?? "#22d3ee";
  const aColor = fixture.awayTeam.colorPrimary ?? "#f97316";

  const { hAgg, aAgg, lH, lA, matrix, markets, hDyn, aDyn, confidence, report } = useMemo(() => {
    const hAgg = computeTeamAgg(home.matches, home.statHistory, home.possession);
    const aAgg = computeTeamAgg(away.matches, away.statHistory, away.possession);
    const { lH, lA, report } = computeMultiStageLambdas(hAgg, aAgg, home.players, away.players, home.statHistory, away.statHistory, hName, aName);
    const matrix = buildScoreMatrix(lH, lA, 8);
    const markets = computeMarkets(matrix, hAgg, aAgg, lH, lA, hName, aName);
    const hDyn = buildMatchDynamics(home.matches, home.statHistory);
    const aDyn = buildMatchDynamics(away.matches, away.statHistory);
    const hasPlayers = home.players.length > 0 && away.players.length > 0;
    const confidence = modelConfidence(hAgg, aAgg, hasPlayers);
    return { hAgg, aAgg, lH, lA, matrix, markets, hDyn, aDyn, confidence, report };
  }, [home, away, hName, aName]);

  let bestH = 0, bestA = 0, bestP = 0;
  for (let h = 0; h <= 8; h++) for (let a = 0; a <= 8; a++)
    if ((matrix[h]?.[a] ?? 0) > bestP) { bestP = matrix[h][a]; bestH = h; bestA = a; }

  const [pH, , pA] = extractWinProbs(lH, lA);
  const pD = 1 - pH - pA;

  const filteredMarkets = (activeCat === "dynamics" || activeCat === "model")
    ? []
    : markets.filter(m => {
        const cat = MARKET_CATEGORIES.find(c => c.id === activeCat);
        if (!cat) return true;
        return (cat.keys as readonly string[]).some(k => m.title.toLowerCase().includes(k.toLowerCase()));
      });

  const tabs: { id: CatId; label: string }[] = [
    { id: "model",    label: "⬡ Model" },
    ...MARKET_CATEGORIES.map(c => ({ id: c.id as CatId, label: c.label })),
    { id: "dynamics", label: "Dynamics" },
  ];

  return (
    <div className="space-y-4">
      {/* Prediction header */}
      <div className="border border-border/50 bg-card/40 p-4">
        <div className="text-center space-y-3">
          <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
            5-Stage Statistical Match Prediction — Poisson Model
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
              { label: `${hName} Win`, pct: Math.round(pH * 100), color: hColor },
              { label: "Draw",          pct: Math.round(pD * 100), color: "#888" },
              { label: `${aName} Win`, pct: Math.round(pA * 100), color: aColor },
            ].map(item => (
              <div key={item.label} className="text-center">
                <div className="text-lg font-mono font-bold" style={{ color: item.color }}>{item.pct}%</div>
                <div className="text-[10px] font-mono text-muted-foreground truncate max-w-[80px]">{item.label}</div>
              </div>
            ))}
          </div>
          <div className="flex items-center justify-center gap-3 text-[10px] font-mono flex-wrap">
            <span className="text-muted-foreground">Confidence:</span>
            <span className={confidence.color + " font-bold"}>{confidence.label}</span>
            <span className="text-muted-foreground">·</span>
            <span className="text-muted-foreground">{Math.min(hAgg.n, aAgg.n)} matches</span>
            <span className="text-muted-foreground">·</span>
            <span className="text-primary/60">Stage adj: {hName} <AdjBadge adj={report.final.totalAdjH} /> / {aName} <AdjBadge adj={report.final.totalAdjA} /></span>
          </div>
        </div>
      </div>

      {/* Key team stats */}
      <div className="grid grid-cols-2 gap-3">
        {[{ name: hName, agg: hAgg, color: hColor }, { name: aName, agg: aAgg, color: aColor }].map(({ name, agg, color }) => (
          <div key={name} className="border border-border/40 bg-card/30 p-3 space-y-2">
            <div className="text-xs font-bold font-mono uppercase truncate" style={{ color }}>{name}</div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[10px] font-mono">
              <span className="text-muted-foreground">Goals/G</span>       <span className="text-right">{agg.avgScored.toFixed(2)}</span>
              <span className="text-muted-foreground">Conceded/G</span>    <span className="text-right">{agg.avgConceded.toFixed(2)}</span>
              {agg.avgXgFor > 0 && <><span className="text-muted-foreground">xG For/G</span><span className="text-right">{agg.avgXgFor.toFixed(2)}</span></>}
              {agg.avgXgAgainst > 0 && <><span className="text-muted-foreground">xG Agst/G</span><span className="text-right">{agg.avgXgAgainst.toFixed(2)}</span></>}
              <span className="text-muted-foreground">Clean Sheet</span>   <span className="text-right">{Math.round(agg.cleanSheetRate*100)}%</span>
              <span className="text-muted-foreground">BTTS Rate</span>     <span className="text-right">{Math.round(agg.bttsRate*100)}%</span>
              {agg.possession > 0 && <><span className="text-muted-foreground">Possession</span><span className="text-right">{agg.possession.toFixed(0)}%</span></>}
              <span className="text-muted-foreground">W/D/L</span>         <span className="text-right">{Math.round(agg.wdl[0]*100)}%/{Math.round(agg.wdl[1]*100)}%/{Math.round(agg.wdl[2]*100)}%</span>
            </div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-0 border-b border-border/50 overflow-x-auto" style={{ scrollbarWidth: "none" }}>
        {tabs.map(tab => (
          <button key={tab.id} onClick={() => setActiveCat(tab.id)}
            className={`px-3 py-2 text-[10px] font-mono uppercase tracking-widest border-b-2 transition-all -mb-px whitespace-nowrap flex-shrink-0 ${
              activeCat === tab.id ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
            }`}>
            {tab.label}
          </button>
        ))}
      </div>

      {/* Model tab */}
      {activeCat === "model" && (
        <ModelPipeline report={report} hName={hName} aName={aName} hColor={hColor} aColor={aColor} />
      )}

      {/* Dynamics tab */}
      {activeCat === "dynamics" && (
        <div className="space-y-3">
          <div className="flex gap-0 border-b border-border/30">
            {(["home","away"] as const).map(t => (
              <button key={t} onClick={() => setDynTeam(t)}
                className={`px-4 py-1.5 text-[10px] font-mono uppercase tracking-widest border-b-2 transition-all -mb-px ${
                  dynTeam===t ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
                }`}>
                {t === "home" ? hName : aName}
              </button>
            ))}
          </div>
          <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest px-1">Match-by-match: WHY did outcomes occur?</div>
          <div className="space-y-2">
            {(dynTeam === "home" ? hDyn : aDyn).map(d => <DynamicRow key={d.eventId} d={d} />)}
            {(dynTeam === "home" ? hDyn : aDyn).length === 0 && (
              <p className="text-muted-foreground text-sm text-center py-8 font-mono">No match data available</p>
            )}
          </div>
        </div>
      )}

      {/* Market listings */}
      {activeCat !== "model" && activeCat !== "dynamics" && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 px-1 text-[10px] font-mono text-muted-foreground">
            <span className="flex-1">OUTCOME</span>
            <span className="w-32 text-right">PROBABILITY</span>
            <span className="w-10 text-right">%</span>
            <span className="w-12 text-right">ODDS</span>
          </div>
          {filteredMarkets.length > 0
            ? filteredMarkets.map((g, i) => <MarketGroup key={i} group={g} />)
            : <p className="text-muted-foreground text-sm text-center py-8 font-mono">No markets for this category</p>}
        </div>
      )}

      {/* Disclaimer */}
      <div className="text-[9px] font-mono text-muted-foreground/50 text-center pt-2 border-t border-border/20 leading-relaxed">
        NEXUS FIXTURES · 5-Stage model: Baseline → Player Matchups → Pressure → Tactics → Availability ·
        Poisson distribution · {Math.min(hAgg.n, aAgg.n)} matches analysed · For informational purposes only
      </div>
    </div>
  );
}
