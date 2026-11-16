import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "./api";
import { EndCard } from "./components/EndCard";
import { GuessInput } from "./components/GuessInput";
import { GuessRow } from "./components/GuessRow";
import { HelpModal } from "./components/HelpModal";
import { StatsModal } from "./components/StatsModal";
import { applyResult } from "./logic";
import { storage } from "./storage";
import type { BuildingName, DailyMeta, GameState, Mode } from "./types";

export default function App() {
  const [buildings, setBuildings] = useState<BuildingName[]>([]);
  const [daily, setDaily] = useState<DailyMeta>();
  const [mode, setMode] = useState<Mode>("daily");
  const [game, setGame] = useState<GameState>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [modal, setModal] = useState<"help" | "stats" | null>(storage.seenHelp() ? null : "help");
  const [stats, setStats] = useState(() => storage.stats(8));

  useEffect(() => {
    Promise.all([api.buildings(), api.daily()])
      .then(([b, d]) => {
        setBuildings(b);
        setDaily(d);
      })
      .catch(() => setError("Couldn't reach the server. Try refreshing."));
  }, []);

  const newPractice = useCallback(async () => {
    const { token, maxGuesses } = await api.newPractice();
    const g: GameState = { mode: "practice", token, maxGuesses, guesses: [], status: "playing" };
    storage.savePracticeGame(g);
    setGame(g);
  }, []);

  // Load (or start) the game for the selected mode.
  useEffect(() => {
    if (!daily) return;
    if (mode === "daily") {
      setGame(
        storage.dailyGame(daily.puzzle) ?? {
          mode: "daily", puzzle: daily.puzzle, maxGuesses: daily.maxGuesses, guesses: [], status: "playing",
        },
      );
    } else {
      const saved = storage.practiceGame();
      if (saved && saved.status === "playing") setGame(saved);
      else newPractice().catch(() => setError("Couldn't start a practice game."));
    }
  }, [mode, daily, newPractice]);

  const guessed = useMemo(() => new Set(game?.guesses.map((g) => g.buildingId)), [game]);

  const save = (g: GameState) => {
    setGame(g);
    if (g.mode === "daily") storage.saveDailyGame(g);
    else storage.savePracticeGame(g);
  };

  const onGuess = async (buildingId: string) => {
    if (!game || game.status !== "playing" || busy) return;
    setBusy(true);
    setError(undefined);
    const ref = { mode: game.mode, puzzle: game.puzzle, token: game.token };
    try {
      const fb = await api.guess(ref, buildingId);
      const guesses = [...game.guesses, fb];
      let next: GameState = { ...game, guesses };
      if (fb.correct) {
        next.status = "won";
      } else if (guesses.length >= game.maxGuesses) {
        next = { ...next, status: "lost", answer: await api.reveal(ref, guesses.length) };
      }
      // A win needs the answer's coordinates for the map link too.
      if (next.status === "won") next.answer = await api.reveal(ref, game.maxGuesses).catch(() => undefined);
      save(next);
      if (next.status !== "playing" && next.mode === "daily" && next.puzzle) {
        const won = next.status === "won";
        api.recordResult(next.puzzle, won, guesses.length).catch(() => {});
        const s = applyResult(stats, next.puzzle, won, guesses.length);
        storage.saveStats(s);
        setStats(s);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };

  const closeModal = () => {
    if (modal === "help") storage.markHelpSeen();
    setModal(null);
  };

  const left = game ? game.maxGuesses - game.guesses.length : 0;

  return (
    <div className="min-h-screen">
      <header className="bg-purple-western text-white shadow-md">
        <div className="mx-auto flex max-w-2xl items-center justify-between px-4 py-3">
          <button onClick={() => setModal("help")} aria-label="How to play" className="grid h-9 w-9 place-items-center rounded-full border border-white/40 font-bold hover:bg-white/10">
            ?
          </button>
          <h1 className="text-2xl font-extrabold tracking-tight">
            Western<span className="text-purple-200">dle</span>
          </h1>
          <button onClick={() => setModal("stats")} aria-label="Statistics" className="grid h-9 w-9 place-items-center rounded-full border border-white/40 hover:bg-white/10">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <rect x="3" y="12" width="4" height="9" rx="1" />
              <rect x="10" y="7" width="4" height="14" rx="1" />
              <rect x="17" y="3" width="4" height="18" rx="1" />
            </svg>
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-2xl space-y-4 px-4 py-5">
        <div className="flex rounded-full bg-purple-mist p-1 dark:bg-white/10" role="tablist">
          {(["daily", "practice"] as const).map((m) => (
            <button
              key={m}
              role="tab"
              aria-selected={mode === m}
              onClick={() => setMode(m)}
              className={`flex-1 rounded-full py-2 text-sm font-bold transition ${
                mode === m ? "bg-purple-western text-white shadow" : "text-purple-western dark:text-purple-200"
              }`}
            >
              {m === "daily" ? `Daily${daily ? ` #${daily.puzzle}` : ""}` : "Practice"}
            </button>
          ))}
        </div>

        <p className="text-center text-sm text-silver">
          {mode === "daily" ? "Which Western building is today's mystery?" : "Unlimited random buildings. Doesn't count toward your streak."}
        </p>

        {game && (
          <>
            {game.status === "playing" ? (
              <>
                <GuessInput buildings={buildings} guessed={guessed} disabled={busy} onGuess={onGuess} />
                <p className="text-center text-xs font-semibold uppercase tracking-widest text-silver">
                  {left} {left === 1 ? "guess" : "guesses"} left
                </p>
              </>
            ) : (
              <EndCard game={game} onNewPractice={() => newPractice().catch(() => setError("Couldn't start a practice game."))} />
            )}

            {error && <p role="alert" className="rounded-lg bg-red-100 px-4 py-2 text-sm text-red-800">{error}</p>}

            <ol className="space-y-3">
              {game.guesses.map((g, i) => ({ g, i })).reverse().map(({ g, i }) => (
                <GuessRow key={g.buildingId} g={g} index={i} />
              ))}
            </ol>
          </>
        )}
        {!game && !error && <p className="py-10 text-center text-silver">Loading…</p>}
        {!game && error && <p role="alert" className="rounded-lg bg-red-100 px-4 py-2 text-sm text-red-800">{error}</p>}
      </main>

      <footer className="pb-8 text-center text-xs text-silver">Fan-made · not affiliated with Western University</footer>

      {modal === "help" && <HelpModal maxGuesses={daily?.maxGuesses ?? 8} onClose={closeModal} />}
      {modal === "stats" && <StatsModal stats={stats} onClose={closeModal} />}
    </div>
  );
}
