import type { BuildingName, Feedback, Match } from "./types";

const EMOJI: Record<Match, string> = { correct: "🟪", close: "🟨", wrong: "⬜" };

export const ARROWS: Record<string, string> = {
  N: "⬆️", NE: "↗️", E: "➡️", SE: "↘️", S: "⬇️", SW: "↙️", W: "⬅️", NW: "↖️",
};

export const DIRECTION_DEGREES: Record<string, number> = {
  N: 0, NE: 45, E: 90, SE: 135, S: 180, SW: 225, W: 270, NW: 315,
};

/** Spoiler-free text for sharing a result, Wordle-style. */
export function shareText(opts: {
  puzzle?: number;
  guesses: Feedback[];
  won: boolean;
  maxGuesses: number;
  url: string;
}): string {
  const { puzzle, guesses, won, maxGuesses, url } = opts;
  const title = puzzle === undefined ? "Westerndle (practice)" : `Westerndle #${puzzle}`;
  const score = won ? `${guesses.length}/${maxGuesses}` : `X/${maxGuesses}`;
  const rows = guesses.map((g) => {
    const tiles = [g.zone.match, g.category.match, g.yearBuilt.match, g.floors.match].map((m) => EMOJI[m]).join("");
    const where = g.correct ? "🎓" : `${ARROWS[g.direction ?? "N"]} ${formatDistance(g.distanceM)}`;
    return `${tiles} ${where}`;
  });
  return [`${title} ${score}`, ...rows, url].join("\n");
}

export function formatDistance(m: number): string {
  return m < 1000 ? `${m} m` : `${(m / 1000).toFixed(1)} km`;
}

/** Autocomplete: match on name or alias, prefix matches first, already-guessed ids removed. */
export function searchBuildings(all: BuildingName[], query: string, exclude: Set<string>, limit = 8): BuildingName[] {
  const q = normalize(query);
  if (!q) return [];
  const scored: [number, BuildingName][] = [];
  for (const b of all) {
    if (exclude.has(b.id)) continue;
    const names = [b.name, ...b.aliases].map(normalize);
    let best = Infinity;
    for (const n of names) {
      if (n === q) best = Math.min(best, 0);
      else if (n.startsWith(q)) best = Math.min(best, 1);
      else if (n.split(" ").some((w) => w.startsWith(q))) best = Math.min(best, 2);
      else if (n.includes(q)) best = Math.min(best, 3);
    }
    if (best < Infinity) scored.push([best, b]);
  }
  scored.sort((a, b) => a[0] - b[0] || a[1].name.localeCompare(b[1].name));
  return scored.slice(0, limit).map(([, b]) => b);
}

function normalize(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9 ]/g, "").trim();
}

export interface LocalStats {
  played: number;
  wins: number;
  streak: number;
  maxStreak: number;
  lastPuzzle?: number;
  distribution: number[];
}

export function emptyStats(maxGuesses: number): LocalStats {
  return { played: 0, wins: 0, streak: 0, maxStreak: 0, distribution: Array(maxGuesses).fill(0) };
}

/** Fold one finished daily puzzle into the player's stats. A missed day breaks the streak. */
export function applyResult(stats: LocalStats, puzzle: number, won: boolean, guesses: number): LocalStats {
  if (stats.lastPuzzle !== undefined && puzzle <= stats.lastPuzzle) return stats;
  const consecutive = stats.lastPuzzle === puzzle - 1;
  const streak = won ? (consecutive ? stats.streak + 1 : 1) : 0;
  const distribution = [...stats.distribution];
  if (won) distribution[guesses - 1] = (distribution[guesses - 1] ?? 0) + 1;
  return {
    played: stats.played + 1,
    wins: stats.wins + (won ? 1 : 0),
    streak,
    maxStreak: Math.max(stats.maxStreak, streak),
    lastPuzzle: puzzle,
    distribution,
  };
}
