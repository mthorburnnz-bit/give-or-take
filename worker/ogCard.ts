import satori from "satori";
import { initWasm, Resvg } from "@resvg/resvg-wasm";
import resvgWasm from "@resvg/resvg-wasm/index_bg.wasm";
import gelasioRegular from "./generated/gelasio-400.bin";
import gelasioBold from "./generated/gelasio-700.bin";

/**
 * Renders the link-preview image for a shared challenge.
 *
 * The text tags alone left a personalised headline sitting next to a generic
 * picture, and in every chat client that matters the picture is the larger
 * half. This draws the same card the game does: paper, the bracket mark, and
 * the score as the thing your eye lands on.
 *
 * Rasterising is genuinely expensive — satori lays the text out, resvg turns
 * it into a PNG — so callers are expected to cache the result rather than
 * render per view. See ogCardFor in index.ts.
 */

const WIDTH = 1200;
const HEIGHT = 630;

/** Wasm instantiation is the slow part, so it happens once per isolate. */
let wasmReady: Promise<void> | null = null;
function ensureWasm(): Promise<void> {
  wasmReady ??= initWasm(resvgWasm as WebAssembly.Module);
  return wasmReady;
}

const PAPER = "#f6f0e4";
const INK = "#211c15";
const INK_SOFT = "#625a4c";
const ACCENT = "#1d4e89";

/**
 * satori accepts React-style element trees. There is no JSX here on purpose —
 * the worker has no JSX pipeline, and the tree is small enough that building
 * it by hand is clearer than adding one.
 */
function node(type: string, props: Record<string, unknown>, ...children: unknown[]): unknown {
  return { type, props: { ...props, children: children.length === 1 ? children[0] : children } };
}

function card(name: string, score: number, puzzleNumber: number): unknown {
  const text = (content: string, style: Record<string, unknown>) => node("div", { style }, content);

  return node(
    "div",
    {
      style: {
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: PAPER,
        fontFamily: "Gelasio",
        padding: "60px",
      },
    },
    text(`GIVE OR TAKE  ·  PUZZLE #${puzzleNumber}`, {
      fontSize: 30,
      fontWeight: 700,
      letterSpacing: "0.18em",
      color: ACCENT,
      marginBottom: 24,
    }),
    // The bracket jaws clamping the score are the app's mark: the same shape as
    // the slider handles, the wordmark and the icon.
    node(
      "div",
      { style: { display: "flex", alignItems: "center", justifyContent: "center" } },
      text("[", { fontSize: 220, fontWeight: 700, color: ACCENT, marginRight: 28 }),
      text(String(score), { fontSize: 240, fontWeight: 700, color: INK, lineHeight: 1 }),
      text("]", { fontSize: 220, fontWeight: 700, color: ACCENT, marginLeft: 28 }),
    ),
    text(`${name} scored ${score} out of 500`, {
      fontSize: 46,
      fontWeight: 700,
      color: INK,
      marginTop: 16,
      textAlign: "center",
    }),
    text("Think you can beat it?", {
      fontSize: 34,
      fontWeight: 400,
      color: INK_SOFT,
      marginTop: 14,
    }),
  );
}

/**
 * A display name is player-supplied and arrives here unbounded in width. satori
 * does not fail on overflow, it just draws past the edge, so long names are
 * clipped to something that fits the card rather than trusted.
 */
function fitName(name: string): string {
  const trimmed = name.trim();
  return trimmed.length <= 22 ? trimmed : `${trimmed.slice(0, 21)}…`;
}

export async function renderChallengeCard(
  name: string,
  score: number,
  puzzleNumber: number,
): Promise<Uint8Array> {
  await ensureWasm();

  const svg = await satori(card(fitName(name), score, puzzleNumber) as never, {
    width: WIDTH,
    height: HEIGHT,
    fonts: [
      { name: "Gelasio", data: gelasioRegular as ArrayBuffer, weight: 400, style: "normal" },
      { name: "Gelasio", data: gelasioBold as ArrayBuffer, weight: 700, style: "normal" },
    ],
  });

  return new Resvg(svg, { fitTo: { mode: "width", value: WIDTH } }).render().asPng();
}
