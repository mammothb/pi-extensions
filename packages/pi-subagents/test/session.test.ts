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
  appendLaunchMetadataEntry,
  appendModelStateEntries,
  generateChildSessionFile,
  readLaunchMetadata,
  seedForkSession,
} from "../src/lib/session.js";
import type { AgentConfig } from "../src/lib/types.js";

const baseAgent: AgentConfig = {
  name: "test-agent",
  description: "",
  model: "google/gemini-2.5-flash",
  thinking: "low",
  tools: ["read", "edit"],
  mode: "clean",
  sandbox: false,
  noSession: true,
  body: "",
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
  it("returns a path under the given session dir", () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-subagents-test-"));
    try {
      const path = generateChildSessionFile(dir);
      expect(path).toContain(dir);
      expect(path).toMatch(/\.jsonl$/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("creates the directory if it does not exist", () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-subagents-test-"));
    const subDir = join(dir, "nested");
    try {
      const path = generateChildSessionFile(subDir);
      expect(existsSync(dirname(path))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns unique paths", () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-subagents-test-"));
    try {
      const a = generateChildSessionFile(dir);
      const b = generateChildSessionFile(dir);
      expect(a).not.toBe(b);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
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

  it("creates child session with new UUID in header", () => {
    const parent = makeParentSession(tmpDir, [
      { role: "user", text: "hello" },
      { role: "assistant", text: "hi there" },
    ]);
    const child = join(tmpDir, "child.jsonl");

    seedForkSession(parent, child, baseAgent, "/tmp/test-project");

    expect(existsSync(child)).toBe(true);
    const content = readFileSync(child, "utf8");
    const lines = content.trim().split("\n").filter(Boolean);

    // First line is header with new UUID
    const header = JSON.parse(lines[0]!);
    expect(header.type).toBe("session");
    expect(header.version).toBe(3);
    expect(header.id).not.toBe(
      JSON.parse(readFileSync(parent, "utf8").split("\n")[0]!).id,
    );
    expect(header.parentSession).toBe(parent);
    expect(header.cwd).toBe("/tmp/test-project");
  });

  it("replicates parent branch entries", () => {
    const parent = makeParentSession(tmpDir, [
      { role: "user", text: "hello" },
      { role: "assistant", text: "hi there" },
    ]);
    const child = join(tmpDir, "child.jsonl");

    seedForkSession(parent, child, baseAgent, "/tmp/test-project");

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

    seedForkSession(parent, child, baseAgent, "/tmp/test-project");

    const content = readFileSync(child, "utf8");
    const lines = content.trim().split("\n");

    // Find boundary entry
    const boundaryLine = lines.find((l) => {
      const e = JSON.parse(l);
      return e.customType === "subagent_boundary";
    });
    expect(boundaryLine).toBeDefined();

    const boundary = JSON.parse(boundaryLine!);
    expect(boundary.type).toBe("custom_message");
    expect(boundary.display).toBe(false);
    expect(boundary.content).toContain("Background context");
    expect(boundary.details.name).toBe("test-agent");
  });

  it("appends model_change entry when agent has model", () => {
    const parent = makeParentSession(tmpDir, [{ role: "user", text: "hello" }]);
    const child = join(tmpDir, "child.jsonl");

    seedForkSession(parent, child, baseAgent, "/tmp/test-project");

    const content = readFileSync(child, "utf8");
    const hasModelChange = content.split("\n").some((l) => {
      try {
        return JSON.parse(l).type === "model_change";
      } catch {
        return false;
      }
    });
    expect(hasModelChange).toBe(true);
  });

  it("appends thinking_level_change entry when agent has thinking", () => {
    const parent = makeParentSession(tmpDir, [{ role: "user", text: "hello" }]);
    const child = join(tmpDir, "child.jsonl");

    seedForkSession(parent, child, baseAgent, "/tmp/test-project");

    const content = readFileSync(child, "utf8");
    const hasThinking = content.split("\n").some((l) => {
      try {
        return JSON.parse(l).type === "thinking_level_change";
      } catch {
        return false;
      }
    });
    expect(hasThinking).toBe(true);
  });

  it("handles empty parent session (no entries)", () => {
    const parent = makeParentSession(tmpDir, []);
    const child = join(tmpDir, "child.jsonl");

    seedForkSession(parent, child, baseAgent, "/tmp/test-project");

    expect(existsSync(child)).toBe(true);
    const content = readFileSync(child, "utf8");
    const lines = content.trim().split("\n").filter(Boolean);
    // Just header (no message entries)
    expect(lines.length).toBeGreaterThanOrEqual(1);
    const header = JSON.parse(lines[0]!);
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

  it("appends a custom_message entry with subagent_boundary type", () => {
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

    const boundary = JSON.parse(lines[1]!);
    expect(boundary.type).toBe("custom_message");
    expect(boundary.customType).toBe("subagent_boundary");
    expect(boundary.display).toBe(false);
    expect(boundary.details.name).toBe("my-agent");
  });
});

// ---------------------------------------------------------------------------
// appendModelStateEntries
// ---------------------------------------------------------------------------

describe("appendModelStateEntries", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "pi-subagents-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("appends model_change entry", () => {
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

    appendModelStateEntries(path, baseAgent);

    const content = readFileSync(path, "utf8");
    const hasModel = content.split("\n").some((l) => {
      try {
        return JSON.parse(l).type === "model_change";
      } catch {
        return false;
      }
    });
    expect(hasModel).toBe(true);
  });

  it("appends thinking_level_change entry", () => {
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

    appendModelStateEntries(path, baseAgent);

    const content = readFileSync(path, "utf8");
    const hasThinking = content.split("\n").some((l) => {
      try {
        return JSON.parse(l).type === "thinking_level_change";
      } catch {
        return false;
      }
    });
    expect(hasThinking).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// appendLaunchMetadataEntry + readLaunchMetadata round-trip
// ---------------------------------------------------------------------------

describe("launch metadata round-trip", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "pi-subagents-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("writes and reads back launch metadata", () => {
    const path = join(tmpDir, "session.jsonl");
    writeFileSync(
      path,
      `${JSON.stringify({
        type: "session",
        version: 3,
        id: randomUUID(),
        timestamp: new Date().toISOString(),
        cwd: "/tmp/test-project",
      })}\n`,
      "utf8",
    );

    appendLaunchMetadataEntry(path, baseAgent, "/tmp/test-project");

    const metadata = readLaunchMetadata(path);
    expect(metadata).toBeDefined();
    expect(metadata!.version).toBe(1);
    expect(metadata!.name).toBe("test-agent");
    expect(metadata!.model).toBe("google/gemini-2.5-flash");
    expect(metadata!.thinking).toBe("low");
    expect(metadata!.tools).toEqual(["read", "edit"]);
    expect(metadata!.mode).toBe("clean");
    expect(metadata!.sandbox).toBe(false);
    expect(metadata!.noSession).toBe(true);
    expect(metadata!.cwd).toBe("/tmp/test-project");
  });

  it("returns undefined when no metadata entry exists", () => {
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

    const metadata = readLaunchMetadata(path);
    expect(metadata).toBeUndefined();
  });

  it("rejects metadata entry with version not equal to 1", () => {
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

    // Append entry with version 99
    const parentId = (() => {
      const content = readFileSync(path, "utf8");
      const entries = content.trim().split("\n").filter(Boolean);
      return JSON.parse(entries[0]!).id;
    })();
    writeFileSync(
      path,
      `${JSON.stringify({
        type: "custom",
        customType: "pi-subagents_launch_metadata",
        data: { version: 99, name: "old" },
        id: randomUUID().replace(/-/g, "").slice(0, 8),
        parentId,
        timestamp: new Date().toISOString(),
      })}\n`,
      "utf8",
    );

    const metadata = readLaunchMetadata(path);
    expect(metadata).toBeUndefined();
  });

  it("returns most recent metadata when multiple entries exist", () => {
    const path = join(tmpDir, "session.jsonl");
    // Create header
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

    // Append first metadata entry (older config)
    const oldAgent: AgentConfig = {
      ...baseAgent,
      thinking: "low",
      tools: ["read"],
    };
    appendLaunchMetadataEntry(path, oldAgent, "/tmp");

    // Append second metadata entry (newer config)
    const newAgent: AgentConfig = {
      ...baseAgent,
      thinking: "high",
      tools: ["read", "edit", "bash"],
    };
    appendLaunchMetadataEntry(path, newAgent, "/tmp");

    const metadata = readLaunchMetadata(path);
    expect(metadata).toBeDefined();
    // Should return the most recent (last written)
    expect(metadata!.thinking).toBe("high");
    expect(metadata!.tools).toEqual(["read", "edit", "bash"]);
  });
});
