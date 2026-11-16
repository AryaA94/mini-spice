import type { GameState } from "./types";
import { emptyStats, type LocalStats } from "./logic";

// Browsers can block storage (private mode etc.); the game still works, it just forgets.
function read<T>(key: string): T | undefined {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : undefined;
  } catch {
    return undefined;
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}

export const storage = {
  dailyGame: (puzzle: number) => read<GameState>(`westerndle:daily:${puzzle}`),
  saveDailyGame: (g: GameState) => write(`westerndle:daily:${g.puzzle}`, g),
  practiceGame: () => read<GameState>("westerndle:practice"),
  savePracticeGame: (g: GameState) => write("westerndle:practice", g),
  stats: (maxGuesses: number) => read<LocalStats>("westerndle:stats") ?? emptyStats(maxGuesses),
  saveStats: (s: LocalStats) => write("westerndle:stats", s),
  seenHelp: () => read<boolean>("westerndle:seen-help") ?? false,
  markHelpSeen: () => write("westerndle:seen-help", true),
};
