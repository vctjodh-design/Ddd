import { useMemo, useState } from "react";
import { BarChart3, Database, History, LineChart, Radio, Trophy, WalletCards, type LucideIcon } from "lucide-react";

type DateValue = Date | number | string;
type NullableNumber = number | null | undefined;

export type Odds1X2 =
  | readonly [NullableNumber, NullableNumber, NullableNumber]
  | {
      home?: NullableNumber;
      draw?: NullableNumber;
      away?: NullableNumber;
      H?: NullableNumber;
      D?: NullableNumber;
      A?: NullableNumber;
    };

export interface HeadToHeadMeeting {
  id?: string | number;
  date: DateValue;
  homeTeam: string;
  awayTeam: string;
  homeScore: NullableNumber;
  awayScore: NullableNumber;
  odds?: Odds1X2;
}

export type RecentMatchScore =
  | string
  | readonly [NullableNumber, NullableNumber]
  | { for: NullableNumber; against: NullableNumber }
  | null
  | undefined;

export interface RecentTeamMatch {
  id?: string | number;
  date: DateValue;
  opponent: string;
  score: RecentMatchScore;
  result: "W" | "D" | "L";
  odds?: Odds1X2;
  venue?: "H" | "A" | "home" | "away";
}

export interface MarketQuote {
  bookmaker: string;
  selections: Record<string, NullableNumber>;
  line?: string | number;
}

export type FixtureMarketOdds = Record<string, MarketQuote[]>;

/** Shape already returned by FixturePrediction.rawOdds. It is accepted so the panel can be mounted without a data transformation layer. */
export interface RawFixtureOdds {
  onex2?: Array<{ bookmaker: string; H: NullableNumber; D: NullableNumber; A: NullableNumber }>;
  btts?: Array<{ bookmaker: string; yes: NullableNumber; no: NullableNumber }>;
  ou?: Array<{ bookmaker: string; line: number; over: NullableNumber; under: NullableNumber }>;
  dc?: Array<{ bookmaker: string; "1X": NullableNumber; X2: NullableNumber; "12": NullableNumber }>;
}

export interface HeadToHeadPanelProps {
  homeTeam: string;
  awayTeam: string;
  directMeetings?: HeadToHeadMeeting[];
  recentMatches?: {
    home: RecentTeamMatch[];
    away: RecentTeamMatch[];
  };
  fixtureOdds?: FixtureMarketOdds | RawFixtureOdds;
  className?: string;
}

type ViewKey = "h2h" | "form" | "markets";
type FormTeam = "home" | "away";

const cx = (...classes: Array<string | false | null | undefined>) => classes.filter(Boolean).join(" ");

function formatDate(value: DateValue): string {
  const date =
    value instanceof Date
      ? value
      : typeof value === "number"
        ? new Date(value < 1_000_000_000_000 ? value * 1000 : value)
        : new Date(value);

  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
}

function shortDate(value: DateValue): string {
  const date =
    value instanceof Date
      ? value
      : typeof value === "number"
        ? new Date(value < 1_000_000_000_000 ? value * 1000 : value)
        : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short" }).format(date);
}

function getOddsValue(odds: Odds1X2 | undefined, key: "home" | "draw" | "away"): NullableNumber {
  if (!odds) return undefined;
  if (Array.isArray(odds)) return odds[key === "home" ? 0 : key === "draw" ? 1 : 2];
  const objectOdds = odds as Exclude<Odds1X2, readonly NullableNumber[]>;
  return objectOdds[key] ?? objectOdds[key === "home" ? "H" : key === "draw" ? "D" : "A"];
}

function formatOdds(value: NullableNumber): string {
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(2) : "—";
}

function formatScore(score: RecentMatchScore): string {
  if (Array.isArray(score)) {
    return score.every((value) => typeof value === "number")
      ? `${score[0]}–${score[1]}`
      : "—";
  }
  if (typeof score === "object" && score !== null) {
    const objectScore = score as { for: NullableNumber; against: NullableNumber };
    if (typeof objectScore.for === "number" && typeof objectScore.against === "number") {
      return `${objectScore.for}–${objectScore.against}`;
    }
    return "—";
  }
  return score || "—";
}

