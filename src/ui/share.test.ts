import { describe, it, expect } from "vitest";
import { buildShareText, buildProfileShareText, BAR_CELLS } from "./share.ts";
import { MIN_HIT_SCORE, MAX_SCORE_PER_QUESTION } from "../game/scoring.ts";
import type { AnswerRecord } from "../state/save.ts";

function answer(overrides: Partial<AnswerRecord>): AnswerRecord {
  return {
    questionId: "q",
    lo: 0,
    hi: 10,
    hit: true,
    f: 0.3,
    tight: false,
    points: 50,
    category: "geography",
    trueValue: 5,
    ...overrides,
  };
}

/** The bar row for a single answer, without the outcome marker. */
function barOf(a: AnswerRecord): string {
  const row = buildShareText(1, [a], "v", a.points, null, "u").text.split("\n")[1] ?? "";
  return row.slice(row.indexOf(" ") + 1);
}

describe("buildShareText", () => {
  it("renders a header, one bar row per question, the verdict and the challenge line", () => {
    const answers = [
      answer({ tight: true, hit: true, points: 92 }),
      answer({ tight: true, hit: true, points: 88 }),
      answer({ hit: true, tight: false, points: 61 }),
      answer({ hit: false, tight: false, points: 0 }),
      answer({ hit: true, tight: false, points: 34 }),
    ];
    const content = buildShareText(241, answers, "Overconfident about geography", 275, null, "giveortake.game");
    expect(content.text).toBe(
      [
        "Give or Take #241 🤏 275/500",
        "🎯 🟩🟩🟩🟩🟩",
        "🎯 🟩🟩🟩🟩⬜",
        "✅ 🟩🟩🟩⬜⬜",
        "❌ ⬜⬜⬜⬜⬜",
        "✅ 🟩🟩⬜⬜⬜",
        "Overconfident about geography",
        "Think you can beat me?",
      ].join("\n"),
    );
    expect(content.url).toBe("giveortake.game");
  });

  it("scales the bar with points, so a timid round reads as visibly shorter than a brave one", () => {
    // Five safe brackets that all hit, against a braver round that missed twice
    // but scored more. The braver card must not look like the weaker one.
    const timid = Array.from({ length: 5 }, () => answer({ hit: true, points: 28 }));
    const brave = [
      answer({ hit: true, tight: true, points: 92 }),
      answer({ hit: true, tight: true, points: 88 }),
      answer({ hit: false, points: 0 }),
      answer({ hit: true, tight: true, points: 90 }),
      answer({ hit: false, points: 0 }),
    ];
    const timidCard = buildShareText(1, timid, "Playing it very safe", 140, null, "u").text;
    const braveCard = buildShareText(1, brave, "Dangerously well-calibrated", 270, null, "u").text;

    const greens = (s: string) => [...s].filter((c) => c === "🟩").length;
    expect(greens(braveCard)).toBeGreaterThan(greens(timidCard));
  });

  it("gives the barest hit at least one cell so it cannot render as a miss", () => {
    // MIN_HIT_SCORE would otherwise round to zero cells and look identical
    // to a miss row, collapsing the one distinction the marker exists to make.
    const bare = barOf(answer({ hit: true, points: MIN_HIT_SCORE }));
    const miss = barOf(answer({ hit: false, points: 0 }));
    expect(bare).toBe("🟩⬜⬜⬜⬜");
    expect(miss).toBe("⬜⬜⬜⬜⬜");
    expect(bare).not.toBe(miss);
  });

  it("fills every cell on a maximum-score question", () => {
    expect(barOf(answer({ hit: true, tight: true, points: MAX_SCORE_PER_QUESTION }))).toBe("🟩".repeat(BAR_CELLS));
  });

  it("never reveals anything about the questions themselves", () => {
    const answers = [answer({ hit: false, points: 0, trueValue: 1234 })];
    const content = buildShareText(1, answers, "Confidently wrong today", 0, null, "giveortake.game");
    expect(content.text).not.toContain("q"); // no questionId leakage
    expect(content.text).not.toContain("1234"); // no true value leakage
    expect(content.text).not.toContain("geography"); // no category leakage
  });

  it("defaults the url to the current page's origin when not passed explicitly", () => {
    // In this Node test environment there's no `window`, so the default
    // falls back to an empty string rather than throwing — the real
    // browser call site always has `window.location.origin` available.
    const content = buildShareText(1, [answer({ hit: true, points: 10 })], "Sharp today", 10);
    expect(content.url).toBe("");
  });

  it("adds a percentile fragment to the verdict line when one is given", () => {
    const content = buildShareText(1, [answer({ hit: true, points: 10 })], "Sharp today", 10, 71, "giveortake.game");
    expect(content.text).toContain("Sharp today — beat 71% of players");
  });

  it("omits the percentile fragment when null (the closing challenge line stays either way)", () => {
    const content = buildShareText(1, [answer({ hit: true, points: 10 })], "Sharp today", 10, null, "giveortake.game");
    expect(content.text).not.toContain("% of players");
    expect(content.text).toContain("Think you can beat me?");
  });
});

describe("buildProfileShareText", () => {
  it("names the best and worst category with their hit rates", () => {
    const content = buildProfileShareText(
      { best: { category: "history", hitRate: 0.78 }, worst: { category: "money", hitRate: 0.22 } },
      "giveortake.game",
    );
    expect(content.text).toBe("Give or Take 🤏\nSharp on History (78%), hopeless on Money (22%)\nWhat's your profile?");
    expect(content.url).toBe("giveortake.game");
  });
});
