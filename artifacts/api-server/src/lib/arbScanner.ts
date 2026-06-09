/**
 * Arbitrage (sure-bet) scanner.
 *
 * A sure-bet exists when the sum of (1 / best_odds_for_each_outcome) across
 * ALL bookmakers is less than 1.0.  The gap below 1 is guaranteed profit
 * regardless of which outcome occurs.
 *
 * Formula:
 *   impliedSum = Σ (1 / bestOdds_i)
 *   profitPct  = (1 / impliedSum - 1) × 100
 *   stakeᵢ     = (1 / bestOdds_i) / impliedSum   (fraction of total stake)
 */

export interface ArbLeg {
  outcome: string;
  bookmaker: string;
  odds: number;
  stakePercent: number;  // % of total stake to place on this leg
}

export interface ArbOpportunity {
  market: string;
  impliedSum: number;    // < 1.0 means sure-bet exists
  profitPct: number;     // guaranteed profit on total stake
  legs: ArbLeg[];
}

interface OddsEntry {
  bookmaker: string;
  odds: (number | null)[];
  line?: number;
}

function bestForOutcome(
  entries: OddsEntry[],
  idx: number,
): { bookmaker: string; odds: number } | null {
  let best: { bookmaker: string; odds: number } | null = null;
  for (const e of entries) {
    const o = e.odds[idx];
    if (o && o > 1.01 && (!best || o > best.odds)) {
      best = { bookmaker: e.bookmaker, odds: o };
    }
  }
  return best;
}

function scanMarket(
  marketName: string,
  outcomes: string[],
  entries: OddsEntry[],
  indices: number[],
): ArbOpportunity | null {
  if (!entries.length) return null;

  const bests = indices.map(i => bestForOutcome(entries, i));
  if (bests.some(b => b === null)) return null;

  const impliedSum = bests.reduce((s, b) => s + 1 / b!.odds, 0);
  // Only flag if clearly below 1 (allow tiny floating point noise)
  if (impliedSum >= 0.999) return null;

  const profitPct = (1 / impliedSum - 1) * 100;
  const legs: ArbLeg[] = bests.map((b, i) => ({
    outcome: outcomes[i],
    bookmaker: b!.bookmaker,
    odds: b!.odds,
    stakePercent: Math.round(((1 / b!.odds) / impliedSum) * 10000) / 100,
  }));

  return {
    market: marketName,
    impliedSum: Math.round(impliedSum * 10000) / 10000,
    profitPct: Math.round(profitPct * 100) / 100,
    legs,
  };
}

export function scanArbitrage(oddsData: {
  onex2: OddsEntry[];
  btts:  OddsEntry[];
  dc:    OddsEntry[];
  ou:    OddsEntry[];
}): ArbOpportunity[] {
  const opportunities: ArbOpportunity[] = [];

  const arb1x2 = scanMarket("1X2", ["Home", "Draw", "Away"], oddsData.onex2, [0, 1, 2]);
  if (arb1x2) opportunities.push(arb1x2);

  const arbBtts = scanMarket("BTTS", ["Yes", "No"], oddsData.btts, [0, 1]);
  if (arbBtts) opportunities.push(arbBtts);

  // DC index order in BetExplorer: [0]=1X, [1]=X2, [2]=12
  const arbDc = scanMarket("Double Chance", ["1X", "X2", "12"], oddsData.dc, [0, 1, 2]);
  if (arbDc) opportunities.push(arbDc);

  // O/U — group entries by line, scan each line independently
  const byLine = new Map<number, OddsEntry[]>();
  for (const e of oddsData.ou) {
    if (e.line != null) {
      if (!byLine.has(e.line)) byLine.set(e.line, []);
      byLine.get(e.line)!.push(e);
    }
  }
  for (const [line, entries] of byLine) {
    const arbOu = scanMarket(`O/U ${line}`, ["Over", "Under"], entries, [0, 1]);
    if (arbOu) opportunities.push(arbOu);
  }

  return opportunities.sort((a, b) => b.profitPct - a.profitPct);
}
