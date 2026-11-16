import { describe, expect, it } from "vitest";
import { applyResult, emptyStats, formatDistance, searchBuildings, shareText } from "./logic";
import type { Feedback } from "./types";

const fb = (over: Partial<Feedback>): Feedback => ({
  buildingId: "x", name: "X", correct: false,
  zone: { value: "Core", match: "wrong" },
  category: { value: "Academic", match: "correct" },
  yearBuilt: { value: 1960, match: "close", hint: "higher" },
  floors: { value: 4, match: "wrong", hint: "lower" },
  distanceM: 420, direction: "NE", proximity: 83, photo: null,
  ...over,
});

describe("shareText", () => {
  it("renders a spoiler-free grid", () => {
    const text = shareText({
      puzzle: 77,
      guesses: [fb({}), fb({ correct: true, zone: { value: "Core", match: "correct" }, yearBuilt: { value: 1960, match: "correct", hint: null }, floors: { value: 4, match: "correct", hint: null } })],
      won: true, maxGuesses: 8, url: "https://example.com",
    });
    expect(text).toBe("Westerndle #77 2/8\n⬜🟪🟨⬜ ↗️ 420 m\n🟪🟪🟪🟪 🎓\nhttps://example.com");
    expect(text).not.toContain("X");
  });
  it("marks a loss with X", () => {
    expect(shareText({ guesses: [fb({})], won: false, maxGuesses: 8, url: "u" })).toMatch(/^Westerndle \(practice\) X\/8/);
  });
});

it("formats distances", () => {
  expect(formatDistance(999)).toBe("999 m");
  expect(formatDistance(1250)).toBe("1.3 km");
});

describe("searchBuildings", () => {
  const all = [
    { id: "ucc", name: "University Community Centre", aliases: ["UCC"] },
    { id: "uc", name: "University College", aliases: ["UC"] },
    { id: "wl", name: "D.B. Weldon Library", aliases: ["Weldon"] },
  ];
  it("puts exact alias matches first", () => {
    expect(searchBuildings(all, "uc", new Set()).map((b) => b.id)).toEqual(["uc", "ucc"]);
  });
  it("matches words inside names and ignores punctuation", () => {
    expect(searchBuildings(all, "library", new Set()).map((b) => b.id)).toEqual(["wl"]);
    expect(searchBuildings(all, "db wel", new Set()).map((b) => b.id)).toEqual(["wl"]);
  });
  it("hides already-guessed buildings", () => {
    expect(searchBuildings(all, "uc", new Set(["uc"])).map((b) => b.id)).toEqual(["ucc"]);
  });
});

describe("applyResult", () => {
  it("builds and breaks streaks", () => {
    let s = emptyStats(8);
    s = applyResult(s, 10, true, 3);
    s = applyResult(s, 11, true, 5);
    expect(s.streak).toBe(2);
    s = applyResult(s, 13, true, 2); // skipped day 12
    expect(s.streak).toBe(1);
    s = applyResult(s, 14, false, 8);
    expect(s).toMatchObject({ played: 4, wins: 3, streak: 0, maxStreak: 2 });
    expect(s.distribution.slice(0, 5)).toEqual([0, 1, 1, 0, 1]);
  });
  it("ignores a puzzle counted twice", () => {
    const s = applyResult(emptyStats(8), 10, true, 3);
    expect(applyResult(s, 10, true, 3)).toBe(s);
  });
});
