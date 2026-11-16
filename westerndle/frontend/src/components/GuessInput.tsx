import { useId, useMemo, useState } from "react";
import { searchBuildings } from "../logic";
import type { BuildingName } from "../types";

export function GuessInput(props: {
  buildings: BuildingName[];
  guessed: Set<string>;
  disabled: boolean;
  onGuess: (id: string) => void;
}) {
  const { buildings, guessed, disabled, onGuess } = props;
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listId = useId();
  const matches = useMemo(() => searchBuildings(buildings, query, guessed), [buildings, query, guessed]);

  const submit = (b?: BuildingName) => {
    if (!b) return;
    onGuess(b.id);
    setQuery("");
    setActive(0);
  };

  return (
    <div className="relative">
      <input
        type="text"
        value={query}
        disabled={disabled}
        placeholder={disabled ? "Game over — come back tomorrow" : "Type a building name or code (e.g. UCC)…"}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((a) => Math.min(a + 1, matches.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === "Enter") {
            e.preventDefault();
            submit(matches[active]);
          } else if (e.key === "Escape") {
            setQuery("");
          }
        }}
        role="combobox"
        aria-expanded={matches.length > 0}
        aria-controls={listId}
        aria-activedescendant={matches[active] ? `${listId}-${matches[active].id}` : undefined}
        aria-label="Guess a building"
        autoComplete="off"
        className="w-full rounded-xl border-2 border-purple-western/30 bg-white px-4 py-3 text-base outline-none transition focus:border-purple-western disabled:cursor-not-allowed disabled:opacity-60 dark:bg-white/5"
      />
      {matches.length > 0 && (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-20 mt-1 max-h-72 w-full overflow-auto rounded-xl border border-purple-western/20 bg-white py-1 shadow-lg dark:bg-[#22133a]"
        >
          {matches.map((b, i) => (
            <li
              key={b.id}
              id={`${listId}-${b.id}`}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => {
                e.preventDefault();
                submit(b);
              }}
              onMouseEnter={() => setActive(i)}
              className={`flex cursor-pointer items-baseline justify-between gap-3 px-4 py-2 ${
                i === active ? "bg-purple-mist dark:bg-purple-western/40" : ""
              }`}
            >
              <span>{b.name}</span>
              {b.aliases[0] && <span className="text-xs font-semibold text-silver">{b.aliases[0]}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
