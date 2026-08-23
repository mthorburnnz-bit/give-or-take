import { describe, it, expect } from "vitest";
import { encodeToken, isValidTokenFormat, TOKEN_LENGTH, buildChallengePreview } from "./challenge.ts";

describe("encodeToken", () => {
  it("produces one character per input byte", () => {
    expect(encodeToken(new Uint8Array(TOKEN_LENGTH))).toHaveLength(TOKEN_LENGTH);
    expect(encodeToken(new Uint8Array(3))).toHaveLength(3);
  });

  it("maps deterministically, so the same bytes always give the same token", () => {
    const bytes = new Uint8Array([0, 1, 61, 62, 63, 200, 255, 128]);
    expect(encodeToken(bytes)).toBe(encodeToken(bytes));
  });

  it("wraps past the end of the alphabet rather than producing undefined", () => {
    // 62 and 63 exceed the alphabet's last index (61) and must wrap to 0/1.
    expect(encodeToken(new Uint8Array([0, 61, 62, 63]))).toBe("0z01");
  });

  it("only ever emits alphanumeric characters, so tokens stay URL-safe", () => {
    const allBytes = new Uint8Array(256);
    for (let i = 0; i < 256; i++) allBytes[i] = i;
    expect(encodeToken(allBytes)).toMatch(/^[0-9A-Za-z]+$/);
  });
});

describe("isValidTokenFormat", () => {
  it("accepts a well-formed token", () => {
    expect(isValidTokenFormat("aB3xY9z0")).toBe(true);
  });

  it("rejects wrong lengths", () => {
    expect(isValidTokenFormat("aB3xY9z")).toBe(false);
    expect(isValidTokenFormat("aB3xY9z00")).toBe(false);
    expect(isValidTokenFormat("")).toBe(false);
  });

  it("rejects characters outside the alphabet, including SQL/URL metacharacters", () => {
    expect(isValidTokenFormat("aB3xY9z'")).toBe(false);
    expect(isValidTokenFormat("aB3-Y9z0")).toBe(false);
    expect(isValidTokenFormat("aB3 Y9z0")).toBe(false);
  });
});

describe("buildChallengePreview", () => {
  it("names the challenger, the score and the puzzle", () => {
    const preview = buildChallengePreview("Mark", 246, 28);
    expect(preview.title).toBe("Mark scored 246 on Give or Take #28");
    expect(preview.description).toContain("Beat it in five questions");
  });

  it("leaves markup in a display name alone for the caller to escape", () => {
    // HTMLRewriter escapes for the attribute it writes into. Escaping here as
    // well would double-encode, and a player called O'Brien would see O&#39;Brien
    // in the preview of their own challenge.
    const preview = buildChallengePreview("<b>O'Brien</b>", 10, 1);
    expect(preview.title).toBe("<b>O'Brien</b> scored 10 on Give or Take #1");
  });
});
