import type { Hint, Match } from "../types";

const STYLES: Record<Match, string> = {
  correct: "bg-purple-western text-white border-purple-western",
  close: "bg-close text-purple-deep border-close",
  wrong: "bg-white text-neutral-700 border-neutral-300 dark:bg-white/5 dark:text-neutral-300 dark:border-white/15",
};

// Spelled out for screen readers, since colour alone carries the result.
const LABEL: Record<Match, string> = { correct: "correct", close: "close", wrong: "not a match" };

export function Tile(props: { label: string; value: string | number; match: Match; hint?: Hint; delay?: number }) {
  const { label, value, match, hint, delay = 0 } = props;
  const arrow = hint === "higher" ? "▲" : hint === "lower" ? "▼" : "";
  return (
    <div
      className={`flip-in flex min-h-16 flex-col items-center justify-center rounded-lg border px-1 py-2 text-center ${STYLES[match]}`}
      style={{ animationDelay: `${delay}ms` }}
      aria-label={`${label}: ${value}, ${LABEL[match]}${hint ? `, answer is ${hint}` : ""}`}
    >
      <span className="text-[10px] font-semibold uppercase tracking-wider opacity-75">{label}</span>
      <span className="text-sm font-bold leading-tight">
        {value}
        {arrow && <span className="ml-0.5 text-xs">{arrow}</span>}
      </span>
    </div>
  );
}
