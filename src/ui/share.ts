import type { AnswerRecord } from "../state/save.ts";
import type { CategoryProfile } from "../state/stats.ts";
import { DAILY_MAX_SCORE, MAX_SCORE_PER_QUESTION } from "../game/scoring.ts";
import { CATEGORY_LABELS } from "./screens.ts";

/**
 * `text` and `url` are kept separate (rather than one combined string)
 * because the Web Share API cares about the difference — many native share
 * targets (Mail, X, etc.) specifically look for a structured `url` field to
 * decide whether they can handle a share at all, and silently refuse to
 * appear if a link is only ever buried inside free-text. See shareResult.
 */
export interface ShareContent {
  text: string;
  url: string;
}

/** Cells per question — five questions, five cells, so the grid reads as a block. */
export const BAR_CELLS = 5;

/**
 * One row per question: the outcome, then a bar for how much of the 100
 * points on offer the player actually took.
 *
 * The bar is the whole point of the card. Score is driven by how narrow a
 * bracket you dared to set, so a round of five wide, safe brackets can hit
 * every question and still score half what a braver mixed round does. A card
 * showing only hit/miss made that timid round look like the better game —
 * it flattered exactly the least interesting way to play. Bar length is the
 * part worth arguing about, so it's the part the card shows.
 *
 * Any hit keeps at least one cell so it can't render identically to a miss:
 * a bare hit scores MIN_HIT_SCORE, which would otherwise round to zero.
 */
function buildGrid(answers: readonly AnswerRecord[]): string {
  return answers
    .map((a) => {
      const marker = a.tight ? "🎯" : a.hit ? "✅" : "❌";
      const scaled = Math.round((a.points / MAX_SCORE_PER_QUESTION) * BAR_CELLS);
      const filled = a.hit ? Math.max(1, scaled) : scaled;
      return `${marker} ${"🟩".repeat(filled)}${"⬜".repeat(BAR_CELLS - filled)}`;
    })
    .join("\n");
}

export function buildShareText(
  puzzleNumber: number,
  answers: readonly AnswerRecord[],
  verdict: string,
  totalScore: number,
  percentile: number | null = null,
  // Defaults to wherever the app is actually running (workers.dev today,
  // a real domain later) so this never needs a manual edit when that changes.
  url: string = typeof window !== "undefined" ? window.location.origin : "",
): ShareContent {
  const percentileLine = percentile !== null ? ` — beat ${percentile}% of players` : "";
  const text = [
    `Give or Take #${puzzleNumber} 🤏 ${totalScore}/${DAILY_MAX_SCORE}`,
    buildGrid(answers),
    `${verdict}${percentileLine}`,
    "Think you can beat me?",
  ].join("\n");
  return { text, url };
}

export function buildProfileShareText(
  profile: CategoryProfile,
  url: string = typeof window !== "undefined" ? window.location.origin : "",
): ShareContent {
  const bestPercent = Math.round(profile.best.hitRate * 100);
  const worstPercent = Math.round(profile.worst.hitRate * 100);
  const text = `Give or Take 🤏\nSharp on ${CATEGORY_LABELS[profile.best.category]} (${bestPercent}%), hopeless on ${CATEGORY_LABELS[profile.worst.category]} (${worstPercent}%)\nWhat's your profile?`;
  return { text, url };
}

export type ShareOutcome = "shared" | "copied" | "failed";

export async function shareResult(content: ShareContent): Promise<ShareOutcome> {
  if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
    try {
      await navigator.share({ text: content.text, url: content.url });
      return "shared";
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        // User cancelled the native share sheet — not a failure, just no-op.
        return "failed";
      }
      // Fall through to clipboard on other share failures.
    }
  }
  try {
    await navigator.clipboard.writeText(`${content.text}\n${content.url}`);
    return "copied";
  } catch {
    return "failed";
  }
}
