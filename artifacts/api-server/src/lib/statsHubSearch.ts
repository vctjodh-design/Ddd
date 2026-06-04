/**
 * StatsHub team search — looks up team IDs by name for bulk upload.
 * Uses the StatsHub search API to resolve team names from OddsPortal.
 */

const SH_BASE = "https://www.statshub.com";
const SH_HEADERS: Record<string, string> = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  "Accept": "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
  "Accept-Encoding": "gzip, deflate, br, zstd",
  "Cache-Control": "no-cache",
  "Pragma": "no-cache",
  "Origin": "https://www.statshub.com",
  "Referer": "https://www.statshub.com/football/fixtures",
  "sec-ch-ua": '"Google Chrome";v="125", "Chromium";v="125", "Not.A/Brand";v="24"',
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": '"Windows"',
  "Sec-Fetch-Dest": "empty",
  "Sec-Fetch-Mode": "cors",
  "Sec-Fetch-Site": "same-origin",
  "Connection": "keep-alive",
  "DNT": "1",
};

const searchCache = new Map<string, number | null>();

interface SearchResult {
  id: number;
  name: string;
  slug?: string;
  type?: string;
}

interface SearchResponse {
  results?: SearchResult[];
  data?:    SearchResult[];
  teams?:   SearchResult[];
  [key: string]: unknown;
}

async function shSearch(query: string): Promise<SearchResult[]> {
  const endpoints = [
    `/api/search?q=${encodeURIComponent(query)}&type=team`,
    `/api/search?query=${encodeURIComponent(query)}`,
    `/api/team/search?q=${encodeURIComponent(query)}`,
    `/search?q=${encodeURIComponent(query)}&type=team`,
  ];

  for (const path of endpoints) {
    try {
      const resp = await fetch(`${SH_BASE}${path}`, {
        headers: SH_HEADERS,
        signal: AbortSignal.timeout(8000),
      });
      if (!resp.ok) continue;
      const ct = resp.headers.get("content-type") ?? "";
      if (!ct.includes("json")) continue;
      const json = await resp.json() as SearchResponse;

      const results: SearchResult[] =
        json.results ?? json.data ?? json.teams ?? [];

      if (Array.isArray(results) && results.length > 0) {
        return results.filter(r => r.id && r.name);
      }
    } catch { /* try next endpoint */ }
  }
  return [];
}

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\bfc\b/g, "")
    .replace(/\bsc\b/g, "")
    .replace(/\baf\b/g, "")
    .replace(/\bac\b/g, "")
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function similarity(a: string, b: string): number {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (na === nb) return 1.0;
  if (na.includes(nb) || nb.includes(na)) return 0.85;

  // Jaccard word overlap
  const wa = new Set(na.split(" "));
  const wb = new Set(nb.split(" "));
  const inter = [...wa].filter(w => wb.has(w)).length;
  const union = new Set([...wa, ...wb]).size;
  return union === 0 ? 0 : inter / union;
}

/**
 * Find the StatsHub team ID for a given team name.
 * Returns null if not found or ambiguous.
 */
export async function findTeamId(teamName: string): Promise<number | null> {
  const cacheKey = teamName.toLowerCase().trim();
  if (searchCache.has(cacheKey)) return searchCache.get(cacheKey) ?? null;

  const results = await shSearch(teamName);
  if (results.length === 0) {
    searchCache.set(cacheKey, null);
    return null;
  }

  // Find best match by name similarity
  const scored = results
    .filter(r => r.type === "team" || !r.type)
    .map(r => ({ ...r, score: similarity(r.name, teamName) }))
    .sort((a, b) => b.score - a.score);

  const best = scored[0];
  if (!best || best.score < 0.45) {
    searchCache.set(cacheKey, null);
    return null;
  }

  searchCache.set(cacheKey, best.id);
  return best.id;
}

/** Clear the search cache (useful between jobs) */
export function clearSearchCache() {
  searchCache.clear();
}
