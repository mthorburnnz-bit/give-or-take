const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

/** Length of a minted challenge token, in characters. 8 base62 chars is
 * ~2.2e14 possibilities — far more than enough to make guessing another
 * player's link impractical, while staying short enough to sit comfortably
 * in a shared URL. */
export const TOKEN_LENGTH = 8;

/**
 * Maps random bytes onto a base62 token. Randomness is passed in rather
 * than generated here so this stays pure and testable — the worker supplies
 * `crypto.getRandomValues`.
 *
 * The modulo introduces a very slight bias toward the first few characters
 * (256 isn't a multiple of 62). That's irrelevant here: the token is a
 * public identifier for a score that's already visible on the leaderboard,
 * not a secret, so it only needs to resist casual enumeration.
 */
export function encodeToken(bytes: Uint8Array): string {
  let token = "";
  for (const byte of bytes) {
    token += ALPHABET[byte % ALPHABET.length];
  }
  return token;
}

/** Rejects anything that isn't a plausible token before it reaches the
 * database — cheap guard against malformed or injected query params. */
export function isValidTokenFormat(token: string): boolean {
  if (token.length !== TOKEN_LENGTH) return false;
  for (const ch of token) {
    if (!ALPHABET.includes(ch)) return false;
  }
  return true;
}

/** The title and description a shared challenge link previews with. */
export interface ChallengePreview {
  title: string;
  description: string;
}

/**
 * The link preview for a "beat my score" link.
 *
 * Every shared link previewed identically before this — same title, same
 * generic blurb — so a challenge dropped into a group chat said nothing about
 * whose it was or what there was to beat. Naming the challenger and the score
 * is the whole point of the link.
 *
 * Pure, and separate from the worker, so the wording is testable without
 * standing up a Worker runtime. Escaping is deliberately NOT done here: the
 * caller writes these through HTMLRewriter's setAttribute/setInnerContent,
 * which escape for the context they land in. Escaping twice would show
 * players an &amp; in their own name.
 */
export function buildChallengePreview(name: string, score: number, puzzleNumber: number): ChallengePreview {
  return {
    title: `${name} scored ${score} on Give or Take #${puzzleNumber}`,
    description: "Beat it in five questions. Set a range, not a number — tighter and right scores more.",
  };
}
