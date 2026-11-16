import type { LocalStats } from "../logic";
import { Modal } from "./Modal";

export function StatsModal({ stats, highlight, onClose }: { stats: LocalStats; highlight?: number; onClose: () => void }) {
  const max = Math.max(1, ...stats.distribution);
  const winPct = stats.played ? Math.round((stats.wins / stats.played) * 100) : 0;
  return (
    <Modal title="Your stats" onClose={onClose}>
      <div className="mb-5 grid grid-cols-4 gap-2 text-center">
        {[
          ["Played", stats.played],
          ["Win %", winPct],
          ["Streak", stats.streak],
          ["Best", stats.maxStreak],
        ].map(([label, n]) => (
          <div key={label}>
            <div className="text-2xl font-bold text-purple-western dark:text-purple-200">{n}</div>
            <div className="text-xs text-silver">{label}</div>
          </div>
        ))}
      </div>
      <h3 className="mb-2 text-sm font-semibold">Guess distribution</h3>
      <Distribution counts={stats.distribution} max={max} highlight={highlight} />
    </Modal>
  );
}

export function Distribution({ counts, max, highlight }: { counts: number[]; max: number; highlight?: number }) {
  return (
    <ol className="space-y-1">
      {counts.map((n, i) => (
        <li key={i} className="flex items-center gap-2 text-sm">
          <span className="w-3 text-right font-semibold">{i + 1}</span>
          <div className="flex-1">
            <div
              className={`rounded px-1.5 text-right text-xs font-bold leading-5 text-white ${
                highlight === i + 1 ? "bg-purple-western" : "bg-silver"
              }`}
              style={{ width: `${Math.max(8, (n / max) * 100)}%` }}
            >
              {n}
            </div>
          </div>
        </li>
      ))}
    </ol>
  );
}
