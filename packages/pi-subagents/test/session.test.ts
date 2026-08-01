import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  appendBoundaryEntry,
  generateChildSessionFile,
  seedForkSession,
} from "../src/lib/session.js";
import type { AgentConfig } from "../src/lib/types.js";
import { withAgentDir } from "./_helpers.js";

const baseAgent: AgentConfig = {
  name: "test-agent",
};

function makeParentSession(
  dir: string,
  messages: Array<{ role: "user" | "assistant"; text: string }> = [],
): string {
  const path = join(dir, "parent.jsonl");
  const header = {
    type: "session",
    version: 3,
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    cwd: "/tmp/test-project",
  };

  const entries = messages.map((msg, i) => ({
    type: "message",
    id: randomUUID().replace(/-/g, "").slice(0, 8),
    parentId: i === 0 ? null : `entry-${i - 1}`,
    timestamp: new Date().toISOString(),
    message: {
      role: msg.role,
      content: [{ type: "text", text: msg.text }],
    },
  }));

  // Fix parentId references
  for (let i = 1; i < entries.length; i++) {
    entries[i]!.parentId = entries[i - 1]!.id;
  }

  writeFileSync(
    path,
    `${[JSON.stringify(header), ...entries.map((e) => JSON.stringify(e))].join(
      "\n",
    )}\n`,
    "utf8",
  );
  return path;
}

// ---------------------------------------------------------------------------
// generateChildSessionFile
// ---------------------------------------------------------------------------

describe("generateChildSessionFile", () => {
  it("returns a path under the agent sessions dir", () => {
    withAgentDir((dir) => {
      const path = generateChildSessionFile("abc-123");
      expect(path).toContain(join(dir, "sessions", "pi-subagents"));
      expect(path).toMatch(/\.jsonl$/);
      expect(path).toContain("abc-123");
    });
  });

  it("creates the directory if it does not exist", () => {
    withAgentDir(() => {
      const path = generateChildSessionFile("abc-123");
      expect(existsSync(dirname(path))).toBe(true);
    });
  });

  it("returns unique paths for different session ids", () => {
    withAgentDir(() => {
      const a = generateChildSessionFile("abc-123");
      const b = generateChildSessionFile("def-456");
      expect(a).not.toBe(b);
    });
  });
});

// ---------------------------------------------------------------------------
// seedForkSession
// ---------------------------------------------------------------------------

describe("seedForkSession", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "pi-subagents-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("creates child session with the given id in header", () => {
    const parent = makeParentSession(tmpDir, [
      { role: "user", text: "hello" },
      { role: "assistant", text: "hi there" },
    ]);
    const child = join(tmpDir, "child.jsonl");

    seedForkSession(parent, child, baseAgent, "/tmp/test-project", "abc-123");

    expect(existsSync(child)).toBe(true);
    const content = readFileSync(child, "utf8");
    const lines = content.trim().split("\n").filter(Boolean);

    // First line is header with the shared session id
    const firstLine = lines[0];
    if (!firstLine) {
      throw new Error("expected first line");
    }
    const header = JSON.parse(firstLine);
    expect(header.type).toBe("session");
    expect(header.version).toBe(3);
    const parentFirstLine = readFileSync(parent, "utf8").split("\n")[0];
    if (!parentFirstLine) {
      throw new Error("expected parent first line");
    }
    expect(header.id).toBe("abc-123");
    expect(header.id).not.toBe(JSON.parse(parentFirstLine).id);
    expect(header.parentSession).toBe(parent);
    expect(header.cwd).toBe("/tmp/test-project");
  });

  it("replicates parent branch entries", () => {
    const parent = makeParentSession(tmpDir, [
      { role: "user", text: "hello" },
      { role: "assistant", text: "hi there" },
    ]);
    const child = join(tmpDir, "child.jsonl");

    seedForkSession(parent, child, baseAgent, "/tmp/test-project", "abc-123");

    const content = readFileSync(child, "utf8");
    const lines = content.trim().split("\n").filter(Boolean);

    // Lines 1-N should be the parent entries (skip header = line 0)
    const messageLines = lines.filter((l) => {
      const e = JSON.parse(l);
      return e.type === "message";
    });
    expect(messageLines.length).toBe(2);
  });

  it("appends boundary marker with correct fields", () => {
    const parent = makeParentSession(tmpDir, [{ role: "user", text: "hello" }]);
    const child = join(tmpDir, "child.jsonl");

    seedForkSession(parent, child, baseAgent, "/tmp/test-project", "abc-123");

    const content = readFileSync(child, "utf8");
    const lines = content.trim().split("\n");

    // Find boundary entry
    const boundaryLine = lines.find((l) => {
      const e = JSON.parse(l);
      return e.customType === "background_boundary";
    });
    if (!boundaryLine) {
      throw new Error("expected boundary line");
    }
    const boundary = JSON.parse(boundaryLine);
    expect(boundary.type).toBe("custom_message");
    expect(boundary.display).toBe(false);
    expect(boundary.content).toContain("Background context");
    expect(boundary.details.name).toBe("test-agent");
  });

  it("handles empty parent session (no entries)", () => {
    const parent = makeParentSession(tmpDir, []);
    const child = join(tmpDir, "child.jsonl");

    seedForkSession(parent, child, baseAgent, "/tmp/test-project", "abc-123");

    expect(existsSync(child)).toBe(true);
    const content = readFileSync(child, "utf8");
    const lines = content.trim().split("\n").filter(Boolean);
    // Just header (no message entries)
    expect(lines.length).toBeGreaterThanOrEqual(1);
    const firstLine = lines[0];
    if (!firstLine) {
      throw new Error("expected first line");
    }
    const header = JSON.parse(firstLine);
    expect(header.type).toBe("session");
    expect(header.parentSession).toBe(parent);
  });
});

// ---------------------------------------------------------------------------
// appendBoundaryEntry
// ---------------------------------------------------------------------------

describe("appendBoundaryEntry", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "pi-subagents-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("appends a custom_message entry with background_boundary type", () => {
    const path = join(tmpDir, "session.jsonl");
    writeFileSync(
      path,
      `${JSON.stringify({
        type: "session",
        version: 3,
        id: randomUUID(),
        timestamp: new Date().toISOString(),
        cwd: "/tmp",
      })}\n`,
      "utf8",
    );

    appendBoundaryEntry(path, "my-agent");

    const content = readFileSync(path, "utf8");
    const lines = content.trim().split("\n");
    expect(lines.length).toBe(2);

    const secondLine = lines[1];
    if (!secondLine) {
      throw new Error("expected second line");
    }
    const boundary = JSON.parse(secondLine);
    expect(boundary.type).toBe("custom_message");
    expect(boundary.customType).toBe("background_boundary");
    expect(boundary.display).toBe(false);
    expect(boundary.details.name).toBe("my-agent");
  });
});
