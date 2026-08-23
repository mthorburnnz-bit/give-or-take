import { writeFileSync, mkdirSync, copyFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadQuestionBank, loadSchedule } from "./loadContent.ts";

/**
 * Generates two JSON bundles from the same source-of-truth question files:
 *
 *  - worker/generated/content-bundle.json — FULL question data (including
 *    value/funFact/source), for the Worker to statically import. Workers
 *    have no filesystem at runtime, and Vite's import.meta.glob is a
 *    bundler-specific macro that doesn't exist in the Workers/esbuild
 *    build, so the worker needs its own plain, statically-importable copy.
 *
 *  - content/generated/public-bundle.json — REDACTED question data (no
 *    value/funFact/source) for the browser client. The true answer must
 *    never ship in the client bundle — it's fetched per-question from
 *    /api/reveal only once the player has locked in a range.
 *
 * Run as part of `npm run build`, before both the Vite client build and the
 * `wrangler deploy` step that bundles worker/index.ts.
 */

const here = dirname(fileURLToPath(import.meta.url));
const workerOutDir = join(here, "..", "worker", "generated");
const workerOutFile = join(workerOutDir, "content-bundle.json");
const publicOutDir = join(here, "..", "content", "generated");
const publicOutFile = join(publicOutDir, "public-bundle.json");

/**
 * Copies the OG card's fonts next to the content bundle, renamed to .bin.
 *
 * Wrangler maps .bin imports to an ArrayBuffer, which is exactly what satori
 * wants, and it has no loader for .woff. Copied from node_modules at build
 * time rather than committed so the font stays a tracked dependency with its
 * licence attached, updated by npm like anything else.
 *
 * Gelasio is metrically compatible with Georgia, the first face in the app's
 * display stack, so the card looks like the game rather than merely near it.
 * The .woff is deliberate: satori cannot read woff2.
 */
function copyCardFonts(): void {
  const fontDir = join(here, "..", "node_modules", "@fontsource", "gelasio", "files");
  for (const weight of [400, 700]) {
    copyFileSync(
      join(fontDir, `gelasio-latin-${weight}-normal.woff`),
      join(workerOutDir, `gelasio-${weight}.bin`),
    );
  }
}

function main(): void {
  const questions = loadQuestionBank();
  const { launchDate, schedule } = loadSchedule();

  mkdirSync(workerOutDir, { recursive: true });
  copyCardFonts();
  writeFileSync(workerOutFile, JSON.stringify({ questions, launchDate, schedule }, null, 2));

  const publicQuestions = questions.map(({ value: _value, funFact: _funFact, source: _source, ...rest }) => rest);
  mkdirSync(publicOutDir, { recursive: true });
  writeFileSync(publicOutFile, JSON.stringify({ questions: publicQuestions, launchDate, schedule }, null, 2));

  console.log(`Bundled ${questions.length} questions + schedule:`);
  console.log(`  full (server-only) -> ${workerOutFile}`);
  console.log(`  redacted (client)  -> ${publicOutFile}`);
}

main();
