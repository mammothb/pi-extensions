import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  parseFrontmatter,
  resolveModel,
  validateConfig,
} from "../src/lib/agents.js";
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

describe("validateConfig", () => {
  it("applies all defaults when only model is set", () => {
    const config = validateConfig(
      { model: "cheap" },
      "You are a test agent.\n",
      "test-agent.md",
    );

    expect(config).not.toBeNull();
    expect(config).toEqual({
      name: "test-agent",
      description: "",
      model: "cheap",
      thinking: "",
      tools: [],
      mode: "clean",
      sandbox: false,
      noSession: true,
      body: "You are a test agent.",
    });
  });

  it("returns null when model is missing", () => {
    const config = validateConfig({ name: "foo" }, "body", "foo.md");

    expect(config).toBeNull();
  });

  it("defaults invalid mode to clean with warning", () => {
    const config = validateConfig(
      { model: "cheap", mode: "parallel" },
      "body",
      "bad-mode.md",
    );

    expect(config).not.toBeNull();
    expect(config!.mode).toBe("clean");
  });

  it("parses tools string into array", () => {
    const config = validateConfig(
      { model: "cheap", tools: "read,  edit , bash" },
      "body",
      "agent.md",
    );

    expect(config).not.toBeNull();
    expect(config!.tools).toEqual(["read", "edit", "bash"]);
  });

  it("sets noSession to false when no-session: false", () => {
    const config = validateConfig(
      { model: "cheap", "no-session": "false" },
      "body",
      "agent.md",
    );

    expect(config).not.toBeNull();
    expect(config!.noSession).toBe(false);
  });

  it("falls back to filename stem when name is missing", () => {
    const config = validateConfig(
      { model: "cheap" },
      "body",
      "my-custom-agent.md",
    );

    expect(config).not.toBeNull();
    expect(config!.name).toBe("my-custom-agent");
  });

  it("uses frontmatter name over filename stem", () => {
    const config = validateConfig(
      { model: "cheap", name: "explicit-name" },
      "body",
      "filename.md",
    );

    expect(config).not.toBeNull();
    expect(config!.name).toBe("explicit-name");
  });

  it("parses sandbox boolean from string", () => {
    const config = validateConfig(
      { model: "cheap", sandbox: "true" },
      "body",
      "agent.md",
    );

    expect(config).not.toBeNull();
    expect(config!.sandbox).toBe(true);
  });

  it("accepts fork mode", () => {
    const config = validateConfig(
      { model: "cheap", mode: "fork" },
      "body",
      "agent.md",
    );

    expect(config).not.toBeNull();
    expect(config!.mode).toBe("fork");
  });

  it("trims body whitespace", () => {
    const config = validateConfig(
      { model: "cheap" },
      "  line one\nline two  \n",
      "agent.md",
    );

    expect(config).not.toBeNull();
    expect(config!.body).toBe("line one\nline two");
  });
});

describe("resolveModel", () => {
  it("resolves tier alias to provider/model", () => {
    const tiers = { cheap: "google/gemini-2.5-flash" };
    expect(resolveModel("cheap", tiers)).toBe("google/gemini-2.5-flash");
  });

  it("passes through direct provider/model unchanged", () => {
    const tiers = { cheap: "google/gemini-2.5-flash" };
    expect(resolveModel("bedrock/us.anthropic.claude-sonnet-4-5", tiers)).toBe(
      "bedrock/us.anthropic.claude-sonnet-4-5",
    );
  });

  it("passes through when tiers is empty", () => {
    expect(resolveModel("cheap", {})).toBe("cheap");
  });

  it("passes through when alias not found in tiers", () => {
    const tiers = { expensive: "bedrock/us.anthropic.claude-opus-4-8" };
    expect(resolveModel("cheap", tiers)).toBe("cheap");
  });

  it("does not recursively resolve tier values", () => {
    const tiers = {
      cheap: "balanced",
      balanced: "bedrock/us.anthropic.claude-sonnet-4-5",
    };
    expect(resolveModel("cheap", tiers)).toBe("balanced");
  });
});