function resultClasses(result: "W" | "D" | "L"): string {
  if (result === "W") return "border-emerald-400/40 bg-emerald-400/10 text-emerald-300";
  if (result === "L") return "border-rose-400/40 bg-rose-400/10 text-rose-300";
  return "border-amber-300/40 bg-amber-300/10 text-amber-200";
}

function normalizeFixtureOdds(odds: FixtureMarketOdds | RawFixtureOdds | undefined): FixtureMarketOdds {
  if (!odds) return {};
  if ("onex2" in odds || "btts" in odds || "ou" in odds || "dc" in odds) {
    const raw = odds as RawFixtureOdds;
    return {
      ...(raw.onex2?.length
        ? {
            "1X2": raw.onex2.map((quote) => ({
              bookmaker: quote.bookmaker,
              selections: { Home: quote.H, Draw: quote.D, Away: quote.A },
            })),
          }
        : {}),
      ...(raw.btts?.length
        ? {
            BTTS: raw.btts.map((quote) => ({
              bookmaker: quote.bookmaker,
              selections: { Yes: quote.yes, No: quote.no },
            })),
          }
        : {}),
      ...(raw.ou?.length
        ? {
            "O/U": raw.ou.map((quote) => ({
              bookmaker: quote.bookmaker,
              line: quote.line,
              selections: { Over: quote.over, Under: quote.under },
            })),
          }
        : {}),
      ...(raw.dc?.length
        ? {
            "Double Chance": raw.dc.map((quote) => ({
              bookmaker: quote.bookmaker,
              selections: { "1X": quote["1X"], X2: quote.X2, "12": quote["12"] },
            })),
          }
        : {}),
    };
  }
  return odds as FixtureMarketOdds;
}

function PanelLabel({
  icon: Icon,
  eyebrow,
  title,
  count,
}: {
  icon: LucideIcon;
  eyebrow: string;
  title: string;
  count?: number;
}) {
  return (
    <div className="flex min-w-0 items-start gap-3">
      <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center border border-primary/30 bg-primary/5 text-primary">
        <Icon className="h-3.5 w-3.5" />
      </div>
      <div className="min-w-0">
        <div className="font-mono text-[9px] uppercase tracking-[0.22em] text-primary/60">{eyebrow}</div>
        <div className="mt-0.5 flex items-baseline gap-2">
          <h3 className="truncate font-mono text-sm font-bold uppercase tracking-[0.08em] text-foreground/90">{title}</h3>
          {typeof count === "number" && (
            <span className="shrink-0 font-mono text-[10px] text-muted-foreground/60">[{count}]</span>
          )}
        </div>
      </div>
    </div>
  );
}

function EmptyTable({ message }: { message: string }) {
  return (
    <div className="flex min-h-28 items-center justify-center border border-dashed border-border/50 bg-background/25 px-4 text-center">
      <p className="font-mono text-[10px] uppercase tracking-[0.13em] text-muted-foreground/50">{message}</p>
    </div>
  );
}

function OddsTriplet({ odds }: { odds?: Odds1X2 }) {
  return (
    <div className="grid min-w-[132px] grid-cols-3 gap-1 font-mono text-[10px]">
      {(["home", "draw", "away"] as const).map((key) => (
        <span
          key={key}
          data-testid={`text-h2h-odds-${key}`}
          className={cx(
            "border border-border/40 bg-background/35 px-1.5 py-1 text-center tabular-nums",
            getOddsValue(odds, key) === undefined ? "text-muted-foreground/25" : "text-foreground/75",
          )}
        >
          {formatOdds(getOddsValue(odds, key))}
        </span>
      ))}
    </div>
  );
}

