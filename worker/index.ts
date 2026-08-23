import bundleData from "./generated/content-bundle.json";
import { scoreAnswer } from "../src/game/scoring.ts";
import { containsBannedWord } from "../src/game/moderation.ts";
import { computePercentile } from "../src/game/percentile.ts";
import { renderChallengeCard } from "./ogCard.ts";
import {
  encodeToken,
  isValidTokenFormat,
  TOKEN_LENGTH,
  buildChallengePreview,
} from "../src/game/challenge.ts";
import type { Question } from "../src/game/types.ts";

export interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  RATE_LIMIT: KVNamespace;
}

interface ContentBundle {
  questions: Question[];
  launchDate: string;
  schedule: Record<string, string[]>;
}

const bundle = bundleData as ContentBundle;
const questionsById = new Map<string, Question>(bundle.questions.map((q) => [q.id, q]));

function json(data: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
}

function badRequest(message: string, status = 400): Response {
  return json({ error: message }, { status });
}

/**
 * Simple fixed-window counter in KV, keyed per IP per endpoint. Not
 * airtight under concurrent requests (KV reads/writes aren't atomic), but
 * that's fine here — the goal is deterring naive spam scripts against the
 * anonymous, login-free leaderboard, not withstanding a determined
 * distributed attacker.
 */
async function checkRateLimit(env: Env, bucket: string, ip: string, limit: number, windowSeconds: number): Promise<boolean> {
  const key = `rl:${bucket}:${ip}`;
  const current = await env.RATE_LIMIT.get(key);
  const count = current ? Number.parseInt(current, 10) : 0;
  if (count >= limit) return false;
  await env.RATE_LIMIT.put(key, String(count + 1), { expirationTtl: windowSeconds });
  return true;
}

function tooManyRequests(): Response {
  return json({ error: "Too many requests — please slow down and try again shortly." }, { status: 429 });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";

    // Force HTTPS. Plain http:// was serving the whole app and API in
    // cleartext, which meant display names and scores could travel
    // unencrypted for anyone who typed the domain or followed an old link.
    // Checked via CF-Visitor as well as the URL scheme, since Cloudflare
    // terminates TLS at the edge and request.url doesn't always reflect
    // what the client actually used.
    const visitorScheme = request.headers.get("CF-Visitor");
    const isPlainHttp = url.protocol === "http:" || visitorScheme?.includes('"scheme":"http"');
    const isWww = url.hostname === "www.give-or-take.com";

    // 301 is only safe for GET/HEAD — on a POST it lets the client drop the
    // method and body. 308 preserves both, so API calls survive a redirect
    // instead of silently arriving as a bodyless GET.
    const redirectStatus = request.method === "GET" || request.method === "HEAD" ? 301 : 308;

    if (isPlainHttp || isWww) {
      // Fixed in one hop rather than chaining http->https->bare, which cost
      // an extra round trip and an extra redirect for search engines to follow.
      if (isPlainHttp) url.protocol = "https:";
      if (isWww) url.hostname = "give-or-take.com";
      return Response.redirect(url.toString(), redirectStatus);
    }

    if (url.pathname === "/api/reveal" && request.method === "POST") {
      // Generous: covers real daily play plus enthusiastic archive/practice replays.
      if (!(await checkRateLimit(env, "reveal", ip, 60, 600))) return tooManyRequests();
      return handleReveal(request, env);
    }
    if (url.pathname === "/api/submit-day" && request.method === "POST") {
      // Strict: a real player submits ~once a day. This just blocks scripted
      // spam of fake players/scores, not legitimate retries after a hiccup.
      if (!(await checkRateLimit(env, "submit", ip, 10, 3600))) return tooManyRequests();
      return handleSubmitDay(request, env);
    }
    if (url.pathname === "/api/leaderboard" && request.method === "GET") {
      return handleLeaderboard(env, url.searchParams.get("period"));
    }
    if (url.pathname === "/api/challenge" && request.method === "GET") {
      // Read-only lookup, hit once per opened share link — generous limit,
      // just enough to stop someone brute-forcing the token space.
      if (!(await checkRateLimit(env, "challenge", ip, 60, 600))) return tooManyRequests();
      return handleChallenge(env, url.searchParams.get("token"));
    }

    // The card image for a shared challenge. Unreferenced by the page until
    // proven, and served from the edge cache after the first render.
    const cardMatch = url.pathname.match(/^\/og\/c\/([A-Za-z0-9]+)\.png$/);
    if (cardMatch && (request.method === "GET" || request.method === "HEAD")) {
      return handleChallengeCard(request, env, cardMatch[1] ?? "");
    }

    // A challenge link is a normal page load that happens to carry a token.
    // Serve the same app, with the link preview rewritten to name the
    // challenger, so it says something when pasted into a chat.
    if ((request.method === "GET" || request.method === "HEAD") && url.pathname === "/") {
      const previewToken = url.searchParams.get("c");
      if (previewToken && isValidTokenFormat(previewToken)) {
        return challengeLinkPreview(request, env, previewToken);
      }
    }

    return env.ASSETS.fetch(request);
  },
};

