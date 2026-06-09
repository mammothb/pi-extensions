import { describe, expect, it } from "vitest";
import { checkBash, checkPath, checkTool } from "../src/engine.js";
import type { ResolvedConfig } from "../src/lib/types.js";

const DEFAULTS = {
  tools: "ask" as const,
  bash: "ask" as const,
  paths: "ask" as const,
};

function config(overrides: Partial<ResolvedConfig> = {}): ResolvedConfig {
  return {
    defaults: { ...DEFAULTS },
    tools: {},
    paths: {},
    ...overrides,
  };
}

describe("checkTool", () => {
  it("returns allow when tool matches an allow rule", () => {
    const result = checkTool("read", config({ tools: { read: "allow" } }));
    expect(result.action).toBe("allow");
    expect(result.matchedRule).toBe("read");
  });

  it("returns deny when tool matches a deny rule", () => {
    const result = checkTool("write", config({ tools: { write: "deny" } }));
    expect(result.action).toBe("deny");
  });

  it("returns ask when no rule matches and default is ask", () => {
    const result = checkTool("unknown", config());
    expect(result.action).toBe("ask");
  });

  it("uses last-match-wins for wildcard vs exact", () => {
    const result = checkTool(
      "eval",
      config({ tools: { "*": "ask", eval: "allow" } }),
    );
    expect(result.action).toBe("allow");
    expect(result.matchedRule).toBe("eval");
  });

  it("matches wildcard patterns", () => {
    const result = checkTool(
      "context7_search",
      config({ tools: { "context7_*": "allow" } }),
    );
    expect(result.action).toBe("allow");
  });

  it("returns deny fallback when configured", () => {
    const result = checkTool(
      "write",
      config({
        defaults: { ...DEFAULTS, tools: "deny" },
      }),
    );
    expect(result.action).toBe("deny");
  });
});

describe("checkPath", () => {
  const cwd = "/home/user/project";

  it("returns deny when path matches a deny rule", () => {
    const result = checkPath(
      "/home/user/project/.env",
      cwd,
      config({ paths: { "**/.env": "deny" } }),
    );
    expect(result.action).toBe("deny");
  });

  it("returns allow when path matches an allow rule", () => {
    const result = checkPath(
      "src/index.ts",
      cwd,
      config({ paths: { "**/*.ts": "allow" } }),
    );
    expect(result.action).toBe("allow");
  });

  it("returns ask when no rule matches and default is ask", () => {
    const result = checkPath("src/index.ts", cwd, config());
    expect(result.action).toBe("ask");
  });

  it("resolves relative paths against cwd", () => {
    const result = checkPath(
      ".env",
      cwd,
      config({ paths: { "**/.env": "deny" } }),
    );
    expect(result.action).toBe("deny");
    // Normalized to absolute path
    expect(result.reason).toContain("/home/user/project/.env");
  });

  it("expands tilde in paths", () => {
    const result = checkPath(
      "~/.ssh/config",
      cwd,
      config({ paths: { "**/.ssh/**": "deny" } }),
    );
    // The homedir is expanded; the pattern **/.ssh/** should match
    // On Linux, homedir will be something like /home/user
    // The expanded path will be /home/user/.ssh/config
    // The pattern **/.ssh/** should match
    // We can't assert the exact path since it depends on the test runner's user
    expect(result.action).toBe("deny");
  });

  it("uses last-match-wins for paths", () => {
    const result = checkPath(
      "/home/user/project/.env",
      cwd,
      config({
        paths: {
          "**/.env": "ask",
          "**/project/.env": "allow",
          "**/project/.env.backup": "deny",
        },
      }),
    );
    // **/project/.env matches and overrides **/.env
    expect(result.action).toBe("allow");
  });

  it("returns deny fallback when configured", () => {
    const result = checkPath(
      "src/index.ts",
      cwd,
      config({
        defaults: { ...DEFAULTS, paths: "deny" },
      }),
    );
    expect(result.action).toBe("deny");
  });
});

describe("checkBash", () => {
  it("returns ask from fallback when no arbiter is configured", async () => {
    const result = await checkBash("git status", config());
    expect(result.action).toBe("ask");
    expect(result.reason).toContain("no bash arbiter configured");
  });

  it("returns allow from fallback when configured", async () => {
    const result = await checkBash(
      "git status",
      config({
        defaults: { ...DEFAULTS, bash: "allow" },
      }),
    );
    expect(result.action).toBe("allow");
  });

  it("calls arbiter when configured", async () => {
    // With an arbiter configured, it should attempt to run it.
    // The arbiter won't exist so it will return deny.
    const result = await checkBash(
      "git push",
      config({ bashArbiterPath: "/nonexistent/arbiter.sh" }),
    );
    expect(result.action).toBe("deny");
    expect(result.reason).toContain("not found or not executable");
  });
});
