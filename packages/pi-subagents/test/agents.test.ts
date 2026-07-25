import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  discoverAgentFiles,
  discoverAgents,
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

  it("rejects nested objects in frontmatter values", () => {
    const content = "---\nname: ok\nnested:\n  key: value\n---\nbody";
    const result = parseFrontmatter(content, "nested.md");

    expect(result.frontmatter).not.toBeNull();
    expect(result.frontmatter).toEqual({ name: "ok" });
    // nested key should be skipped with warning
    expect(result.frontmatter!.nested).toBeUndefined();
  });

  it("handles null values as empty string", () => {
    const content = "---\nname: ok\nempty: null\n---\nbody";
    const result = parseFrontmatter(content, "nullval.md");

    expect(result.frontmatter).not.toBeNull();
    expect(result.frontmatter).toEqual({ name: "ok", empty: "" });
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

  it("rejects tiers when it is an array", () => {
    const dir = tempDir();
    try {
      writeConfig(dir, { tiers: ["bad"] });
      const config = loadSubagentConfig(dir);
      expect(config.tiers).toEqual({});
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it("rejects tiers when it is a string", () => {
    const dir = tempDir();
    try {
      writeConfig(dir, { tiers: "not-an-object" });
      const config = loadSubagentConfig(dir);
      expect(config.tiers).toEqual({});
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it("rejects stuckTimeoutMs when it is a string", () => {
    const dir = tempDir();
    try {
      writeConfig(dir, { stuckTimeoutMs: "120000" });
      const config = loadSubagentConfig(dir);
      expect(config.stuckTimeoutMs).toBe(60_000);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it("filters non-string tier values", () => {
    const dir = tempDir();
    try {
      writeConfig(dir, {
        tiers: {
          cheap: "google/gemini-2.5-flash",
          bad: 123,
        },
      });
      const config = loadSubagentConfig(dir);
      expect(config.tiers).toEqual({ cheap: "google/gemini-2.5-flash" });
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

describe("discoverAgentFiles", () => {
  function makeDir(): string {
    const dir = mkdtempSync(join(tmpdir(), "pi-subagents-test-"));
    return dir;
  }

  function writeFile(dir: string, name: string, content: string): void {
    writeFileSync(join(dir, name), content, "utf-8");
  }

  it("discovers user and project agents, project overrides user", () => {
    const userDir = makeDir();
    const cwd = makeDir();
    try {
      writeFile(userDir, "foo.md", "---\nname: user-foo\n---");
      writeFile(userDir, "bar.md", "---\nname: user-bar\n---");
      writeFile(userDir, "not-an-agent.txt", "plain text");

      const projectAgentDir = join(cwd, ".pi", "agents");
      mkdirSync(projectAgentDir, { recursive: true });
      writeFile(projectAgentDir, "bar.md", "---\nname: project-bar\n---");
      writeFile(projectAgentDir, "baz.md", "---\nname: project-baz\n---");

      const result = discoverAgentFiles(cwd, userDir);

      expect(result.size).toBe(3);
      expect(result.get("foo")).toBe(join(userDir, "foo.md"));
      expect(result.get("bar")).toBe(join(projectAgentDir, "bar.md"));
      expect(result.get("baz")).toBe(join(projectAgentDir, "baz.md"));
    } finally {
      rmSync(userDir, { recursive: true });
      rmSync(cwd, { recursive: true });
    }
  });

  it("returns empty map when neither directory exists", () => {
    const cwd = makeDir();
    const userDir = makeDir();
    try {
      const result = discoverAgentFiles(cwd, userDir);
      expect(result.size).toBe(0);
    } finally {
      rmSync(cwd, { recursive: true });
      rmSync(userDir, { recursive: true });
    }
  });

  it("ignores non-.md files", () => {
    const userDir = makeDir();
    const cwd = makeDir();
    try {
      writeFile(userDir, "agent.md", "---\nname: x\n---");
      writeFile(userDir, "README.txt", "docs");
      writeFile(userDir, ".hidden.md.swp", "vim junk");

      const result = discoverAgentFiles(cwd, userDir);

      expect(result.size).toBe(1);
      expect(result.get("agent")).toBe(join(userDir, "agent.md"));
    } finally {
      rmSync(userDir, { recursive: true });
      rmSync(cwd, { recursive: true });
    }
  });

  it("returns only user agents when project dir is missing", () => {
    const userDir = makeDir();
    const cwd = makeDir();
    try {
      writeFile(userDir, "foo.md", "---\nname: foo\n---");

      const result = discoverAgentFiles(cwd, userDir);

      expect(result.size).toBe(1);
      expect(result.get("foo")).toBe(join(userDir, "foo.md"));
    } finally {
      rmSync(userDir, { recursive: true });
      rmSync(cwd, { recursive: true });
    }
  });

  it("returns only project agents when user dir is missing", () => {
    const cwd = makeDir();
    const userDir = makeDir(); // exists but empty
    try {
      const projectAgentDir = join(cwd, ".pi", "agents");
      mkdirSync(projectAgentDir, { recursive: true });
      writeFile(projectAgentDir, "proj.md", "---\nname: proj\n---");

      const result = discoverAgentFiles(cwd, userDir);

      expect(result.size).toBe(1);
      expect(result.get("proj")).toBe(join(projectAgentDir, "proj.md"));
    } finally {
      rmSync(userDir, { recursive: true });
      rmSync(cwd, { recursive: true });
    }
  });
});

describe("discoverAgents", () => {
  function makeDir(): string {
    return mkdtempSync(join(tmpdir(), "pi-subagents-test-"));
  }

  function writeFile(dir: string, name: string, content: string): void {
    writeFileSync(join(dir, name), content, "utf-8");
  }

  it("parses valid agent files end-to-end", () => {
    const userDir = makeDir();
    const cwd = makeDir();
    try {
      writeFile(
        userDir,
        "researcher.md",
        "---\nname: researcher\nmodel: cheap\ntools: read,grep\n---\nYou are a researcher.",
      );
      writeFile(
        userDir,
        "implementer.md",
        "---\nname: implementer\nmodel: expensive\ntools: read,edit,bash\nmode: fork\nsandbox: true\n---\nYou are an implementer.",
      );
      writeFile(
        userDir,
        "subagents.json",
        JSON.stringify({
          tiers: {
            cheap: "google/gemini-2.5-flash",
            expensive: "bedrock/us.anthropic.claude-opus-4-8",
          },
        }),
      );

      const agents = discoverAgents(cwd, userDir, userDir);

      expect(agents).toHaveLength(2);
      // Sorted alphabetically by name
      expect(agents[0]!.name).toBe("implementer");
      expect(agents[1]!.name).toBe("researcher");

      // implementer
      expect(agents[0]!.model).toBe("bedrock/us.anthropic.claude-opus-4-8");
      expect(agents[0]!.tools).toEqual(["read", "edit", "bash"]);
      expect(agents[0]!.mode).toBe("fork");
      expect(agents[0]!.sandbox).toBe(true);
      expect(agents[0]!.body).toBe("You are an implementer.");

      // researcher
      expect(agents[1]!.model).toBe("google/gemini-2.5-flash");
      expect(agents[1]!.tools).toEqual(["read", "grep"]);
      expect(agents[1]!.mode).toBe("clean");
      expect(agents[1]!.body).toBe("You are a researcher.");
    } finally {
      rmSync(userDir, { recursive: true });
      rmSync(cwd, { recursive: true });
    }
  });

  it("returns empty array when no agent files exist", () => {
    const userDir = makeDir();
    const cwd = makeDir();
    try {
      const agents = discoverAgents(cwd, userDir, userDir);
      expect(agents).toEqual([]);
    } finally {
      rmSync(userDir, { recursive: true });
      rmSync(cwd, { recursive: true });
    }
  });

  it("skips broken files without crashing", () => {
    const userDir = makeDir();
    const cwd = makeDir();
    try {
      writeFile(userDir, "valid.md", "---\nname: valid\nmodel: cheap\n---\nok");
      writeFile(
        userDir,
        "no-model.md",
        "---\nname: broken\n---\nno model field",
      );
      writeFile(userDir, "not-agent.md", "just markdown, no frontmatter");
      writeFile(
        userDir,
        "subagents.json",
        JSON.stringify({ tiers: { cheap: "google/gemini-2.5-flash" } }),
      );

      const agents = discoverAgents(cwd, userDir, userDir);

      expect(agents).toHaveLength(1);
      expect(agents[0]!.name).toBe("valid");
    } finally {
      rmSync(userDir, { recursive: true });
      rmSync(cwd, { recursive: true });
    }
  });

  it("project agent overrides user agent with same name", () => {
    const userDir = makeDir();
    const cwd = makeDir();
    try {
      writeFile(
        userDir,
        "worker.md",
        "---\nname: user-worker\nmodel: cheap\n---\nuser version",
      );
      writeFile(
        userDir,
        "subagents.json",
        JSON.stringify({ tiers: { cheap: "google/gemini-2.5-flash" } }),
      );

      const projectAgentDir = join(cwd, ".pi", "agents");
      mkdirSync(projectAgentDir, { recursive: true });
      writeFile(
        projectAgentDir,
        "worker.md",
        "---\nname: project-worker\nmodel: cheap\n---\nproject version",
      );

      const agents = discoverAgents(cwd, userDir, userDir);

      expect(agents).toHaveLength(1);
      expect(agents[0]!.name).toBe("project-worker");
      expect(agents[0]!.body).toBe("project version");
    } finally {
      rmSync(userDir, { recursive: true });
      rmSync(cwd, { recursive: true });
    }
  });

  it("deduplicates by resolved name, not filename stem", () => {
    const userDir = makeDir();
    const cwd = makeDir();
    try {
      // Same name in frontmatter, different filenames
      writeFile(
        userDir,
        "alpha.md",
        "---\nname: same\nmodel: cheap\n---\nalpha file",
      );
      writeFile(
        userDir,
        "beta.md",
        "---\nname: same\nmodel: cheap\n---\nbeta file",
      );
      writeFile(
        userDir,
        "subagents.json",
        JSON.stringify({ tiers: { cheap: "google/gemini-2.5-flash" } }),
      );

      const agents = discoverAgents(cwd, userDir, userDir);

      expect(agents).toHaveLength(1);
      expect(agents[0]!.name).toBe("same");
      // beta.md loaded after alpha.md, so it wins
      expect(agents[0]!.body).toBe("beta file");
    } finally {
      rmSync(userDir, { recursive: true });
      rmSync(cwd, { recursive: true });
    }
  });
});
