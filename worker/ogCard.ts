import { initWasm, Resvg } from "@resvg/resvg-wasm";
import resvgWasm from "@resvg/resvg-wasm/index_bg.wasm";
import gelasioRegular from "./generated/gelasio-400.bin";
import gelasioBold from "./generated/gelasio-700.bin";

/**
 * Renders the link-preview image for a shared challenge.
 *
 * The text tags alone left a personalised headline sitting next to a generic
 * picture, and in every chat client that matters the picture is the larger
 * half. This draws the same card the game does: paper, the bracket mark
 * clamping the score, and the challenger named underneath.
 *
 * The SVG is written by hand rather than laid out by satori. satori would mean
 * a real layout engine — yoga for boxes, harfbuzz for shaping — and neither
 * loads its wasm in a way Workers permits: harfbuzzjs reaches for a script URL
 * that does not exist there. This card is four fixed strings on a fixed
 * canvas, so a layout engine was never buying anything, and dropping it takes
 * satori and its twelve dependencies out of the bundle with it.
 */

const WIDTH = 1200;
const HEIGHT = 630;

/** Wasm instantiation is the slow part, so it happens once per isolate. */
let wasmReady: Promise<void> | null = null;
function ensureWasm(): Promise<void> {
  wasmReady ??= initWasm(resvgWasm as WebAssembly.Module);
  return wasmReady;
}

const GROUND = "#0a1837";
const GROUND_LIT = "#1d3f7d";
const GROUND_EDGE = "#050d20";
const INK = "#f2f6ff";
const INK_SOFT = "#a9c1e6";
const ACCENT = "#f3c65a";

/** Everything interpolated into the SVG passes through here first. */
function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Only the Latin subset of the face is bundled, so anything outside it would
 * render as empty boxes. A name that would tofu is better not drawn at all —
 * the caller falls back to the static card, which still carries the
 * personalised title from the text tags.
 */
const RENDERABLE = /^[ -~ -ɏ‘’“”–—]*$/;

export function canRenderName(name: string): boolean {
  return RENDERABLE.test(name);
}

/**
 * Rough advance width of a string, in em.
 *
 * There is no layout engine here to ask, and character count is not a usable
 * proxy: a name of 20 W's is nearly three times the width of 20 i's, and the
 * first overflowed the canvas in both directions. These buckets are eyeballed
 * from the face rather than measured, which is fine — they only have to be
 * close enough to choose a font size that fits.
 */
function estimateEm(text: string): number {
  let em = 0;
  for (const ch of text) {
    if ("MWmw@%".includes(ch)) em += 1.05;
    else if ("ABCDEFGHIJKLNOPQRSTUVXYZ0123456789".includes(ch)) em += 0.70;
    else if ("filjtI.,;:'\"!|()[]{} ".includes(ch)) em += 0.32;
    else em += 0.56;
  }
  return em;
}

/**
 * A display name arrives unbounded in width, and resvg neither wraps nor
 * shrinks text — it draws straight off the edge of the canvas. So the heading
 * is measured and its size chosen to fit, with a hard character cap on top so
 * a pathological name cannot shrink the line into illegibility.
 */
export function fitName(name: string): string {
  const trimmed = name.trim();
  return trimmed.length <= 24 ? trimmed : `${trimmed.slice(0, 23)}…`;
}

/** Largest size at or below `max` that keeps `text` inside `maxWidth` px. */
export function fitFontSize(text: string, maxWidth: number, max: number, min: number): number {
  const em = estimateEm(text);
  if (em === 0) return max;
  return Math.max(min, Math.min(max, Math.floor(maxWidth / em)));
}

export function buildCardSvg(name: string, score: number, puzzleNumber: number): string {
  // The name gets a line to itself. Sharing one with "scored N out of 500" left
  // it about a third of the canvas, which a name of wide glyphs overran no
  // matter how the size was chosen; alone it has the full width and real names
  // never need shrinking at all.
  const displayName = escapeXml(fitName(name));
  const nameSize = fitFontSize(fitName(name), WIDTH - 160, 54, 26);
  const subtitle = escapeXml(`scored ${score} out of 500 · think you can beat it?`);
  const kicker = escapeXml(`GIVE OR TAKE  ·  PUZZLE #${puzzleNumber}`);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
  <defs>
    <radialGradient id="stage" cx="50%" cy="4%" r="78%">
      <stop offset="0%" stop-color="${GROUND_LIT}"/>
      <stop offset="42%" stop-color="${GROUND}"/>
      <stop offset="100%" stop-color="${GROUND_EDGE}"/>
    </radialGradient>
  </defs>
  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#stage)"/>
  <text x="${WIDTH / 2}" y="122" text-anchor="middle" font-family="Gelasio" font-weight="700"
        font-size="30" letter-spacing="6" fill="${ACCENT}">${kicker}</text>
  <text x="${WIDTH / 2}" y="366" text-anchor="middle" font-family="Gelasio" font-weight="700">
    <tspan font-size="185" fill="${ACCENT}">[</tspan><tspan font-size="215" fill="${INK}" dx="22">${score}</tspan><tspan font-size="185" fill="${ACCENT}" dx="22">]</tspan>
  </text>
  <text x="${WIDTH / 2}" y="470" text-anchor="middle" font-family="Gelasio" font-weight="700"
        font-size="${nameSize}" fill="${INK}">${displayName}</text>
  <text x="${WIDTH / 2}" y="536" text-anchor="middle" font-family="Gelasio" font-weight="400"
        font-size="32" fill="${INK_SOFT}">${subtitle}</text>
</svg>`;
}

export async function renderChallengeCard(
  name: string,
  score: number,
  puzzleNumber: number,
): Promise<Uint8Array> {
  await ensureWasm();

  const renderer = new Resvg(buildCardSvg(name, score, puzzleNumber), {
    fitTo: { mode: "width", value: WIDTH },
    font: {
      fontBuffers: [new Uint8Array(gelasioRegular), new Uint8Array(gelasioBold)],
      defaultFontFamily: "Gelasio",
      // There are no system fonts in a Worker, and asking for them is slow.
      loadSystemFonts: false,
    },
  });

  return renderer.render().asPng();
}
