import { useEffect, useState } from "react";
import { api } from "../api";
import { shareText } from "../logic";
import type { GameState, GlobalStats } from "../types";
import { Distribution } from "./StatsModal";

function useCountdown() {
  const [left, setLeft] = useState("");
  useEffect(() => {
    const tick = () => {
      // Next midnight in London, Ontario.
      const now = new Date();
      const campus = new Date(now.toLocaleString("en-US", { timeZone: "America/Toronto" }));
      const next = new Date(campus);
      next.setHours(24, 0, 0, 0);
      const s = Math.max(0, Math.floor((next.getTime() - campus.getTime()) / 1000));
      const pad = (n: number) => String(n).padStart(2, "0");
      setLeft(`${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);
  return left;
}

export function EndCard({ game, onNewPractice }: { game: GameState; onNewPractice: () => void }) {
  const won = game.status === "won";
  const answerName = won ? game.guesses[game.guesses.length - 1].name : game.answer?.name;
  const answer = game.answer;
  const [copied, setCopied] = useState(false);
  const [global, setGlobal] = useState<GlobalStats>();
  const countdown = useCountdown();

  useEffect(() => {
    if (game.mode === "daily" && game.puzzle) api.stats(game.puzzle).then(setGlobal).catch(() => {});
  }, [game.mode, game.puzzle]);

  const share = async () => {
    const text = shareText({
      puzzle: game.mode === "daily" ? game.puzzle : undefined,
      guesses: game.guesses,
      won,
      maxGuesses: game.maxGuesses,
      url: window.location.origin,
    });
    try {
      if (navigator.share && /Mobi/i.test(navigator.userAgent)) await navigator.share({ text });
      else await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* user cancelled */
    }
  };

  return (
    <section className="flip-in rounded-2xl bg-purple-western p-5 text-white shadow-lg">
      <p className="text-sm font-semibold uppercase tracking-widest text-purple-200">
        {won ? `Solved in ${game.guesses.length}/${game.maxGuesses}` : "Out of guesses"}
      </p>
      <h2 className="mt-1 text-2xl font-bold">{answerName}</h2>
      {answer?.photo && <img src={`/${answer.photo}`} alt={answerName} className="mt-3 w-full rounded-lg object-cover" />}
      {answer && (
        <a
          href={`https://www.google.com/maps/search/?api=1&query=${answer.lat},${answer.lon}`}
          target="_blank"
          rel="noreferrer"
          className="mt-1 inline-block text-sm text-purple-200 underline hover:text-white"
        >
          See it on a map
        </a>
      )}

      {global && global.plays > 0 && (
        <div className="mt-4 rounded-xl bg-white/10 p-3">
          <p className="mb-2 text-sm">
            {global.plays} {global.plays === 1 ? "player has" : "players have"} finished today ·{" "}
            {Math.round((global.wins / global.plays) * 100)}% solved it
          </p>
          <Distribution counts={global.distribution} max={Math.max(1, ...global.distribution)} highlight={won ? game.guesses.length : undefined} />
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button onClick={share} className="rounded-full bg-white px-5 py-2 font-bold text-purple-western hover:bg-purple-mist">
          {copied ? "Copied!" : "Share result"}
        </button>
        {game.mode === "practice" ? (
          <button onClick={onNewPractice} className="rounded-full border-2 border-white px-5 py-1.5 font-bold hover:bg-white/10">
            Next building
          </button>
        ) : (
          <span className="text-sm text-purple-200">
            Next building in <b className="font-mono text-white">{countdown}</b>
          </span>
        )}
      </div>
    </section>
  );
}
