import { describe, expect, it } from "vitest";
import { computeRosterChange, formatAgentRoster } from "../src/lib/ambient.js";
import type { AgentConfig } from "../src/lib/types.js";

function makeAgent(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    name: "test-agent",
    description: "Test agent",
    model: "cheap",
    thinking: "",
    tools: [],
    mode: "clean",
    sandbox: false,
    noSession: true,
    body: "",
    ...overrides,
  };
}

describe("formatAgentRoster", () => {
  it("formats multiple agents with descriptions", () => {
    const agents: AgentConfig[] = [
      makeAgent({
        name: "researcher",
        description: "Reads and summarizes code",
      }),
      makeAgent({ name: "implementer", description: "Writes and edits files" }),
    ];

    const roster = formatAgentRoster(agents);

    expect(roster).toContain("subagent-roster");
    expect(roster).toContain("- **implementer**: Writes and edits files");
    expect(roster).toContain("- **researcher**: Reads and summarizes code");
  });

  it("excludes agent with empty description", () => {
    const agents: AgentConfig[] = [
      makeAgent({ name: "researcher", description: "Reads code" }),
      makeAgent({ name: "no-desc", description: "" }),
    ];

    const roster = formatAgentRoster(agents);

    expect(roster).toContain("researcher");
    expect(roster).not.toContain("no-desc");
  });

  it("excludes agent with whitespace-only description", () => {
    const agents: AgentConfig[] = [
      makeAgent({ name: "researcher", description: "Reads code" }),
      makeAgent({ name: "blank-desc", description: "   \t\n  " }),
    ];

    const roster = formatAgentRoster(agents);

    expect(roster).toContain("researcher");
    expect(roster).not.toContain("blank-desc");
  });

  it("returns empty string when all agents excluded", () => {
    const agents: AgentConfig[] = [
      makeAgent({ name: "a", description: "" }),
      makeAgent({ name: "b", description: "   " }),
    ];

    expect(formatAgentRoster(agents)).toBe("");
  });

  it("returns empty string for empty array", () => {
    expect(formatAgentRoster([])).toBe("");
  });

  it("formats single agent", () => {
    const agents: AgentConfig[] = [
      makeAgent({ name: "researcher", description: "Reads code" }),
    ];

    const roster = formatAgentRoster(agents);

    expect(roster).toContain("subagent-roster");
    expect(roster).toContain("- **researcher**: Reads code");
    // Single agent means exactly one list item line
    const itemLines = roster.split("\n").filter((l) => l.startsWith("- **"));
    expect(itemLines).toHaveLength(1);
  });

  it("sorts alphabetically by name", () => {
    const agents: AgentConfig[] = [
      makeAgent({ name: "zebra", description: "D" }),
      makeAgent({ name: "alpha", description: "A" }),
      makeAgent({ name: "charlie", description: "C" }),
      makeAgent({ name: "beta", description: "B" }),
    ];

    const roster = formatAgentRoster(agents);

    const lines = roster.split("\n");
    const agentLines = lines.filter((l) => l.startsWith("- **"));
    expect(agentLines[0]).toContain("alpha");
    expect(agentLines[1]).toContain("beta");
    expect(agentLines[2]).toContain("charlie");
    expect(agentLines[3]).toContain("zebra");
  });
});

describe("computeRosterChange", () => {
  const roster =
    '<context name="subagent-roster">\n- **foo**: bar\n</context>\n';
  const other =
    '<context name="subagent-roster">\n- **baz**: qux\n</context>\n';

  it("injects on first non-empty roster (null → content)", () => {
    const result = computeRosterChange(roster, null);
    expect(result).toEqual({ shouldInject: true, newSignature: roster });
  });

  it("skips when roster unchanged", () => {
    const result = computeRosterChange(roster, roster);
    expect(result).toEqual({ shouldInject: false, newSignature: roster });
  });

  it("injects when roster changed", () => {
    const result = computeRosterChange(other, roster);
    expect(result).toEqual({ shouldInject: true, newSignature: other });
  });

  it("clears signature when roster becomes empty", () => {
    const result = computeRosterChange("", roster);
    expect(result).toEqual({ shouldInject: false, newSignature: null });
  });

  it("no-op for persistent empty roster", () => {
    const result = computeRosterChange("", null);
    expect(result).toEqual({ shouldInject: false, newSignature: null });
  });
});
