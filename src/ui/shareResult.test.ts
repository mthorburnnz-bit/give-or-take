import { describe, it, expect, vi, afterEach } from "vitest";
import { shareResult } from "./share.ts";

const CONTENT = { text: "Give or Take #28", url: "https://give-or-take.com/?c=a1b2c3d4" };

/** Stand up a device: `coarse` decides whether a native share sheet exists. */
function device(opts: {
  coarse: boolean;
  share?: (data: unknown) => Promise<void>;
  writeText?: (t: string) => Promise<void>;
}) {
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: opts.coarse && q.includes("coarse") }));
  vi.stubGlobal("navigator", {
    ...(opts.share ? { share: opts.share } : {}),
    clipboard: { writeText: opts.writeText ?? (async () => {}) },
  });
}

function abortAfter(ms: number) {
  return async () => {
    if (ms > 0) await new Promise((r) => setTimeout(r, ms));
    const e = new Error("Share canceled");
    e.name = "AbortError";
    throw e;
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("shareResult", () => {
  it("never opens the native sheet on a desktop pointer, even where the API exists", async () => {
    // Windows/Edge exposes navigator.share but its shell sheet is unreliable,
    // and a failed share() spends the user activation the clipboard needs.
    const share = vi.fn(async () => {});
    const writeText = vi.fn(async () => {});
    device({ coarse: false, share, writeText });

    expect(await shareResult(CONTENT)).toBe("copied");
    expect(share).not.toHaveBeenCalled();
    expect(writeText).toHaveBeenCalledOnce();
  });

  it("falls back to the clipboard when the sheet aborts instantly (it never opened)", async () => {
    // The reported Windows failure: "We couldn't show you all the ways you
    // could share", surfacing as an immediate AbortError. This previously
    // returned early and left the player with no share at all.
    const writeText = vi.fn(async () => {});
    device({ coarse: true, share: abortAfter(0), writeText });

    expect(await shareResult(CONTENT)).toBe("copied");
    expect(writeText).toHaveBeenCalledOnce();
  });

  it("treats a slow abort as the player dismissing the sheet, and does not copy behind their back", async () => {
    const writeText = vi.fn(async () => {});
    device({ coarse: true, share: abortAfter(300), writeText });

    expect(await shareResult(CONTENT)).toBe("cancelled");
    expect(writeText).not.toHaveBeenCalled();
  });

  it("uses the native sheet on touch when it works", async () => {
    const share = vi.fn(async () => {});
    device({ coarse: true, share });

    expect(await shareResult(CONTENT)).toBe("shared");
    expect(share).toHaveBeenCalledWith({ text: CONTENT.text, url: CONTENT.url });
  });

  it("falls back to the clipboard on any non-abort share failure", async () => {
    const writeText = vi.fn(async () => {});
    device({
      coarse: true,
      share: async () => {
        const e = new Error("not allowed");
        e.name = "NotAllowedError";
        throw e;
      },
      writeText,
    });

    expect(await shareResult(CONTENT)).toBe("copied");
    expect(writeText).toHaveBeenCalledOnce();
  });

  it("reports failure only when the clipboard is unavailable too", async () => {
    device({
      coarse: false,
      writeText: async () => {
        throw new Error("denied");
      },
    });

    expect(await shareResult(CONTENT)).toBe("failed");
  });

  it("sends the challenge link as a structured url, not buried in the text", async () => {
    const share = vi.fn(async (_data: unknown) => {});
    device({ coarse: true, share });
    await shareResult(CONTENT);
    expect(share.mock.calls[0]?.[0]).toMatchObject({ url: CONTENT.url });
  });
});
