/**
 * gh-ban.test.ts — Tests for the configurable bash gh ban feature.
 *
 * When config.banBashGh is true, model-initiated bash commands matching
 * `gh search`, `gh api`, or `gh auth` are blocked and redirected to the
 * corresponding ghsearch tool.
 */

import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, type GhSearchConfig } from "../src/config.js";

// ---------------------------------------------------------------------------
// Helpers — simulate the ban logic from index.ts
// ---------------------------------------------------------------------------

interface ToolCallEvent {
  toolName: string;
  input: { command?: string };
}

type ToolCallHandler = (
  event: ToolCallEvent,
) => { block: boolean; reason: string } | undefined;

/**
 * Replicates the ban logic from index.ts in isolation.
 * Returns the blocked state for a given bash command.
 */
function applyBan(
  command: string,
  banEnabled: boolean,
): { blocked: boolean; reason?: string } {
  if (!banEnabled) return { blocked: false };

  const blocked: Record<string, string> = {
    "gh search": "gh_search",
    "gh api": "gh_fetch",
    "gh auth": "gh_auth_status",
  };

  const trimmed = command.trim();
  for (const [prefix, replacement] of Object.entries(blocked)) {
    if (trimmed.startsWith(prefix)) {
      return {
        blocked: true,
        reason: `${prefix} is blocked by pi-ghsearch config. Use ${replacement} instead.`,
      };
    }
  }
  return { blocked: false };
}

/**
 * Simulates the full extension setup for a given config.
 * Returns the registered tool_call handler (if any), or null.
 */
function simulateExtensionSetup(
  config: GhSearchConfig,
): ToolCallHandler | null {
  if (!config.banBashGh) return null;

  const blocked: Record<string, string> = {
    "gh search": "gh_search",
    "gh api": "gh_fetch",
    "gh auth": "gh_auth_status",
  };

  return (event: ToolCallEvent) => {
    if (event.toolName !== "bash") return;

    const cmd = event.input?.command ?? "";
    const trimmed = cmd.trim();

    for (const [prefix, replacement] of Object.entries(blocked)) {
      if (trimmed.startsWith(prefix)) {
        return {
          block: true,
          reason: `${prefix} is blocked by pi-ghsearch config. Use ${replacement} instead.`,
        };
      }
    }
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("bash gh ban", () => {
  describe("config loading", () => {
    it("banBashGh defaults to undefined (no blocking)", () => {
      expect(DEFAULT_CONFIG.banBashGh).toBeUndefined();
    });
  });

  describe("ban logic", () => {
    it("does not block when banBashGh is false/undefined", () => {
      expect(applyBan("gh search repos test", false).blocked).toBe(false);
      expect(applyBan("gh search repos test", undefined as any).blocked).toBe(
        false,
      );
    });

    it("blocks gh search when banBashGh is true", () => {
      const r = applyBan("gh search repos typebox --limit 5", true);
      expect(r.blocked).toBe(true);
      expect(r.reason).toContain("gh_search");
    });

    it("blocks gh api when banBashGh is true", () => {
      const r = applyBan("gh api /repos/foo/bar", true);
      expect(r.blocked).toBe(true);
      expect(r.reason).toContain("gh_fetch");
    });

    it("blocks gh auth when banBashGh is true", () => {
      const r = applyBan("gh auth status", true);
      expect(r.blocked).toBe(true);
      expect(r.reason).toContain("gh_auth_status");
    });

    it("does NOT block gh repo clone", () => {
      expect(applyBan("gh repo clone foo/bar", true).blocked).toBe(false);
    });

    it("does NOT block gh issue create", () => {
      expect(
        applyBan('gh issue create --title "Bug" --body "desc"', true).blocked,
      ).toBe(false);
    });

    it("does NOT block gh pr list", () => {
      expect(applyBan("gh pr list --state open", true).blocked).toBe(false);
    });

    it("does NOT block gh --version or gh help", () => {
      expect(applyBan("gh --version", true).blocked).toBe(false);
      expect(applyBan("gh help", true).blocked).toBe(false);
    });

    it("handles leading whitespace in command", () => {
      expect(applyBan("  gh search repos test", true).blocked).toBe(true);
    });

    it("reason message names the correct replacement tool", () => {
      expect(applyBan("gh search test", true).reason).toContain("gh_search");
      expect(applyBan("gh api /x", true).reason).toContain("gh_fetch");
      expect(applyBan("gh auth status", true).reason).toContain(
        "gh_auth_status",
      );
    });
  });

  describe("extension handler", () => {
    it("returns null handler when banBashGh is false", () => {
      const handler = simulateExtensionSetup({
        ...DEFAULT_CONFIG,
        defaults: { limit: 30 },
      });
      expect(handler).toBeNull();
    });

    it("registers handler when banBashGh is true", () => {
      const handler = simulateExtensionSetup({
        ...DEFAULT_CONFIG,
        defaults: { limit: 30 },
        banBashGh: true,
      });
      expect(handler).not.toBeNull();
    });

    it("handler ignores non-bash tools", () => {
      const handler = simulateExtensionSetup({
        ...DEFAULT_CONFIG,
        defaults: { limit: 30 },
        banBashGh: true,
      })!;

      // Non-bash tools should pass through regardless of input
      expect(handler({ toolName: "gh_search", input: {} })).toBeUndefined();

      expect(handler({ toolName: "read", input: {} })).toBeUndefined();
    });

    it("handler blocks bash gh search", () => {
      const handler = simulateExtensionSetup({
        ...DEFAULT_CONFIG,
        defaults: { limit: 30 },
        banBashGh: true,
      })!;

      const result = handler({
        toolName: "bash",
        input: { command: "gh search repos test" },
      });

      expect(result).toBeDefined();
      expect(result!.block).toBe(true);
      expect(result!.reason).toContain("gh_search");
    });

    it("handler passes through non-gh bash commands", () => {
      const handler = simulateExtensionSetup({
        ...DEFAULT_CONFIG,
        defaults: { limit: 30 },
        banBashGh: true,
      })!;

      expect(
        handler({ toolName: "bash", input: { command: "ls -la" } }),
      ).toBeUndefined();

      expect(
        handler({ toolName: "bash", input: { command: "npm test" } }),
      ).toBeUndefined();
    });

    it("handler passes through gh repo/issue/pr commands", () => {
      const handler = simulateExtensionSetup({
        ...DEFAULT_CONFIG,
        defaults: { limit: 30 },
        banBashGh: true,
      })!;

      expect(
        handler({
          toolName: "bash",
          input: { command: "gh repo clone foo/bar" },
        }),
      ).toBeUndefined();

      expect(
        handler({
          toolName: "bash",
          input: { command: "gh issue list" },
        }),
      ).toBeUndefined();

      expect(
        handler({
          toolName: "bash",
          input: { command: "gh pr create --title foo" },
        }),
      ).toBeUndefined();
    });
  });
});
