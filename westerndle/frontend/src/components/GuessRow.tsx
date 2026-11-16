import { DIRECTION_DEGREES, formatDistance } from "../logic";
import type { Feedback } from "../types";
import { Tile } from "./Tile";

export function GuessRow({ g, index }: { g: Feedback; index: number }) {
  return (
    <li className="rounded-xl border border-purple-western/15 bg-white p-3 shadow-sm dark:border-white/10 dark:bg-white/5">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="font-semibold">
          <span className="mr-2 text-sm text-silver">{index + 1}.</span>
          {g.name}
        </span>
        {g.correct ? (
          <span className="rounded-full bg-purple-western px-2 py-0.5 text-xs font-bold text-white">Got it!</span>
        ) : (
          <span className="flex items-center gap-1.5 text-sm font-semibold text-purple-western dark:text-purple-300">
            {formatDistance(g.distanceM)}
            <span
              className="inline-block text-base leading-none"
              style={{ transform: `rotate(${DIRECTION_DEGREES[g.direction ?? "N"]}deg)` }}
              aria-label={`answer is to the ${g.direction}`}
              role="img"
            >
              ↑
            </span>
          </span>
        )}
      </div>
      <div className="grid grid-cols-5 gap-1.5">
        <Tile label="Zone" value={g.zone.value} match={g.zone.match} delay={0} />
        <Tile label="Type" value={g.category.value} match={g.category.match} delay={80} />
        <Tile label="Built" value={g.yearBuilt.value} match={g.yearBuilt.match} hint={g.yearBuilt.hint} delay={160} />
        <Tile label="Floors" value={g.floors.value} match={g.floors.match} hint={g.floors.hint} delay={240} />
        <Tile
          label="Near"
          value={`${g.proximity}%`}
          match={g.correct ? "correct" : g.proximity >= 90 ? "close" : "wrong"}
          delay={320}
        />
      </div>
    </li>
  );
}
