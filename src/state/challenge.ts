/** Local handling of an incoming "beat my score" link. The score itself is
 * resolved server-side (see api.ts's fetchChallenge) — this module only
 * tracks which challenge, if any, this browser is currently playing against. */

import type { Challenge } from "./api.ts";

const STORAGE_KEY = "giveortake:challenge";
const URL_PARAM = "c";

export function readChallengeTokenFromUrl(): string | null {
  try {
    return new URLSearchParams(window.location.search).get(URL_PARAM);
  } catch {
    return null;
  }
}

/**
 * Strips ?c= once the challenge has been read into storage. Without this a
 * refresh — or worse, the player sharing their own address bar — would keep
 * re-applying someone else's challenge.
 */
export function clearChallengeParamFromUrl(): void {
  try {
    const url = new URL(window.location.href);
    if (!url.searchParams.has(URL_PARAM)) return;
    url.searchParams.delete(URL_PARAM);
    window.history.replaceState({}, "", url.pathname + url.search + url.hash);
  } catch {
    // Non-fatal: the param staying put is cosmetic, not a correctness problem.
  }
}

/** Persisted (not just held in memory) so a mid-game refresh doesn't silently
 * drop the challenge before the player reaches the results screen. */
export function savePendingChallenge(challenge: Challenge): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(challenge));
  } catch {
    // Storage unavailable — the challenge just won't survive a refresh.
  }
}

export function loadPendingChallenge(): Challenge | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Challenge>;
    if (
      typeof parsed.name === "string" &&
      typeof parsed.date === "string" &&
      typeof parsed.score === "number" &&
      typeof parsed.puzzleNumber === "number" &&
      typeof parsed.token === "string"
    ) {
      return {
        token: parsed.token,
        name: parsed.name,
        date: parsed.date,
        score: parsed.score,
        puzzleNumber: parsed.puzzleNumber,
      };
    }
    return null;
  } catch {
    return null;
  }
}

export function clearPendingChallenge(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to do — a stale entry is filtered by date on read anyway.
  }
}

/** A challenge only counts if it's for the puzzle being played right now;
 * yesterday's link can't be competed against on equal footing. */
export function isChallengeLive(challenge: Challenge | null, today: string): boolean {
  return challenge !== null && challenge.date === today;
}

const OWN_TOKEN_KEY = "giveortake:ownChallengeToken";

/**
 * The player's own token for a given date, cached locally so re-opening a
 * finished day still produces a real "beat my score" link. Without this,
 * coming back to completed results later would share a bare homepage URL,
 * since the token is only handed back at submission time.
 */
export function saveOwnChallengeToken(date: string, token: string): void {
  try {
    localStorage.setItem(OWN_TOKEN_KEY, JSON.stringify({ date, token }));
  } catch {
    // Storage unavailable — the link falls back to the plain homepage URL.
  }
}

export function loadOwnChallengeToken(date: string): string | null {
  try {
    const raw = localStorage.getItem(OWN_TOKEN_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { date?: unknown; token?: unknown };
    if (parsed.date === date && typeof parsed.token === "string") return parsed.token;
    return null;
  } catch {
    return null;
  }
}

/** Builds the shareable URL carrying a challenge token. */
export function buildChallengeUrl(token: string | null, origin: string): string {
  return token ? `${origin}/?c=${token}` : origin;
}
