/**
 * Unit tests for MismatchError and its displayMessage rendering.
 */
import { describe, expect, it } from "vitest";
import { MismatchError } from "../../../src/lib/hashline/mismatch.js";

// ─── Helpers ──────────────────────────────────────────────────────────

function makeFileLines(...lines: string[]): string[] {
  return lines;
}

// ─── MismatchError construction ───────────────────────────────────────

describe("MismatchError construction", () => {
  it("sets name to MismatchError", () => {
    const err = new MismatchError({
      path: "foo.ts",
      expectedFileHash: "A1B200",
      actualFileHash: "C3D400",
      fileLines: ["line1", "line2"],
      anchorLines: [1],
    });
    expect(err.name).toBe("MismatchError");
    expect(err).toBeInstanceOf(Error);
  });

  it("defaults anchorLines to empty array", () => {
    const err = new MismatchError({
      expectedFileHash: "A1B200",
      actualFileHash: "C3D400",
      fileLines: ["line1", "line2"],
    });
    expect(err.anchorLines).toEqual([]);
  });

  it("defaults hashRecognized to true", () => {
    const err = new MismatchError({
      expectedFileHash: "A1B200",
      actualFileHash: "C3D400",
      fileLines: ["line1"],
    });
    expect(err.hashRecognized).toBe(true);
  });

  it("accepts explicit hashRecognized: false", () => {
    const err = new MismatchError({
      expectedFileHash: "A1B200",
      actualFileHash: "C3D400",
      fileLines: ["line1"],
      hashRecognized: false,
    });
    expect(err.hashRecognized).toBe(false);
  });
});

// ─── rejectionHeader ──────────────────────────────────────────────────

