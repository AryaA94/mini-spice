export type Match = "correct" | "close" | "wrong";
export type Hint = "higher" | "lower" | null;
export type Mode = "daily" | "practice";

export interface BuildingName {
  id: string;
  name: string;
  aliases: string[];
}

export interface Feedback {
  buildingId: string;
  name: string;
  correct: boolean;
  zone: { value: string; match: Match };
  category: { value: string; match: Match };
  yearBuilt: { value: number; match: Match; hint: Hint };
  floors: { value: number; match: Match; hint: Hint };
  distanceM: number;
  direction: string | null;
  proximity: number;
  photo: string | null;
}

export interface Answer {
  id: string;
  name: string;
  lat: number;
  lon: number;
  photo: string | null;
}

export interface DailyMeta {
  puzzle: number;
  date: string;
  maxGuesses: number;
}

export interface GlobalStats {
  puzzle: number;
  plays: number;
  wins: number;
  distribution: number[];
}

/** A game in progress or finished, as saved in localStorage. */
export interface GameState {
  mode: Mode;
  puzzle?: number;
  token?: string;
  maxGuesses: number;
  guesses: Feedback[];
  answer?: Answer;
  status: "playing" | "won" | "lost";
}
