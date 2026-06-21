import { describe, expect, it, vi } from "vitest";
import { registerGuards } from "../src/guards.js";
import { ApprovalCache } from "../src/lib/approval-cache.js";
import type { ResolvedConfig } from "../src/lib/types.js";

function config(overrides: Partial<ResolvedConfig> = {}): ResolvedConfig {
  return {
    defaults: {
      tools: "ask",
      bash: "ask",
      paths: "ask",
    },
    tools: {},
    paths: {},
    ...overrides,
  };
}

/** Create a minimal mock of pi's extension API and context. */
function createMockPi(hasUI = true) {
  const handlers: Array<{
    event: string;
    handler: (event: unknown, ctx: unknown) => unknown;
  }> = [];

  const ctx = {
    hasUI,
    cwd: "/home/user/project",
    ui: {
      confirm: (_title: string, _message: string) => Promise.resolve(true),
    },
  };

  const pi = {
    events: { emit: vi.fn(), on: vi.fn(), off: vi.fn() },
    on(event: string, handler: (event: unknown, ctx: unknown) => unknown) {
      handlers.push({ event, handler });
    },
  };

  return {
    handlers,
    pi,
    ctx,
    /** Simulate a tool_call event and return the result */
    async dispatchToolCall(
      toolName: string,
      input: Record<string, unknown>,
    ): Promise<{ block?: boolean; reason?: string } | undefined> {
      const toolCall = handlers.find((h) => h.event === "tool_call");
      if (!toolCall) {
        throw new Error("No tool_call handler registered");
      }
      return toolCall.handler({ toolName, input }, ctx) as Promise<
        | {
            block?: boolean;
            reason?: string;
          }
        | undefined
      >;
    },
  };
}

