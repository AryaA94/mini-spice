import type { Answer, BuildingName, DailyMeta, Feedback, GlobalStats, Mode } from "./types";

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    throw new Error(detail.detail ?? `Request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

const post = <T>(path: string, body?: unknown) =>
  call<T>(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });

export interface GameRef {
  mode: Mode;
  puzzle?: number;
  token?: string;
}

export const api = {
  buildings: () => call<BuildingName[]>("/buildings"),
  daily: () => call<DailyMeta>("/daily"),
  newPractice: () => post<{ token: string; maxGuesses: number }>("/practice"),
  guess: (ref: GameRef, buildingId: string) => post<Feedback>("/guess", { ...ref, buildingId }),
  reveal: (ref: GameRef, guesses: number) => post<Answer>("/reveal", { ...ref, guesses }),
  recordResult: (puzzle: number, won: boolean, guesses: number) =>
    post<{ ok: boolean }>("/results", { puzzle, won, guesses }),
  stats: (puzzle: number) => call<GlobalStats>(`/stats/${puzzle}`),
};