describe("rejectionHeader", () => {
  it("hashRecognized: true — mentions drift", () => {
    const header = MismatchError.rejectionHeader({
      path: "src/foo.ts",
      expectedFileHash: "A1B200",
      actualFileHash: "C3D400",
      fileLines: [],
      hashRecognized: true,
    });
    expect(header).toHaveLength(2);
    expect(header[0]).toMatch(/Edit rejected for src\/foo\.ts/);
    expect(header[0]).toMatch(/file changed between read and edit/);
    expect(header[1]).toMatch(/#A1B200/);
    expect(header[1]).toMatch(/#C3D400/);
    expect(header[1]).toMatch(/copy the ¶path#newhash header/);
  });

  it("hashRecognized: false — mentions fabricated hash", () => {
    const header = MismatchError.rejectionHeader({
      expectedFileHash: "FFFF00",
      actualFileHash: "A1B200",
      fileLines: [],
      hashRecognized: false,
    });
    expect(header).toHaveLength(2);
    expect(header[0]).toMatch(/Edit rejected/);
    expect(header[0]).toMatch(/hash #FFFF00 is not from this session/);
    expect(header[1]).toMatch(/never invent the tag/);
  });

  it("hashRecognized: undefined — defaults to true", () => {
    const header = MismatchError.rejectionHeader({
      expectedFileHash: "A1B200",
      actualFileHash: "C3D400",
      fileLines: [],
    });
    expect(header[0]).toMatch(/file changed between read and edit/);
    expect(header[0]).not.toMatch(/not from this session/);
  });

  it("omits path text when path is undefined", () => {
    const header = MismatchError.rejectionHeader({
      expectedFileHash: "A1B200",
      actualFileHash: "C3D400",
      fileLines: [],
    });
    expect(header[0]).toMatch(/^Edit rejected: /);
    expect(header[0]).not.toMatch(/ for /);
  });
});

// ─── formatMessage / displayMessage — anchor context ──────────────────
describe("formatMessage / displayMessage", () => {
  it("renders anchor lines with * markers", () => {
    const err = new MismatchError({
      path: "file.ts",
      expectedFileHash: "A1B200",
      actualFileHash: "C3D400",
      fileLines: makeFileLines(
        "a",
        "b",
        "c",
        "d",
        "e",
        "f",
        "g",
        "h",
        "i",
        "j",
      ),
      anchorLines: [3, 6, 9],
    });

    const msg = err.displayMessage;

    // Should have rejection header.
    expect(msg).toMatch(/Edit rejected for file\.ts/);
    expect(msg).toMatch(/file changed between read and edit/);

    // Should show anchor lines with * markers and hash prefixes.
    expect(msg).toMatch(/\*[0-9a-f]{4}│c/);
    expect(msg).toMatch(/\*[0-9a-f]{4}│f/);
    expect(msg).toMatch(/\*[0-9a-f]{4}│i/);

    // Should show context lines with space marker and hash prefixes.
    expect(msg).toMatch(/ [0-9a-f]{4}│a/);
    expect(msg).toMatch(/ [0-9a-f]{4}│e/);
    // All lines 1–10 covered by overlapping context windows — no ellipsis gaps.
    expect(msg).not.toMatch(/\.\.\./);
  });

  it("no anchor context when anchorLines is empty", () => {
    const err = new MismatchError({
      path: "empty.ts",
      expectedFileHash: "A1B200",
      actualFileHash: "C3D400",
      fileLines: makeFileLines("a", "b", "c"),
      anchorLines: [],
    });

    const msg = err.displayMessage;
    expect(msg).toMatch(/Edit rejected for empty\.ts/);
    // No anchor context — no hash-anchored lines after the header block.
    const afterHeader = msg.split("\n\n")[1];
    expect(afterHeader).toBeUndefined();
  });

  it("anchor at start of file shows lines 1..3", () => {
    const err = new MismatchError({
      path: "top.ts",
      expectedFileHash: "A1B200",
      actualFileHash: "C3D400",
      fileLines: makeFileLines("line1", "line2", "line3", "line4", "line5"),
      anchorLines: [1],
    });

    const msg = err.displayMessage;
    expect(msg).toMatch(/\*[0-9a-f]{4}│line1/);
    expect(msg).toMatch(/ [0-9a-f]{4}│line2/);
    expect(msg).toMatch(/ [0-9a-f]{4}│line3/);
    // Should not show line before 1 (no line 0).
    expect(msg).not.toMatch(/│line0/);
  });

  it("anchor at end of file shows last lines", () => {
    const err = new MismatchError({
      path: "end.ts",
      expectedFileHash: "A1B200",
      actualFileHash: "C3D400",
      fileLines: makeFileLines("a", "b", "c", "d", "e"),
      anchorLines: [5],
    });

    const msg = err.displayMessage;
    expect(msg).toMatch(/\*[0-9a-f]{4}│e/);
    expect(msg).toMatch(/ [0-9a-f]{4}│d/);
    expect(msg).toMatch(/ [0-9a-f]{4}│c/);
    // Should not show line after 5 (no line 6).
    expect(msg).not.toMatch(/│f/);
  });

  it("adjacent anchors merge context (no ...)", () => {
    const err = new MismatchError({
      path: "adj.ts",
      expectedFileHash: "A1B200",
      actualFileHash: "C3D400",
      fileLines: makeFileLines("a", "b", "c", "d", "e", "f", "g"),
      anchorLines: [3, 4], // adjacent: context windows overlap
    });

    const msg = err.displayMessage;
    // Lines 1..6 should appear without a "..." gap.
    expect(msg).toMatch(/ [0-9a-f]{4}│a/);
    expect(msg).toMatch(/\*[0-9a-f]{4}│c/);
    expect(msg).toMatch(/\*[0-9a-f]{4}│d/);
    expect(msg).toMatch(/ [0-9a-f]{4}│f/);
    expect(msg).not.toMatch(/\.\.\./);
  });

  it("out-of-bounds anchor lines are silently skipped", () => {
    const err = new MismatchError({
      path: "oob.ts",
      expectedFileHash: "A1B200",
      actualFileHash: "C3D400",
      fileLines: makeFileLines("a", "b", "c"),
      anchorLines: [2, 999, 0],
    });

    const msg = err.displayMessage;
    // Should show context around line 2 only.
    expect(msg).toMatch(/\*[0-9a-f]{4}│b/);
    expect(msg).toMatch(/ [0-9a-f]{4}│a/);
    expect(msg).toMatch(/ [0-9a-f]{4}│c/);
    // No reference to line 999 or line 0 content.
    expect(msg).not.toMatch(/999/);
  });

  it("message and displayMessage differ: message is formatMessage, displayMessage delegates", () => {
    const err = new MismatchError({
      path: "msg.ts",
      expectedFileHash: "A1B200",
      actualFileHash: "C3D400",
      fileLines: makeFileLines("a", "b", "c"),
      anchorLines: [],
    });

    // Both should produce the same output for now (formatDisplayMessage delegates to formatMessage).
    expect(err.message).toBe(err.displayMessage);
  });

  it("hashRecognized: false shows the fabricated-hash message in displayMessage", () => {
    const err = new MismatchError({
      path: "fake.ts",
      expectedFileHash: "FFFF00",
      actualFileHash: "A1B200",
      fileLines: makeFileLines("a", "b", "c"),
      anchorLines: [2],
      hashRecognized: false,
    });

    const msg = err.displayMessage;
    expect(msg).toMatch(/hash #FFFF00 is not from this session/);
    expect(msg).toMatch(/\*[0-9a-f]{4}│b/);
  });
});

// ─── MismatchError backwards compatibility (plain Error interface) ────

describe("MismatchError as plain Error", () => {
  it("can be caught as Error", () => {
    try {
      throw new MismatchError({
        expectedFileHash: "A1B200",
        actualFileHash: "C3D400",
        fileLines: [],
      });
    } catch (e) {
      expect(e).toBeInstanceOf(Error);
      expect(e).toBeInstanceOf(MismatchError);
    }
  });

  it("message contains the formatted diagnostic", () => {
    const err = new MismatchError({
      path: "test.ts",
      expectedFileHash: "A1B200",
      actualFileHash: "C3D400",
      fileLines: makeFileLines("a", "b", "c"),
      anchorLines: [2],
    });

    expect(err.message).toMatch(/Edit rejected/);
    expect(err.message).toMatch(/file changed/);
    expect(err.message).toMatch(/\*[0-9a-f]{4}│b/);
  });
});