function H2HTable({ meetings, homeTeam, awayTeam }: { meetings: HeadToHeadMeeting[]; homeTeam: string; awayTeam: string }) {
  const sorted = [...meetings].sort((a, b) => {
    const aTime = new Date(a.date instanceof Date ? a.date : typeof a.date === "number" ? (a.date < 1_000_000_000_000 ? a.date * 1000 : a.date) : a.date).getTime();
    const bTime = new Date(b.date instanceof Date ? b.date : typeof b.date === "number" ? (b.date < 1_000_000_000_000 ? b.date * 1000 : b.date) : b.date).getTime();
    return bTime - aTime;
  });

  if (!sorted.length) return <EmptyTable message="No direct meetings returned for this fixture" />;

  return (
    <div className="overflow-hidden border border-border/50">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[650px] border-collapse font-mono text-[11px]">
          <thead>
            <tr className="border-b border-border/50 bg-card/70 text-left text-[9px] uppercase tracking-[0.16em] text-muted-foreground/60">
              <th className="px-3 py-2.5 font-normal">Date</th>
              <th className="px-3 py-2.5 font-normal">Meeting</th>
              <th className="px-3 py-2.5 text-center font-normal">Final</th>
              <th className="px-3 py-2.5 text-right font-normal">1X2 / H · D · A</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/25">
            {sorted.map((match, index) => {
              const homeWon = typeof match.homeScore === "number" && typeof match.awayScore === "number" && match.homeScore > match.awayScore;
              const awayWon = typeof match.homeScore === "number" && typeof match.awayScore === "number" && match.awayScore > match.homeScore;
              return (
                <tr
                  key={match.id ?? `${match.date}-${match.homeTeam}-${match.awayTeam}-${index}`}
                  data-testid={`row-h2h-meeting-${index}`}
                  className="transition-colors hover:bg-primary/[0.035]"
                >
                  <td className="whitespace-nowrap px-3 py-3 text-muted-foreground/70">{formatDate(match.date)}</td>
                  <td className="px-3 py-3">
                    <div className="flex min-w-[240px] items-center gap-2">
                      <span className={cx("truncate", match.homeTeam === homeTeam ? "text-primary/85" : "text-foreground/70")}>{match.homeTeam}</span>
                      <span className="text-[9px] text-muted-foreground/35">vs</span>
                      <span className={cx("truncate", match.awayTeam === awayTeam ? "text-cyan-200/85" : "text-foreground/70")}>{match.awayTeam}</span>
                    </div>
                  </td>
                  <td className="px-3 py-3 text-center">
                    <span className={cx("tabular-nums font-bold", homeWon ? "text-primary" : awayWon ? "text-cyan-200" : "text-amber-200")}>
                      {typeof match.homeScore === "number" && typeof match.awayScore === "number"
                        ? `${match.homeScore}–${match.awayScore}`
                        : "—"}
                    </span>
                  </td>
                  <td className="px-3 py-3 text-right"><OddsTriplet odds={match.odds} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function FormTable({ matches, team }: { matches: RecentTeamMatch[]; team: string }) {
  const visibleMatches = matches.slice(0, 25);
  if (!visibleMatches.length) return <EmptyTable message={`No recent ${team} matches returned`} />;

  return (
    <div className="overflow-hidden border border-border/50">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[700px] border-collapse font-mono text-[11px]">
          <thead>
            <tr className="border-b border-border/50 bg-card/70 text-left text-[9px] uppercase tracking-[0.16em] text-muted-foreground/60">
              <th className="px-3 py-2.5 font-normal">Date</th>
              <th className="px-3 py-2.5 font-normal">Opponent</th>
              <th className="px-3 py-2.5 text-center font-normal">Venue</th>
              <th className="px-3 py-2.5 text-center font-normal">Score</th>
              <th className="px-3 py-2.5 text-center font-normal">Result</th>
              <th className="px-3 py-2.5 text-right font-normal">1X2 / H · D · A</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/25">
            {visibleMatches.map((match, index) => (
              <tr
                key={match.id ?? `${match.date}-${match.opponent}-${index}`}
                data-testid={`row-form-match-${team}-${index}`}
                className="transition-colors hover:bg-primary/[0.035]"
              >
                <td className="whitespace-nowrap px-3 py-3 text-muted-foreground/70">{formatDate(match.date)}</td>
                <td className="max-w-[240px] truncate px-3 py-3 text-foreground/80">{match.opponent}</td>
                <td className="px-3 py-3 text-center text-[10px] uppercase text-muted-foreground/55">{match.venue === "home" ? "H" : match.venue === "away" ? "A" : match.venue || "—"}</td>
                <td className="px-3 py-3 text-center tabular-nums text-foreground/80">{formatScore(match.score)}</td>
                <td className="px-3 py-3 text-center">
                  <span className={cx("inline-flex min-w-7 items-center justify-center border px-1.5 py-1 text-[9px] font-bold", resultClasses(match.result))}>{match.result}</span>
                </td>
                <td className="px-3 py-3 text-right"><OddsTriplet odds={match.odds} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {matches.length > 25 && (
        <div className="border-t border-border/30 bg-card/30 px-3 py-2 font-mono text-[9px] uppercase tracking-[0.13em] text-muted-foreground/50">
          Showing latest 25 of {matches.length} available matches
        </div>
      )}
    </div>
  );
}

function MarketTable({ quotes }: { quotes: MarketQuote[] }) {
  const selectionNames = [...new Set(quotes.flatMap((quote) => Object.keys(quote.selections)))];
  const bestBySelection = Object.fromEntries(
    selectionNames.map((name) => [
      name,
      Math.max(...quotes.map((quote) => quote.selections[name]).filter((value): value is number => typeof value === "number"), 0),
    ]),
  );

  if (!quotes.length || !selectionNames.length) return <EmptyTable message="No bookmaker quotes returned for this market" />;

  return (
    <div className="overflow-hidden border border-border/50">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[540px] border-collapse font-mono text-[11px]">
          <thead>
            <tr className="border-b border-border/50 bg-card/70 text-[9px] uppercase tracking-[0.16em] text-muted-foreground/60">
              <th className="px-3 py-2.5 text-left font-normal">Bookmaker</th>
              {selectionNames.map((name) => <th key={name} className="px-3 py-2.5 text-right font-normal">{name}</th>)}
            </tr>
          </thead>
          <tbody className="divide-y divide-border/25">
            {quotes.map((quote, index) => (
              <tr key={`${quote.bookmaker}-${quote.line ?? ""}-${index}`} data-testid={`row-market-quote-${index}`} className="transition-colors hover:bg-primary/[0.035]">
                <td className="whitespace-nowrap px-3 py-3 text-foreground/75">
                  {quote.bookmaker}
                  {quote.line !== undefined && <span className="ml-2 text-[9px] text-primary/60">[{quote.line}]</span>}
                </td>
                {selectionNames.map((name) => {
                  const value = quote.selections[name];
                  const isBest = typeof value === "number" && value === bestBySelection[name] && value > 0;
                  return (
                    <td key={name} className={cx("px-3 py-3 text-right tabular-nums", isBest ? "font-bold text-primary" : "text-foreground/70")}>
                      {formatOdds(value)}
                      {isBest && <span className="ml-1 text-[8px] text-primary/55">BEST</span>}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center gap-2 border-t border-border/30 bg-card/30 px-3 py-2 font-mono text-[9px] uppercase tracking-[0.13em] text-muted-foreground/50">
        <span className="h-1.5 w-1.5 bg-primary" /> Highest available price per outcome
      </div>
    </div>
  );
}

export default function HeadToHeadPanel({
  homeTeam,
  awayTeam,
  directMeetings = [],
  recentMatches,
  fixtureOdds,
  className,
}: HeadToHeadPanelProps) {
  const [view, setView] = useState<ViewKey>("h2h");
  const [formTeam, setFormTeam] = useState<FormTeam>("home");
  const [selectedMarket, setSelectedMarket] = useState("");
  const normalizedOdds = useMemo(() => normalizeFixtureOdds(fixtureOdds), [fixtureOdds]);
  const markets = useMemo(() => Object.keys(normalizedOdds).filter((market) => normalizedOdds[market]), [normalizedOdds]);
  const activeMarket = markets.includes(selectedMarket) ? selectedMarket : markets[0];
  const activeForm = formTeam === "home" ? recentMatches?.home ?? [] : recentMatches?.away ?? [];

  const h2hStats = useMemo(() => {
    const scored = directMeetings.filter((meeting) => typeof meeting.homeScore === "number" && typeof meeting.awayScore === "number");
    const totalGoals = scored.reduce((total, meeting) => total + (meeting.homeScore as number) + (meeting.awayScore as number), 0);
    const fixtureHomeWins = scored.filter((meeting) => meeting.homeTeam === homeTeam && (meeting.homeScore as number) > (meeting.awayScore as number)).length
      + scored.filter((meeting) => meeting.awayTeam === homeTeam && (meeting.awayScore as number) > (meeting.homeScore as number)).length;
    const draws = scored.filter((meeting) => meeting.homeScore === meeting.awayScore).length;
    return { count: scored.length, averageGoals: scored.length ? totalGoals / scored.length : null, fixtureHomeWins, draws };
  }, [awayTeam, directMeetings, homeTeam]);

  const latestForm = useMemo(() => activeForm.slice(0, 5), [activeForm]);

  return (
    <section data-testid="panel-head-to-head" className={cx("border border-primary/20 bg-card/35 shadow-[0_10px_35px_rgba(0,0,0,0.18)]", className)}>
      <header className="border-b border-primary/15 bg-[linear-gradient(90deg,rgba(0,220,255,0.08),transparent_42%)] px-4 py-4 sm:px-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <div className="mb-2 flex items-center gap-2 font-mono text-[9px] uppercase tracking-[0.24em] text-primary/65">
              <Radio className="h-3 w-3" />
              Historical layer / market context
            </div>
            <h2 className="font-mono text-lg font-bold uppercase tracking-[0.08em] text-foreground/95 sm:text-xl">Head-to-head intelligence</h2>
            <p className="mt-1 truncate font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground/60">
              {homeTeam} <span className="px-1.5 text-primary/65">vs</span> {awayTeam}
            </p>
          </div>
          <div className="grid grid-cols-3 divide-x divide-border/35 border border-border/40 bg-background/25">
            <div className="px-3 py-2 text-center" data-testid="stat-h2h-meetings">
              <div className="font-mono text-sm font-bold text-primary">{directMeetings.length}</div>
              <div className="font-mono text-[8px] uppercase tracking-wider text-muted-foreground/55">Meetings</div>
            </div>
            <div className="px-3 py-2 text-center" data-testid="stat-form-matches">
              <div className="font-mono text-sm font-bold text-cyan-200">{(recentMatches?.home?.length ?? 0) + (recentMatches?.away?.length ?? 0)}</div>
              <div className="font-mono text-[8px] uppercase tracking-wider text-muted-foreground/55">Form rows</div>
            </div>
            <div className="px-3 py-2 text-center" data-testid="stat-markets">
              <div className="font-mono text-sm font-bold text-amber-200">{markets.length}</div>
              <div className="font-mono text-[8px] uppercase tracking-wider text-muted-foreground/55">Markets</div>
            </div>
          </div>
        </div>
      </header>

      <nav aria-label="Head to head views" className="flex overflow-x-auto border-b border-border/40 bg-background/20 px-2 sm:px-3" style={{ scrollbarWidth: "none" }}>
        {([
          { key: "h2h", label: "Direct H2H", icon: History, count: directMeetings.length },
          { key: "form", label: "Recent form", icon: LineChart, count: (recentMatches?.home?.length ?? 0) + (recentMatches?.away?.length ?? 0) },
          { key: "markets", label: "Fixture markets", icon: WalletCards, count: markets.length },
        ] as const).map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.key}
              type="button"
              data-testid={`button-h2h-view-${item.key}`}
              onClick={() => setView(item.key)}
              className={cx(
                "flex shrink-0 items-center gap-2 border-b-2 px-3 py-3 font-mono text-[10px] uppercase tracking-[0.12em] transition-colors sm:px-4",
                view === item.key ? "border-primary text-primary" : "border-transparent text-muted-foreground/60 hover:text-foreground/80",
              )}
            >
              <Icon className="h-3 w-3" />
              {item.label}
              <span className="text-[9px] text-muted-foreground/45">[{item.count}]</span>
            </button>
          );
        })}
      </nav>

      <div className="p-3 sm:p-5">
        {view === "h2h" && (
          <div className="space-y-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <PanelLabel icon={History} eyebrow="Signal archive" title="Direct meetings" count={directMeetings.length} />
              {h2hStats.count > 0 && (
                <div className="grid grid-cols-3 divide-x divide-border/30 border border-border/35 bg-background/25">
                  <div className="px-3 py-2 text-center"><div className="font-mono text-xs font-bold text-foreground/85">{h2hStats.averageGoals?.toFixed(2)}</div><div className="font-mono text-[8px] uppercase text-muted-foreground/50">Goals / game</div></div>
                  <div className="px-3 py-2 text-center"><div className="font-mono text-xs font-bold text-primary">{h2hStats.fixtureHomeWins}</div><div className="font-mono text-[8px] uppercase text-muted-foreground/50">{homeTeam} wins</div></div>
                  <div className="px-3 py-2 text-center"><div className="font-mono text-xs font-bold text-amber-200">{h2hStats.draws}</div><div className="font-mono text-[8px] uppercase text-muted-foreground/50">Draws</div></div>
                </div>
              )}
            </div>
            <H2HTable meetings={directMeetings} homeTeam={homeTeam} awayTeam={awayTeam} />
          </div>
        )}

        {view === "form" && (
          <div className="space-y-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <PanelLabel icon={LineChart} eyebrow="Performance tape" title="Recent matches" count={activeForm.length} />
              <div className="flex border border-border/45 bg-background/25 p-0.5">
                {([
                  { key: "home" as const, label: homeTeam, matches: recentMatches?.home ?? [], accent: "text-primary" },
                  { key: "away" as const, label: awayTeam, matches: recentMatches?.away ?? [], accent: "text-cyan-200" },
                ]).map((team) => (
                  <button
                    key={team.key}
                    type="button"
                    data-testid={`button-form-team-${team.key}`}
                    onClick={() => setFormTeam(team.key)}
                    className={cx("max-w-[150px] truncate px-2.5 py-1.5 font-mono text-[9px] uppercase tracking-wider transition-colors sm:max-w-[190px]", formTeam === team.key ? `bg-primary/10 ${team.accent}` : "text-muted-foreground/55 hover:text-foreground/75")}
                  >
                    {team.label} [{team.matches.length}]
                  </button>
                ))}
              </div>
            </div>
            {latestForm.length > 0 && (
              <div className="flex items-center gap-2 overflow-x-auto border border-border/30 bg-background/20 px-3 py-2">
                <span className="shrink-0 font-mono text-[8px] uppercase tracking-[0.16em] text-muted-foreground/50">Latest five</span>
                {latestForm.map((match, index) => <span key={match.id ?? `${match.date}-${index}`} className={cx("inline-flex h-5 min-w-5 items-center justify-center border px-1 font-mono text-[9px] font-bold", resultClasses(match.result))}>{match.result}</span>)}
              </div>
            )}
            <FormTable matches={activeForm} team={formTeam} />
          </div>
        )}

        {view === "markets" && (
          <div className="space-y-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <PanelLabel icon={WalletCards} eyebrow="Price discovery" title="Bookmaker markets" count={markets.length} />
              {markets.length > 0 && (
                <div className="flex max-w-full overflow-x-auto border border-border/45 bg-background/25 p-0.5" style={{ scrollbarWidth: "none" }}>
                  {markets.map((market) => (
                    <button
                      key={market}
                      type="button"
                      data-testid={`button-market-${market.replace(/\s+/g, "-").toLowerCase()}`}
                      onClick={() => setSelectedMarket(market)}
                      className={cx("shrink-0 px-2.5 py-1.5 font-mono text-[9px] uppercase tracking-wider transition-colors", activeMarket === market ? "bg-primary/10 text-primary" : "text-muted-foreground/55 hover:text-foreground/75")}
                    >
                      {market}
                    </button>
                  ))}
                </div>
              )}
            </div>
            {activeMarket ? (
              <div className="space-y-2">
                <div className="flex items-center gap-2 font-mono text-[9px] uppercase tracking-[0.15em] text-muted-foreground/55">
                  <Database className="h-3 w-3 text-primary/70" />
                  {activeMarket} / {normalizedOdds[activeMarket]?.length ?? 0} bookmaker quotes
                </div>
                <MarketTable quotes={normalizedOdds[activeMarket] ?? []} />
              </div>
            ) : (
              <EmptyTable message="No bookmaker markets returned for this fixture" />
            )}
          </div>
        )}
      </div>
      <footer className="flex flex-col gap-1 border-t border-border/30 bg-background/20 px-4 py-2.5 font-mono text-[8px] uppercase tracking-[0.15em] text-muted-foreground/40 sm:flex-row sm:items-center sm:justify-between">
        <span className="flex items-center gap-2"><BarChart3 className="h-3 w-3" /> Historical evidence only — prices shown as returned</span>
        <span className="flex items-center gap-1.5"><Trophy className="h-3 w-3 text-primary/50" /> No model projection in this layer</span>
      </footer>
    </section>
  );
}