interface RevealBody {
  questionId?: unknown;
  lo?: unknown;
  hi?: unknown;
}

interface QuestionStats {
  sampleSize: number;
  hitRate: number | null;
  tightRate: number | null;
  avgLo: number | null;
  avgHi: number | null;
}

interface QuestionStatsRow {
  n: number;
  hits: number;
  tights: number;
  avgLo: number | null;
  avgHi: number | null;
}

/**
 * Aggregates every real (non-practice) submission on record for this
 * question — `question_answers` only ever gets rows from handleSubmitDay,
 * so archive/practice replays never pollute this. Global, not per-day: a
 * question that gets reused across multiple unscheduled dates (see the
 * seeded fallback in daily.ts) accrues stats across all of them.
 */
async function fetchQuestionStats(env: Env, questionId: string): Promise<QuestionStats> {
  const row = await env.DB.prepare(
    `SELECT COUNT(*) as n, COALESCE(SUM(hit), 0) as hits, COALESCE(SUM(tight), 0) as tights,
            AVG(lo) as avgLo, AVG(hi) as avgHi
     FROM question_answers
     WHERE question_id = ?1`,
  )
    .bind(questionId)
    .first<QuestionStatsRow>();

  const n = row?.n ?? 0;
  if (n === 0) {
    return { sampleSize: 0, hitRate: null, tightRate: null, avgLo: null, avgHi: null };
  }
  return {
    sampleSize: n,
    hitRate: row!.hits / n,
    tightRate: row!.tights / n,
    avgLo: row!.avgLo,
    avgHi: row!.avgHi,
  };
}

/**
 * The true value for a question never ships to the client bundle (see
 * spec change: was AES-obfuscation-only, now the server just doesn't send
 * it). This endpoint is how the client learns hit/miss/points/trueValue
 * for a locked-in range — called for every question, real play or
 * practice/archive alike. No player identity is read or written; the
 * community stats returned are read-only aggregates of other players'
 * past submissions.
 */
async function handleReveal(request: Request, env: Env): Promise<Response> {
  let body: RevealBody;
  try {
    body = await request.json();
  } catch {
    return badRequest("invalid JSON body");
  }

  const { questionId, lo, hi } = body;
  if (typeof questionId !== "string" || typeof lo !== "number" || typeof hi !== "number") {
    return badRequest("questionId (string), lo (number), hi (number) are required");
  }
  if (!(lo <= hi)) {
    return badRequest("lo must be <= hi");
  }

  const question = questionsById.get(questionId);
  if (!question) {
    return badRequest(`unknown questionId "${questionId}"`, 404);
  }

  const result = scoreAnswer(lo, hi, question.value, question.domainMin, question.domainMax, question.scale);
  const stats = await fetchQuestionStats(env, questionId);

  return json({
    hit: result.hit,
    f: result.f,
    tight: result.tight,
    points: result.points,
    trueValue: question.value,
    funFact: question.funFact,
    source: question.source,
    stats,
  });
}

interface AnswerInput {
  questionId: string;
  lo: number;
  hi: number;
}

interface SubmitDayBody {
  playerId?: unknown;
  playerName?: unknown;
  date?: unknown;
  puzzleNumber?: unknown;
  answers?: unknown;
}

function isAnswerInput(v: unknown): v is AnswerInput {
  if (!v || typeof v !== "object") return false;
  const a = v as Record<string, unknown>;
  return typeof a.questionId === "string" && typeof a.lo === "number" && typeof a.hi === "number";
}

