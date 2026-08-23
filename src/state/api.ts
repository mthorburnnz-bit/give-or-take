/** Thin client for the Worker API. All scoring happens server-side —
 * see worker/index.ts. Network is required to reveal any question. */

/** Community aggregates for this question, from every other player's real
 * (non-practice) submission on record. `sampleSize` 0 means nobody else has
 * answered yet — the rate/average fields are null in that case. */
export interface QuestionStats {
  sampleSize: number;
  hitRate: number | null;
  tightRate: number | null;
  avgLo: number | null;
  avgHi: number | null;
}

export interface RevealApiResult {
  hit: boolean;
  f: number;
  tight: boolean;
  points: number;
  trueValue: number;
  funFact: string;
  source: string;
  stats: QuestionStats;
}

export class ApiError extends Error {}

async function parseOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let message = `request failed (${res.status})`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      // ignore — use the generic message
    }
    throw new ApiError(message);
  }
  return res.json() as Promise<T>;
}

export async function fetchReveal(questionId: string, lo: number, hi: number): Promise<RevealApiResult> {
  const res = await fetch("/api/reveal", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ questionId, lo, hi }),
  });
  return parseOrThrow<RevealApiResult>(res);
}

export interface SubmitDayAnswer {
  questionId: string;
  lo: number;
  hi: number;
}

export interface SubmitDayResult {
  total: number;
  alreadySubmitted: boolean;
  percentile: number | null;
  /** Token for a shareable "beat my score" link, or null if minting failed. */
  challengeToken: string | null;
}

/** A score someone else is challenging you to beat, resolved from a ?c= link. */
export interface Challenge {
  /** Needed to report back whether this challenge was beaten. */
  token: string;
  name: string;
  date: string;
  score: number;
  puzzleNumber: number;
}

export async function fetchChallenge(token: string): Promise<Challenge> {
  // Bounded so a dead connection fails fast rather than leaving the incoming
  // challenge unresolved indefinitely — the caller treats a failure as
  // "no challenge" and the link can be retried by refreshing.
  const res = await fetch(`/api/challenge?token=${encodeURIComponent(token)}`, {
    signal: AbortSignal.timeout(8000),
  });
  return parseOrThrow<Challenge>(res);
}

export async function submitDay(
  playerId: string,
  playerName: string,
  date: string,
  puzzleNumber: number,
  answers: SubmitDayAnswer[],
  /** Present when this day was played from someone's challenge link. */
  challengeToken?: string,
): Promise<SubmitDayResult> {
  const res = await fetch("/api/submit-day", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ playerId, playerName, date, puzzleNumber, answers, challengeToken }),
  });
  return parseOrThrow<SubmitDayResult>(res);
}

export interface LeaderboardEntry {
  playerId: string;
  name: string;
  total: number;
  daysPlayed: number;
}

export type LeaderboardPeriod = "week" | "all";

export async function fetchLeaderboard(period: LeaderboardPeriod = "week"): Promise<LeaderboardEntry[]> {
  const res = await fetch(`/api/leaderboard?period=${period}`);
  const data = await parseOrThrow<{ leaderboard: LeaderboardEntry[] }>(res);
  return data.leaderboard;
}

/** How the player's own challenge links have fared. */
export interface ChallengeResults {
  taken: number;
  beaten: number;
}

/**
 * Asks what happened to the challenges this player sent out.
 *
 * Short timeout and no retry: this only decorates the home screen and must
 * never hold up rendering it. Callers treat a failure as nothing to report.
 */
export async function fetchChallengeResults(playerId: string): Promise<ChallengeResults> {
  const res = await fetch(`/api/challenge-results?playerId=${encodeURIComponent(playerId)}`, {
    signal: AbortSignal.timeout(6000),
  });
  return parseOrThrow<ChallengeResults>(res);
}
