import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseFrontmatter } from "../src/lib/agents.js";
import { loadSubagentConfig } from "../src/lib/config.js";

const FIXTURES = join(__dirname, "fixtures", "agents");

function readFixture(name: string): string {
  return readFileSync(join(FIXTURES, name), "utf-8");
}

describe("parseFrontmatter", () => {
  it("parses valid frontmatter with all fields", () => {
    const content = readFixture("valid.md");
    const result = parseFrontmatter(content, "valid.md");

    expect(result.frontmatter).not.toBeNull();
    expect(result.frontmatter).toEqual({
      name: "researcher",
      model: "cheap",
      tools: "read,grep,find",
    });
    expect(result.body).toBe("You are a research agent.\n");
  });

  it("returns null frontmatter when file has no --- opener", () => {
    const content = readFixture("no-opener.md");
    const result = parseFrontmatter(content, "no-opener.md");

    expect(result.frontmatter).toBeNull();
    expect(result.body).toBe(content);
  });

  it("returns null frontmatter when --- is unclosed", () => {
    const content = readFixture("unclosed.md");
    const result = parseFrontmatter(content, "unclosed.md");

    expect(result.frontmatter).toBeNull();
    expect(result.body).toBe(content);
  });

  it("handles --- inside body text without false closing", () => {
    const content = readFixture("body-dashes.md");
    const result = parseFrontmatter(content, "body-dashes.md");

    expect(result.frontmatter).not.toBeNull();
    expect(result.frontmatter).toEqual({ name: "dashy" });
    // Body should include the second --- and everything after it
    expect(result.body).toContain("--- dashes ---");
    expect(result.body).toContain("just ---");
  });

  it("handles empty frontmatter block", () => {
    const content = readFixture("empty-frontmatter.md");
    const result = parseFrontmatter(content, "empty-frontmatter.md");

    expect(result.frontmatter).not.toBeNull();
    expect(result.frontmatter).toEqual({});
    expect(result.body).toBe("Body starts here.\n");
  });

  it("strips whitespace and quotes from values", () => {
    const content = readFixture("whitespace.md");
    const result = parseFrontmatter(content, "whitespace.md");

    expect(result.frontmatter).not.toBeNull();
    expect(result.frontmatter).toEqual({
      name: "quoted name",
      model: "provider/model",
      tools: "read,edit",
    });
    expect(result.body).toBe("Body text.\n");
  });

  it("handles inline frontmatter with no body", () => {
    const result = parseFrontmatter("---\nname: x\n---", "inline.md");

    expect(result.frontmatter).not.toBeNull();
    expect(result.frontmatter).toEqual({ name: "x" });
    expect(result.body).toBe("");
  });
});

describe("loadSubagentConfig", () => {
  function tempDir(): string {
    const dir = mkdtempSync(join(tmpdir(), "pi-subagents-test-"));
    return dir;
  }

  function writeConfig(dir: string, json: unknown): void {
    writeFileSync(join(dir, "subagents.json"), JSON.stringify(json), "utf-8");
  }

  it("returns defaults when config file is missing", () => {
    const dir = tempDir();
    try {
      const config = loadSubagentConfig(dir);
      expect(config).toEqual({ tiers: {}, stuckTimeoutMs: 60_000 });
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it("loads tiers from config", () => {
    const dir = tempDir();
    try {
      writeConfig(dir, {
        tiers: {
          cheap: "google/gemini-2.5-flash",
          expensive: "bedrock/us.anthropic.claude-sonnet-4-5",
        },
      });
      const config = loadSubagentConfig(dir);
      expect(config.tiers).toEqual({
        cheap: "google/gemini-2.5-flash",
        expensive: "bedrock/us.anthropic.claude-sonnet-4-5",
      });
      expect(config.stuckTimeoutMs).toBe(60_000); // default preserved
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it("loads stuckTimeoutMs from config", () => {
    const dir = tempDir();
    try {
      writeConfig(dir, { stuckTimeoutMs: 120_000 });
      const config = loadSubagentConfig(dir);
      expect(config.stuckTimeoutMs).toBe(120_000);
      expect(config.tiers).toEqual({}); // default preserved
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it("returns defaults for malformed JSON", () => {
    const dir = tempDir();
    try {
      writeFileSync(join(dir, "subagents.json"), "not json", "utf-8");
      const config = loadSubagentConfig(dir);
      expect(config).toEqual({ tiers: {}, stuckTimeoutMs: 60_000 });
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it("loads both tiers and stuckTimeoutMs together", () => {
    const dir = tempDir();
    try {
      writeConfig(dir, {
        tiers: { cheap: "google/gemini-2.5-flash" },
        stuckTimeoutMs: 90_000,
      });
      const config = loadSubagentConfig(dir);
      expect(config).toEqual({
        tiers: { cheap: "google/gemini-2.5-flash" },
        stuckTimeoutMs: 90_000,
      });
    } finally {
      rmSync(dir, { recursive: true });
    }
  });
});