/**
 * Called once, after all 5 questions of a REAL (non-practice) day are
 * answered. Every answer is re-scored here from scratch against the
 * server's own copy of the true values — a client can never just POST a
 * fabricated score. `UNIQUE(player_id, date)` in the schema makes this
 * idempotent: a resubmission for a day already recorded is a silent no-op,
 * not an overwrite, so replaying a day can't inflate the leaderboard.
 */
async function handleSubmitDay(request: Request, env: Env): Promise<Response> {
  let body: SubmitDayBody;
  try {
    body = await request.json();
  } catch {
    return badRequest("invalid JSON body");
  }

  const { playerId, playerName, date, puzzleNumber, answers } = body;

  if (typeof playerId !== "string" || playerId.length < 8 || playerId.length > 64) {
    return badRequest("invalid playerId");
  }
  if (typeof playerName !== "string" || playerName.trim().length === 0) {
    return badRequest("invalid playerName");
  }
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return badRequest("invalid date, expected YYYY-MM-DD");
  }
  if (typeof puzzleNumber !== "number" || !Number.isInteger(puzzleNumber)) {
    return badRequest("invalid puzzleNumber");
  }
  if (!Array.isArray(answers) || answers.length !== 5 || !answers.every(isAnswerInput)) {
    return badRequest("answers must be an array of 5 {questionId, lo, hi} entries");
  }

  // Allow a day of timezone slack ahead of the server's UTC clock, reject
  // anything further out — this is a casual friends leaderboard, not a
  // security boundary, so we're not trying to pin exact player timezones.
  const maxAllowedDate = new Date();
  maxAllowedDate.setUTCDate(maxAllowedDate.getUTCDate() + 1);
  if (date > maxAllowedDate.toISOString().slice(0, 10)) {
    return badRequest("date is too far in the future");
  }

  const cleanName = playerName.trim().slice(0, 40);

  // Real trust boundary for the name filter — the client-side check in
  // buildNameEntryScreen is just a same-request nudge; this is what
  // actually keeps a bad name out of the players table.
  if (containsBannedWord(cleanName)) {
    return badRequest("That name isn't allowed on the leaderboard — please choose another.");
  }

  let total = 0;
  const scored: Array<AnswerInput & { hit: boolean; f: number; tight: boolean; points: number }> = [];

  for (const raw of answers) {
    if (!(raw.lo <= raw.hi)) {
      return badRequest(`lo must be <= hi for question ${raw.questionId}`);
    }
    const question = questionsById.get(raw.questionId);
    if (!question) {
      return badRequest(`unknown questionId "${raw.questionId}"`, 404);
    }
    const result = scoreAnswer(raw.lo, raw.hi, question.value, question.domainMin, question.domainMax, question.scale);
    total += result.points;
    scored.push({ ...raw, hit: result.hit, f: result.f, tight: result.tight, points: result.points });
  }

  const now = Date.now();

  await env.DB.prepare(
    `INSERT INTO players (id, name, created_at) VALUES (?1, ?2, ?3)
     ON CONFLICT(id) DO UPDATE SET name = excluded.name`,
  )
    .bind(playerId, cleanName, now)
    .run();

  const insertScore = await env.DB.prepare(
    `INSERT OR IGNORE INTO daily_scores (player_id, date, puzzle_number, score, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5)`,
  )
    .bind(playerId, date, puzzleNumber, total, now)
    .run();

  const wasNewSubmission = (insertScore.meta.changes ?? 0) > 0;

  if (wasNewSubmission) {
    const inserts = scored.map((a, i) =>
      env.DB.prepare(
        `INSERT OR IGNORE INTO question_answers
         (player_id, date, question_index, question_id, lo, hi, hit, f, tight, points, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)`,
      ).bind(playerId, date, i, a.questionId, a.lo, a.hi, a.hit ? 1 : 0, a.f, a.tight ? 1 : 0, a.points, now),
    );
    await env.DB.batch(inserts);
  }

  // On a resubmission the write above is a no-op — return the score that's
  // actually stored, not a fresh recomputation from this request's (possibly
  // different, e.g. retried-with-stale-local-state) answers.
  let persistedTotal = total;
  if (!wasNewSubmission) {
    const existing = await env.DB.prepare(`SELECT score FROM daily_scores WHERE player_id = ?1 AND date = ?2`)
      .bind(playerId, date)
      .first<{ score: number }>();
    persistedTotal = existing?.score ?? total;
  }

  // "You beat X% of players today" — computed against the persisted score
  // (not this request's possibly-stale recomputation) and always excluding
  // the player's own row, regardless of insert order above.
  const percentileRow = await env.DB.prepare(
    `SELECT COUNT(*) as total, COUNT(CASE WHEN score < ?3 THEN 1 END) as lower
     FROM daily_scores
     WHERE date = ?1 AND player_id != ?2`,
  )
    .bind(date, playerId, persistedTotal)
    .first<{ total: number; lower: number }>();
  const percentile = computePercentile(percentileRow?.lower ?? 0, percentileRow?.total ?? 0);

  // Mint a share token for this player+date. INSERT OR IGNORE plus a
  // read-back means a replay reuses the existing token rather than
  // orphaning links already sent out — UNIQUE(player_id, date) enforces it.
  await env.DB.prepare(
    `INSERT OR IGNORE INTO challenges (token, player_id, date, created_at) VALUES (?1, ?2, ?3, ?4)`,
  )
    .bind(encodeToken(crypto.getRandomValues(new Uint8Array(TOKEN_LENGTH))), playerId, date, now)
    .run();
  const challengeRow = await env.DB.prepare(
    `SELECT token FROM challenges WHERE player_id = ?1 AND date = ?2`,
  )
    .bind(playerId, date)
    .first<{ token: string }>();

  return json({
    total: persistedTotal,
    alreadySubmitted: !wasNewSubmission,
    percentile,
    challengeToken: challengeRow?.token ?? null,
  });
}