describe("registerGuards", () => {
  describe("tool guard", () => {
    it("blocks denied tools", async () => {
      const store = new ApprovalCache();
      const { pi, dispatchToolCall } = createMockPi();
      registerGuards(pi as any, config({ tools: { write: "deny" } }), store);

      const result = await dispatchToolCall("write", {
        path: "test.txt",
        content: "hi",
      });
      expect(result).toBeDefined();
      expect(result!.block).toBe(true);
      expect(result!.reason).toContain("Permission denied");
    });

    it("allows allowed tools", async () => {
      const store = new ApprovalCache();
      const { pi, dispatchToolCall } = createMockPi();
      registerGuards(pi as any, config({ tools: { read: "allow" } }), store);

      const result = await dispatchToolCall("read", { path: "test.txt" });
      expect(result).toBeUndefined(); // undefined = proceed
    });

    it("prompts on ask and allows when user confirms", async () => {
      const store = new ApprovalCache();
      const { pi, ctx, dispatchToolCall } = createMockPi();
      ctx.ui.confirm = () => Promise.resolve(true);
      registerGuards(pi as any, config(), store);

      const result = await dispatchToolCall("eval", { code: "1+1" });
      expect(result).toBeUndefined(); // proceed
    });

    it("prompts on ask and blocks when user denies", async () => {
      const store = new ApprovalCache();
      const { pi, ctx, dispatchToolCall } = createMockPi();
      ctx.ui.confirm = () => Promise.resolve(false);
      registerGuards(pi as any, config(), store);

      const result = await dispatchToolCall("eval", { code: "1+1" });
      expect(result).toBeDefined();
      expect(result!.block).toBe(true);
    });

    it("remembers session approvals and does not re-prompt", async () => {
      const store = new ApprovalCache();
      const { pi, ctx, dispatchToolCall } = createMockPi();

      let promptCount = 0;
      ctx.ui.confirm = () => {
        promptCount++;
        return Promise.resolve(true);
      };

      registerGuards(pi as any, config(), store);

      // First call: prompts
      await dispatchToolCall("eval", { code: "1+1" });
      expect(promptCount).toBe(1);

      // Second call: uses session store, no re-prompt
      await dispatchToolCall("eval", { code: "2+2" });
      expect(promptCount).toBe(1);
    });

    it("denies in headless mode", async () => {
      const store = new ApprovalCache();
      const { pi, dispatchToolCall } = createMockPi(false); // no UI
      registerGuards(pi as any, config(), store);

      const result = await dispatchToolCall("write", {
        path: "test.txt",
        content: "hi",
      });
      expect(result).toBeDefined();
      expect(result!.block).toBe(true);
    });
  });

  describe("path guard", () => {
    it("blocks writes to denied paths", async () => {
      const store = new ApprovalCache();
      const { pi, dispatchToolCall } = createMockPi();
      registerGuards(
        pi as any,
        config({ paths: { "**/.env": "deny" }, tools: { write: "allow" } }),
        store,
      );

      const result = await dispatchToolCall("write", {
        path: ".env",
        content: "secret",
      });
      expect(result).toBeDefined();
      expect(result!.block).toBe(true);
      expect(result!.reason).toContain("Permission denied");
    });

    it("allows writes to non-protected paths", async () => {
      const store = new ApprovalCache();
      const { pi, dispatchToolCall } = createMockPi();
      registerGuards(
        pi as any,
        config({ paths: { "**/.env": "deny" }, tools: { write: "allow" } }),
        store,
      );

      const result = await dispatchToolCall("write", {
        path: "src/index.ts",
        content: "// code",
      });
      expect(result).toBeUndefined();
    });
  });

  describe("bash guard", () => {
    it("runs arbiter for bash commands", async () => {
      const store = new ApprovalCache();
      const { pi, dispatchToolCall } = createMockPi();
      registerGuards(
        pi as any,
        config({
          tools: { bash: "allow" },
          bashArbiterPath: "/nonexistent/arbiter.sh",
        }),
        store,
      );

      const result = await dispatchToolCall("bash", { command: "rm -rf /" });
      expect(result).toBeDefined();
      expect(result!.block).toBe(true);
      expect(result!.reason).toContain("not found or not executable");
    });

    it("uses fallback when no arbiter configured", async () => {
      const store = new ApprovalCache();
      const { pi, ctx, dispatchToolCall } = createMockPi();
      ctx.ui.confirm = () => Promise.resolve(true);
      registerGuards(pi as any, config({ tools: { bash: "allow" } }), store);

      const result = await dispatchToolCall("bash", { command: "git status" });
      // fallback is "ask", user confirmed → proceeds
      expect(result).toBeUndefined();
    });
  });

  describe("guard ordering", () => {
    it("path deny short-circuits before tool guard", async () => {
      const store = new ApprovalCache();
      const { pi, dispatchToolCall } = createMockPi();
      registerGuards(
        pi as any,
        config({
          paths: { "**/.env": "deny" },
          tools: { write: "allow" },
        }),
        store,
      );

      const result = await dispatchToolCall("write", {
        path: ".env",
        content: "secret",
      });
      expect(result).toBeDefined();
      expect(result!.block).toBe(true);
      expect(result!.reason).toContain("Permission denied");
    });
  });

  describe("event emission", () => {
    it("emits <toolName>_permission:prompt when dialog is shown (tool guard)", async () => {
      const store = new ApprovalCache();
      const { pi, dispatchToolCall } = createMockPi();
      registerGuards(pi as any, config(), store);

      await dispatchToolCall("eval", { code: "1+1" });

      expect(pi.events.emit).toHaveBeenCalledWith("eval_permission:prompt", {
        toolName: "eval",
        category: "tool",
        summary: "",
        reason: expect.any(String),
      });
    });

    it("emits <toolName>_permission:prompt when dialog is shown (path guard)", async () => {
      const store = new ApprovalCache();
      const { pi, dispatchToolCall } = createMockPi();
      registerGuards(
        pi as any,
        config({ paths: { "src/**": "ask" }, tools: { write: "allow" } }),
        store,
      );

      await dispatchToolCall("write", {
        path: "src/index.ts",
        content: "// code",
      });

      expect(pi.events.emit).toHaveBeenCalledWith("write_permission:prompt", {
        toolName: "write",
        category: "path",
        summary: "src/index.ts",
        reason: undefined,
      });
    });

    it("emits <toolName>_permission:prompt when dialog is shown (bash guard)", async () => {
      const store = new ApprovalCache();
      const { pi, dispatchToolCall } = createMockPi();
      registerGuards(pi as any, config({ tools: { bash: "allow" } }), store);

      await dispatchToolCall("bash", { command: "git status" });

      expect(pi.events.emit).toHaveBeenCalledWith("bash_permission:prompt", {
        toolName: "bash",
        category: "bash",
        summary: "git status",
        reason: expect.any(String),
      });
    });

    it("does not emit when cached decision exists", async () => {
      const store = new ApprovalCache();
      const { pi, dispatchToolCall } = createMockPi();
      registerGuards(pi as any, config(), store);

      // First call: emits (dialog shown)
      await dispatchToolCall("eval", { code: "1+1" });
      expect(pi.events.emit).toHaveBeenCalledTimes(1);

      (pi.events.emit as ReturnType<typeof vi.fn>).mockClear();

      // Second call: uses session store, no dialog → no emit
      await dispatchToolCall("eval", { code: "2+2" });
      expect(pi.events.emit).not.toHaveBeenCalled();
    });

    it("does not emit in headless mode", async () => {
      const store = new ApprovalCache();
      const { pi, dispatchToolCall } = createMockPi(false); // no UI
      registerGuards(pi as any, config(), store);

      await dispatchToolCall("eval", { code: "1+1" });

      expect(pi.events.emit).not.toHaveBeenCalled();
    });

    it("does not emit on deny rules", async () => {
      const store = new ApprovalCache();
      const { pi, dispatchToolCall } = createMockPi();
      registerGuards(pi as any, config({ tools: { write: "deny" } }), store);

      await dispatchToolCall("write", {
        path: "test.txt",
        content: "hi",
      });

      expect(pi.events.emit).not.toHaveBeenCalled();
    });
  });
});
