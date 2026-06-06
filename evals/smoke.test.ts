/**
 * Smoke test for pi-ghsearch extension.
 *
 * Exercises all tool functions through the real gh CLI to verify
 * end-to-end functionality works after the refactor.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, type GhSearchConfig } from "../src/config.js";
import { createGhAuthStatusTool } from "../src/gh-auth-status.js";
import { createGhFetchTool } from "../src/gh-fetch.js";
import { createGhSearchTool } from "../src/gh-search.js";

const execFileAsync = promisify(execFile);

function mkPi() {
  return {
    exec: async (
      cmd: string,
      args: string[],
      opts: { cwd: string; signal?: AbortSignal; timeout: number },
    ) => {
      const { stdout, stderr } = await execFileAsync(cmd, args, {
        cwd: opts.cwd ?? process.cwd(),
        timeout: opts.timeout ?? 30_000,
        signal: opts.signal,
        maxBuffer: 50 * 1024 * 1024,
      });
      return { code: 0, stdout, stderr };
    },
  } as any;
}

const pi = mkPi();
const ghSearch = createGhSearchTool(pi, DEFAULT_CONFIG);
const ghFetch = createGhFetchTool(pi, DEFAULT_CONFIG);
const ghAuthStatus = createGhAuthStatusTool(pi, DEFAULT_CONFIG);
const ctx = { cwd: process.cwd(), signal: undefined } as any;

// Use a well-known public repo with issues, PRs, and commits
const REPO_OWNER = "octocat";
const REPO_NAME = "Hello-World";
const REPO_FULL = `${REPO_OWNER}/${REPO_NAME}`;
const REPO_BRANCH = "master"; // octocat/Hello-World uses master, not main

// ── gh_auth_status smoke tests ────────────────────────────────
describe("smoke: gh_auth_status", () => {
  it("basic auth check (no flags)", async () => {
    const r = await ghAuthStatus.execute(
      "auth-1",
      {},
      undefined,
      undefined,
      ctx,
    );
    expect(r.details.authenticated).toBe(true);
    expect(r.details.exitCode).toBe(0);
    expect(r.content[0]?.type).toBe("text");
  });

  it("with --hostname flag", async () => {
    const r = await ghAuthStatus.execute(
      "auth-2",
      { hostname: "github.com" },
      undefined,
      undefined,
      ctx,
    );
    expect(r.details.command).toContain("--hostname");
    expect(r.details.command).toContain("github.com");
  });

  it("with --active flag", async () => {
    const r = await ghAuthStatus.execute(
      "auth-3",
      { active: true },
      undefined,
      undefined,
      ctx,
    );
    expect(r.details.command).toContain("--active");
  });

  it("with both --hostname and --active", async () => {
    const r = await ghAuthStatus.execute(
      "auth-4",
      { hostname: "github.com", active: true },
      undefined,
      undefined,
      ctx,
    );
    expect(r.details.command).toContain("--hostname");
    expect(r.details.command).toContain("github.com");
    expect(r.details.command).toContain("--active");
  });
});

// ── gh_search smoke tests ─────────────────────────────────────
describe("smoke: gh_search", () => {
  it("repos scope — finds known repo (first result matches)", async () => {
    const r = await ghSearch.execute(
      "s1",
      { scope: "repos", query: REPO_FULL, limit: 5 },
      undefined,
      undefined,
      ctx,
    );
    const parsed = r.details.parsed as any[];
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBeGreaterThanOrEqual(1);
    expect(parsed[0].fullName).toBe(REPO_FULL);
  });

  it("issues scope — returns non-empty array", async () => {
    const r = await ghSearch.execute(
      "s2",
      { scope: "issues", query: `repo:${REPO_FULL}`, limit: 5 },
      undefined,
      undefined,
      ctx,
    );
    const parsed = r.details.parsed as any[];
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBeGreaterThan(0);
  });

  it("prs scope — returns non-empty array", async () => {
    const r = await ghSearch.execute(
      "s3",
      { scope: "prs", query: `repo:${REPO_FULL}`, limit: 5 },
      undefined,
      undefined,
      ctx,
    );
    const parsed = r.details.parsed as any[];
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBeGreaterThan(0);
  });

  it("code scope — returns raw text, not JSON", async () => {
    const r = await ghSearch.execute(
      "s4",
      { scope: "code", query: `repo:${REPO_FULL} hello`, limit: 5 },
      undefined,
      undefined,
      ctx,
    );
    expect(typeof r.content[0]?.text).toBe("string");
    expect((r.content[0]?.text ?? "").length).toBeGreaterThan(0);
    // Code scope should not have parsed JSON
    expect(r.details.parsed).toBeUndefined();
  });

  it("commits scope — returns non-empty array (with --repo flag)", async () => {
    // Commits search requires actual search text; --repo is used for repo filtering
    const r = await ghSearch.execute(
      "s5",
      { scope: "commits", query: "merge", repo: [REPO_FULL], limit: 5 },
      undefined,
      undefined,
      ctx,
    );
    const parsed = r.details.parsed as any[];
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBeGreaterThan(0);
  });

  it("repos with sort/order/lang/limit flags", async () => {
    const r = await ghSearch.execute(
      "s6",
      {
        scope: "repos",
        query: "topic:mcp",
        limit: 3,
        sort: "stars",
        order: "desc",
        language: "typescript",
      },
      undefined,
      undefined,
      ctx,
    );
    const parsed = r.details.parsed as any[];
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBeGreaterThan(0);
  });

  it("issues with state filter", async () => {
    const r = await ghSearch.execute(
      "s7",
      { scope: "issues", query: `repo:${REPO_FULL}`, limit: 3, state: "open" },
      undefined,
      undefined,
      ctx,
    );
    const parsed = r.details.parsed as any[];
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBeGreaterThan(0);
  });

  it("custom fields — only requested fields present", async () => {
    const r = await ghSearch.execute(
      "s8",
      {
        scope: "repos",
        query: REPO_FULL,
        limit: 1,
        fields: "name,url,stargazersCount",
      },
      undefined,
      undefined,
      ctx,
    );
    const parsed = r.details.parsed as any[];
    expect(Array.isArray(parsed)).toBe(true);
    const item = parsed?.[0] as Record<string, unknown> | undefined;
    expect(item).toBeDefined();
    // Custom fields — fullName (default) should NOT be present
    expect("name" in (item ?? {})).toBe(true);
    expect("fullName" in (item ?? {})).toBe(false);
  });

  it("owner filter", async () => {
    const r = await ghSearch.execute(
      "s9",
      { scope: "repos", query: REPO_NAME, limit: 3, owner: [REPO_OWNER] },
      undefined,
      undefined,
      ctx,
    );
    const parsed = r.details.parsed as any[];
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBeGreaterThan(0);
  });
});

// ── gh_fetch smoke tests ──────────────────────────────────────
describe("smoke: gh_fetch", () => {
  it("repo URL → repos/owner/repo endpoint", async () => {
    const r = await ghFetch.execute(
      "f1",
      { url: `https://github.com/${REPO_FULL}` },
      undefined,
      undefined,
      ctx,
    );
    expect(r.details.endpoint).toBe(`repos/${REPO_FULL}`);
    expect(r.details.parsed).not.toBeNull();
  });

  it("issues list endpoint (no trailing slash)", async () => {
    const r = await ghFetch.execute(
      "f2",
      { url: `https://github.com/${REPO_FULL}/issues` },
      undefined,
      undefined,
      ctx,
    );
    // Should NOT have trailing slash
    expect(r.details.endpoint).toBe(`repos/${REPO_FULL}/issues`);
    expect(Array.isArray(r.details.parsed)).toBe(true);
    expect((r.details.parsed as any[]).length).toBeGreaterThan(0);
  });

  it("pulls list — pull→pulls, no trailing slash", async () => {
    const r = await ghFetch.execute(
      "f3",
      { url: `https://github.com/${REPO_FULL}/pulls` },
      undefined,
      undefined,
      ctx,
    );
    expect(r.details.endpoint).toBe(`repos/${REPO_FULL}/pulls`);
    expect(Array.isArray(r.details.parsed)).toBe(true);
  });

  it("blob URL → contents with ?ref=", async () => {
    const r = await ghFetch.execute(
      "f4",
      { url: `https://github.com/${REPO_FULL}/blob/${REPO_BRANCH}/README` },
      undefined,
      undefined,
      ctx,
    );
    expect(r.details.endpoint).toBe(
      `repos/${REPO_FULL}/contents/README?ref=${REPO_BRANCH}`,
    );
  });

  it("tree URL → contents with ?ref=", async () => {
    const r = await ghFetch.execute(
      "f5",
      { url: `https://github.com/${REPO_FULL}/tree/${REPO_BRANCH}` },
      undefined,
      undefined,
      ctx,
    );
    expect(r.details.endpoint).toBe(
      `repos/${REPO_FULL}/contents?ref=${REPO_BRANCH}`,
    );
  });

  it("commit URL → commits endpoint, no trailing slash", async () => {
    // Get latest commit SHA first
    const listResult = await ghFetch.execute(
      "f6a",
      { url: `https://github.com/${REPO_FULL}/commits` },
      undefined,
      undefined,
      ctx,
    );
    const commits = listResult.details.parsed as any[];
    expect(Array.isArray(commits)).toBe(true);
    expect(commits.length).toBeGreaterThan(0);

    const sha = commits[0].sha as string;
    const r = await ghFetch.execute(
      "f6b",
      { url: `https://github.com/${REPO_FULL}/commit/${sha}` },
      undefined,
      undefined,
      ctx,
    );
    expect(r.details.endpoint).toBe(`repos/${REPO_FULL}/commits/${sha}`);
    expect(r.details.parsed).not.toBeNull();
  });

  it("api.github.com pass-through", async () => {
    const r = await ghFetch.execute(
      "f7",
      { url: `https://api.github.com/repos/${REPO_FULL}` },
      undefined,
      undefined,
      ctx,
    );
    expect(r.details.endpoint).toBe(`repos/${REPO_FULL}`);
  });

  it("Contents API → detects file type", async () => {
    const r = await ghFetch.execute(
      "f8",
      { url: `https://api.github.com/repos/${REPO_FULL}/contents/README` },
      undefined,
      undefined,
      ctx,
    );
    const parsed = r.details.parsed as Record<string, unknown> | undefined;
    expect(parsed).toBeDefined();
    expect(typeof parsed?.name).toBe("string");
    expect(typeof parsed?.path).toBe("string");
    expect("encoding" in (parsed ?? {}) || "content" in (parsed ?? {})).toBe(
      true,
    );
  });
});

// ── renderCall / renderResult smoke tests ─────────────────────
describe("smoke: renderCall / renderResult", () => {
  const mockTheme = {
    fg: (_style: string, text: string) => text,
    bold: (text: string) => text,
  } as any;

  it("gh_search renderCall does not throw", () => {
    expect(() =>
      ghSearch.renderCall(
        { scope: "repos", query: "test" } as any,
        mockTheme,
        undefined,
      ),
    ).not.toThrow();
  });

  it("gh_search renderResult (expanded)", () => {
    expect(() =>
      ghSearch.renderResult(
        {
          content: [{ type: "text", text: "output" }],
          details: { parsed: [] },
        } as any,
        { expanded: true } as any,
        mockTheme,
        { isError: false, args: { scope: "repos" } } as any,
      ),
    ).not.toThrow();
  });

  it("gh_search renderResult (collapsed repos)", () => {
    expect(() =>
      ghSearch.renderResult(
        {
          content: [{ type: "text", text: "{}" }],
          details: {
            parsed: [
              { fullName: "org/repo", stargazersCount: 5, language: "TS" },
            ],
          },
        } as any,
        { expanded: false } as any,
        mockTheme,
        { isError: false, args: { scope: "repos" } } as any,
      ),
    ).not.toThrow();
  });

  it("gh_search renderResult (error)", () => {
    expect(() =>
      ghSearch.renderResult(
        { content: [{ type: "text", text: "error msg" }] } as any,
        { expanded: false } as any,
        mockTheme,
        { isError: true, args: { scope: "repos" } } as any,
      ),
    ).not.toThrow();
  });

  it("gh_search renderResult (code scope)", () => {
    expect(() =>
      ghSearch.renderResult(
        {
          content: [{ type: "text", text: "src/file.ts\n  code\n" }],
          details: {},
        } as any,
        { expanded: false } as any,
        mockTheme,
        { isError: false, args: { scope: "code" } } as any,
      ),
    ).not.toThrow();
  });

  it("gh_fetch renderCall does not throw", () => {
    expect(() =>
      ghFetch.renderCall(
        { url: "https://github.com/org/repo" } as any,
        mockTheme,
        undefined,
      ),
    ).not.toThrow();
  });

  it("gh_fetch renderResult (expanded)", () => {
    expect(() =>
      ghFetch.renderResult(
        {
          content: [{ type: "text", text: '{"name":"t"}' }],
          details: { parsed: { name: "t" }, endpoint: "repos/o/r" },
        } as any,
        { expanded: true } as any,
        mockTheme,
        { isError: false } as any,
      ),
    ).not.toThrow();
  });

  it("gh_fetch renderResult (collapsed repo)", () => {
    expect(() =>
      ghFetch.renderResult(
        {
          content: [{ type: "text", text: "{}" }],
          details: {
            parsed: { full_name: "o/r", stargazers_count: 10, language: "TS" },
            endpoint: "repos/o/r",
          },
        } as any,
        { expanded: false } as any,
        mockTheme,
        { isError: false } as any,
      ),
    ).not.toThrow();
  });

  it("gh_fetch renderResult (error)", () => {
    expect(() =>
      ghFetch.renderResult(
        { content: [{ type: "text", text: "Not Found" }] } as any,
        { expanded: false } as any,
        mockTheme,
        { isError: true } as any,
      ),
    ).not.toThrow();
  });

  it("gh_auth_status renderCall does not throw", () => {
    expect(() =>
      ghAuthStatus.renderCall({} as any, mockTheme, undefined),
    ).not.toThrow();
  });

  it("gh_auth_status renderResult (authenticated)", () => {
    expect(() =>
      ghAuthStatus.renderResult(
        {
          content: [{ type: "text", text: "Logged in to github.com as user" }],
          details: { authenticated: true },
        } as any,
        {} as any,
        mockTheme,
        { isError: false } as any,
      ),
    ).not.toThrow();
  });

  it("gh_auth_status renderResult (unauthenticated)", () => {
    expect(() =>
      ghAuthStatus.renderResult(
        {
          content: [{ type: "text", text: "not logged in" }],
          details: { authenticated: false },
        } as any,
        {} as any,
        mockTheme,
        { isError: false } as any,
      ),
    ).not.toThrow();
  });
});

// ── organization restriction smoke tests ─────────────────────
describe("smoke: organization restriction", () => {
  it("gh_search adds --owner when organization is set", async () => {
    const execCalls: { args: string[] }[] = [];
    const orgPi = {
      exec: async (_cmd: string, args: string[], _opts: unknown) => {
        execCalls.push({ args });
        return { code: 0, stdout: "[]", stderr: "" };
      },
    } as any;

    const orgConfig: GhSearchConfig = {
      ...DEFAULT_CONFIG,
      organization: "acme",
    };

    const searchTool = createGhSearchTool(orgPi, orgConfig);

    // User tries to pass a different owner — it should be overridden
    await searchTool.execute(
      "org-1",
      {
        scope: "repos",
        query: "test",
        owner: ["other-org"],
      } as any,
      undefined,
      undefined,
      { cwd: process.cwd(), signal: undefined } as any,
    );

    expect(execCalls.length).toBe(1);
    const args = execCalls[0]!.args;

    // Should contain --owner acme (from config)
    const ownerIndex = args.indexOf("--owner");
    expect(ownerIndex).toBeGreaterThanOrEqual(0);
    expect(args[ownerIndex + 1]).toBe("acme");

    // Should NOT contain --owner other-org (user's owner was overridden)
    expect(args.filter((a) => a === "other-org").length).toBe(0);
  });

  it("gh_search respects config.defaults.limit", async () => {
    const execCalls: { args: string[] }[] = [];
    const customPi = {
      exec: async (_cmd: string, args: string[], _opts: unknown) => {
        execCalls.push({ args });
        return { code: 0, stdout: "[]", stderr: "" };
      },
    } as any;

    const customConfig: GhSearchConfig = {
      ...DEFAULT_CONFIG,
      defaults: { limit: 7 },
    };

    const searchTool = createGhSearchTool(customPi, customConfig);

    // User does not specify limit — should use config default
    await searchTool.execute(
      "lim-1",
      { scope: "repos", query: "test" } as any,
      undefined,
      undefined,
      { cwd: process.cwd(), signal: undefined } as any,
    );

    expect(execCalls.length).toBe(1);
    const args = execCalls[0]!.args;
    const limitIndex = args.indexOf("--limit");
    expect(limitIndex).toBeGreaterThanOrEqual(0);
    expect(args[limitIndex + 1]).toBe("7");
  });

  it("gh_search uses user-specified limit over config default", async () => {
    const execCalls: { args: string[] }[] = [];
    const customPi = {
      exec: async (_cmd: string, args: string[], _opts: unknown) => {
        execCalls.push({ args });
        return { code: 0, stdout: "[]", stderr: "" };
      },
    } as any;

    const customConfig: GhSearchConfig = {
      ...DEFAULT_CONFIG,
      defaults: { limit: 7 },
    };

    const searchTool = createGhSearchTool(customPi, customConfig);

    // User specifies limit — should override config default
    await searchTool.execute(
      "lim-2",
      { scope: "repos", query: "test", limit: 42 } as any,
      undefined,
      undefined,
      { cwd: process.cwd(), signal: undefined } as any,
    );

    expect(execCalls.length).toBe(1);
    const args = execCalls[0]!.args;
    const limitIndex = args.indexOf("--limit");
    expect(limitIndex).toBeGreaterThanOrEqual(0);
    expect(args[limitIndex + 1]).toBe("42");
  });

  it("gh_fetch is NOT restricted by organization", async () => {
    const execCalls: { args: string[] }[] = [];
    const orgPi = {
      exec: async (_cmd: string, args: string[], _opts: unknown) => {
        execCalls.push({ args });
        return { code: 0, stdout: "{}", stderr: "" };
      },
    } as any;

    const orgConfig: GhSearchConfig = {
      ...DEFAULT_CONFIG,
      organization: "acme",
    };

    const fetchTool = createGhFetchTool(orgPi, orgConfig);
    await fetchTool.execute(
      "org-3",
      { url: "https://github.com/other-org/repo" },
      undefined,
      undefined,
      { cwd: process.cwd(), signal: undefined } as any,
    );

    expect(execCalls.length).toBe(1);
    const args = execCalls[0]!.args;
    // gh_fetch uses "gh api <endpoint>" — no --owner flag should appear
    expect(args).not.toContain("--owner");
    // Should fetch the actual URL, not restricted to org
    expect(args).toContain("repos/other-org/repo");
  });
});

// ── mmb-org restriction smoke tests (real gh CLI) ────────────
const ORG_NAME = "mmb-org";
const ORG_REPO = "mmb-org/NUS-proxy-bookmarklet";

const orgPi = mkPi();
const orgConfig: GhSearchConfig = {
  ...DEFAULT_CONFIG,
  organization: ORG_NAME,
};
const orgSearch = createGhSearchTool(orgPi, orgConfig);
const orgFetch = createGhFetchTool(orgPi, orgConfig);
const orgAuth = createGhAuthStatusTool(orgPi, orgConfig);

describe("smoke: mmb-org restriction", () => {
  it("org-scoped search finds repos in mmb-org", async () => {
    const r = await orgSearch.execute(
      "mo1",
      { scope: "repos", query: "NUS-proxy", limit: 5 },
      undefined,
      undefined,
      ctx,
    );
    const parsed = r.details.parsed as any[];
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBeGreaterThanOrEqual(1);
    // Every result must be in mmb-org
    for (const repo of parsed) {
      expect(repo.fullName).toMatch(/^mmb-org\//);
    }
  });

  it("external repo is not findable under org restriction", async () => {
    const r = await orgSearch.execute(
      "mo2",
      { scope: "repos", query: "octocat/Hello-World", limit: 5 },
      undefined,
      undefined,
      ctx,
    );
    const parsed = r.details.parsed as any[];
    expect(Array.isArray(parsed)).toBe(true);
    // Should not find octocat/Hello-World (it's not in mmb-org)
    const found = parsed.find((r: any) => r.fullName === "octocat/Hello-World");
    expect(found).toBeUndefined();
  });

  it("gh_fetch reaches repos outside the org", async () => {
    const r = await orgFetch.execute(
      "mo3",
      { url: "https://github.com/octocat/Hello-World" },
      undefined,
      undefined,
      ctx,
    );
    // Should succeed — gh_fetch is not org-restricted
    expect(r.details.parsed).toBeDefined();
    expect(r.details.endpoint).toBe("repos/octocat/Hello-World");
  });

  it("gh_auth_status works with org config set (no --org flag)", async () => {
    const r = await orgAuth.execute("mo4", {}, undefined, undefined, ctx);
    expect(r.details.authenticated).toBe(true);
    // Command must NOT contain --org (flag doesn't exist in gh auth status)
    expect(r.details.command).not.toContain("--org");
  });

  it("org-scoped search yields same result as manual --owner", async () => {
    // Run org-scoped search
    const r1 = await orgSearch.execute(
      "mo5a",
      { scope: "repos", query: ORG_REPO, limit: 5 },
      undefined,
      undefined,
      ctx,
    );

    // Run same search but with explicit --owner via the default (unrestricted) tool
    const r2 = await ghSearch.execute(
      "mo5b",
      { scope: "repos", query: ORG_REPO, owner: [ORG_NAME], limit: 5 },
      undefined,
      undefined,
      ctx,
    );

    const parsed1 = r1.details.parsed as any[];
    const parsed2 = r2.details.parsed as any[];

    // Both should find the same repo
    expect(parsed1.length).toBeGreaterThanOrEqual(1);
    expect(parsed2.length).toBeGreaterThanOrEqual(1);
    expect(parsed1[0].fullName).toBe(parsed2[0].fullName);
  });
});