interface ChallengeRow {
  name: string;
  date: string;
  score: number;
  puzzleNumber: number;
}

/**
 * Resolves a share token to the score it represents, so a recipient sees
 * "Mark scored 210 on puzzle #47" before they play. Everything returned is
 * already public via the leaderboard — the token just saves the recipient
 * from having to go find it.
 */
async function handleChallenge(env: Env, token: string | null): Promise<Response> {
  if (typeof token !== "string" || !isValidTokenFormat(token)) {
    return badRequest("invalid challenge token");
  }
  const row = await lookupChallenge(env, token);
  if (!row) return badRequest("challenge not found", 404);
  return json(row);
}

/** The score a token stands for, or null if it resolves to nothing. */
async function lookupChallenge(env: Env, token: string): Promise<ChallengeRow | null> {
  const row = await env.DB.prepare(
    `SELECT p.name as name, c.date as date, ds.score as score, ds.puzzle_number as puzzleNumber
     FROM challenges c
     JOIN players p ON p.id = c.player_id
     JOIN daily_scores ds ON ds.player_id = c.player_id AND ds.date = c.date
     WHERE c.token = ?1`,
  )
    .bind(token)
    .first<ChallengeRow>();
  return row ?? null;
}

interface LeaderboardRow {
  playerId: string;
  name: string;
  total: number;
  daysPlayed: number;
}

/** Monday of the current UTC week, as YYYY-MM-DD — matches the plain string
 * dates `daily_scores.date` already stores, so it's usable directly in a
 * `date >= ?` filter. Not timezone-precise (same tradeoff as the date-slack
 * check in handleSubmitDay) — a casual weekly reset, not a strict boundary. */
function currentWeekStartDate(): string {
  const now = new Date();
  const day = now.getUTCDay(); // 0 = Sunday .. 6 = Saturday
  const daysSinceMonday = day === 0 ? 6 : day - 1;
  const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - daysSinceMonday));
  return monday.toISOString().slice(0, 10);
}

/**
 * `period=week` scopes the same query to the current (Monday-anchored)
 * week — gives every player a leaderboard they can realistically win on a
 * recurring basis, instead of only the all-time cumulative one, which an
 * early player can never be caught on.
 */
