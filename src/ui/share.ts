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

export type ShareOutcome = "shared" | "copied" | "cancelled" | "failed";

/**
 * Whether the native share sheet is the right tool on this device.
 *
 * Touch-primary devices only. On Windows desktop the sheet is both a worse
 * experience than the clipboard and actively unreliable: when the shell fails
 * to enumerate targets it shows "We couldn't show you all the ways you could
 * share" and rejects with AbortError — the exact error a deliberate
 * cancellation produces, so the two cannot be told apart after the fact.
 *
 * Skipping share() on desktop also keeps the click's user activation intact
 * for the clipboard write. A share() call that opens a sheet and then fails
 * has already spent that activation, so the fallback below would be refused
 * too — which is why the old code left desktop users with no way out at all.
 */
function prefersNativeShare(): boolean {
  if (typeof navigator === "undefined" || typeof navigator.share !== "function") return false;
  if (typeof matchMedia !== "function") return false;
  return matchMedia("(pointer: coarse)").matches;
}

/**
 * Below this, a sheet cannot plausibly have been shown to a person and
 * dismissed by them, so an AbortError means it never opened rather than that
 * anyone chose to close it. Deliberately generous: mistaking a cancellation
 * for a failure only copies to the clipboard, while the reverse strands the
 * player with no share at all.
 */
const SHEET_DISMISS_FLOOR_MS = 250;

export async function shareResult(content: ShareContent): Promise<ShareOutcome> {
  if (prefersNativeShare()) {
    const startedAt = Date.now();
    try {
      await navigator.share({ text: content.text, url: content.url });
      return "shared";
    } catch (err) {
      const aborted = err instanceof Error && err.name === "AbortError";
      if (aborted && Date.now() - startedAt >= SHEET_DISMISS_FLOOR_MS) return "cancelled";
      // Anything else — including an AbortError far too fast to be a human —
      // means the sheet never worked. Fall through to the clipboard.
    }
  }
  try {
    await navigator.clipboard.writeText(`${content.text}
${content.url}`);
    return "copied";
  } catch {
    return "failed";
  }
}