async function handleLeaderboard(env: Env, period: string | null): Promise<Response> {
  const weekly = period === "week";
  const base = `SELECT p.id as playerId, p.name as name, SUM(ds.score) as total, COUNT(*) as daysPlayed
     FROM daily_scores ds
     JOIN players p ON p.id = ds.player_id`;
  const tail = `GROUP BY p.id ORDER BY total DESC, daysPlayed ASC LIMIT 100`;

  const { results } = weekly
    ? await env.DB.prepare(`${base} WHERE ds.date >= ?1 ${tail}`).bind(currentWeekStartDate()).all<LeaderboardRow>()
    : await env.DB.prepare(`${base} ${tail}`).all<LeaderboardRow>();

  return json({ leaderboard: results, period: weekly ? "week" : "all" });
}

/** Writes a value into an element's `content` attribute, escaped by the runtime. */
const setContentAttribute = (value: string) => ({
  element(element: Element): void {
    element.setAttribute("content", value);
  },
});

/** Replaces an element's text, escaped by the runtime. */
const setTextContent = (value: string) => ({
  element(element: Element): void {
    element.setInnerContent(value);
  },
});

/**
 * Serves the app with its link preview rewritten to name the challenger.
 *
 * Only the preview tags change. The document is otherwise the untouched SPA,
 * which reads ?c= and resolves the challenge exactly as it always has, so a
 * player's experience of opening the link is unaffected either way.
 *
 * Everything published here — a display name and a score — is already public
 * on the leaderboard. The token saves the recipient looking it up, and grants
 * no access beyond that.
 *
 * Values go through setAttribute/setInnerContent rather than string
 * concatenation, so a display name containing quotes or angle brackets is
 * escaped by the runtime for the exact context it lands in, and cannot break
 * out of the attribute it is written into.
 */
async function challengeLinkPreview(request: Request, env: Env, token: string): Promise<Response> {
  const asset = await env.ASSETS.fetch(request);

  let row: ChallengeRow | null = null;
  try {
    row = await lookupChallenge(env, token);
  } catch {
    // A dressed-up preview is never worth failing a page load over. An unknown
    // or unresolvable token falls back to the generic card below.
  }
  if (!row) return asset;

  const { title, description } = buildChallengePreview(row.name, row.score, row.puzzleNumber);

  const rewritten = new HTMLRewriter()
    .on("title", setTextContent(title))
    .on('meta[property="og:title"]', setContentAttribute(title))
    .on('meta[property="og:description"]', setContentAttribute(description))
    .on('meta[name="twitter:title"]', setContentAttribute(title))
    .on('meta[name="twitter:description"]', setContentAttribute(description))
    .transform(asset);

  const headers = new Headers(rewritten.headers);
  // This document is personal to one token. Without this, a shared cache can
  // key on the path and serve one player's challenge card to everybody.
  headers.set("cache-control", "no-store");
  return new Response(rewritten.body, {
    status: rewritten.status,
    statusText: rewritten.statusText,
    headers,
  });
}

/** How long a rendered card may be reused. */
const CARD_CACHE_SECONDS = 86400;

/**
 * Serves the link-preview image for a challenge token.
 *
 * Rendering is expensive enough that doing it per view would be reckless — a
 * popular link is fetched by every chat client that sees it — so the result
 * goes into the edge cache. A token's score never changes once the day is
 * submitted, so the only thing that can go stale is a display name, which a
 * day of caching bounds.
 *
 * Any failure falls back to the static card rather than erroring. A broken
 * image is worse than a generic one, and a preview is never worth a 500.
 */
async function handleChallengeCard(request: Request, env: Env, token: string): Promise<Response> {
  const genericCard = () => Response.redirect(new URL("/og-image.png", request.url).toString(), 302);

  if (!isValidTokenFormat(token)) return genericCard();

  const cache = caches.default;
  const cached = await cache.match(request);
  if (cached) return cached;

  let row: ChallengeRow | null = null;
  try {
    row = await lookupChallenge(env, token);
  } catch {
    return genericCard();
  }
  if (!row) return genericCard();

  let png: Uint8Array;
  try {
    png = await renderChallengeCard(row.name, row.score, row.puzzleNumber);
  } catch {
    return genericCard();
  }

  const response = new Response(png as BodyInit, {
    headers: {
      "content-type": "image/png",
      "cache-control": `public, max-age=${CARD_CACHE_SECONDS}`,
    },
  });
  // Populated without blocking the response the crawler is waiting on.
  await cache.put(request, response.clone());
  return response;
}
