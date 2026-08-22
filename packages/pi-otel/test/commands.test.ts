import { describe, expect, it, vi } from "vitest";
import { registerOtelCommands } from "../src/commands/otel.js";
import { DEFAULT_CONFIG } from "../src/config.js";

type Notify = ReturnType<typeof vi.fn>;
type CommandDef = {
  description: string;
  handler: (args: string, ctx: { ui: { notify: Notify } }) => Promise<void>;
};

function makePi() {
  const commands = new Map<string, CommandDef>();
  const registerCommand = (name: string, def: CommandDef) => {
    commands.set(name, def);
  };
  return { commands, registerCommand };
}

function makeCtx() {
  return { ui: { notify: vi.fn() } };
}

describe("registerOtelCommands", () => {
  it("registers /otel-status and /otel-flush", () => {
    const { commands, registerCommand } = makePi();
    registerOtelCommands({ registerCommand } as never, {
      getConfig: () => DEFAULT_CONFIG,
      getSdk: () => null,
    });
    expect(commands.has("otel-status")).toBe(true);
    expect(commands.has("otel-flush")).toBe(true);
  });

  it("/otel-status warns when no session started", async () => {
    const { commands, registerCommand } = makePi();
    registerOtelCommands({ registerCommand } as never, {
      getConfig: () => null,
      getSdk: () => null,
    });
    const ctx = makeCtx();
    await commands.get("otel-status")!.handler("", ctx);
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      "pi-otel: not active (no session started).",
      "warning",
    );
  });

  it("/otel-status reports config and export stats", async () => {
    const { commands, registerCommand } = makePi();
    registerOtelCommands({ registerCommand } as never, {
      getConfig: () => DEFAULT_CONFIG,
      getSdk: () =>
        ({
          getStats: () => ({
            exportedSpans: 3,
            exportedDataPoints: 12,
            lastError: undefined,
          }),
        }) as never,
    });
    const ctx = makeCtx();
    await commands.get("otel-status")!.handler("", ctx);
    const msg = ctx.ui.notify.mock.calls[0]![0] as string;
    expect(msg).toContain("enabled: true");
    expect(msg).toContain("endpoint: http://localhost:4318");
    expect(msg).toContain("service.name: pi");
    expect(msg).toContain("capture: prompts=false");
    expect(msg).toContain("exported spans: 3");
    expect(msg).toContain("exported data points: 12");
    expect(msg).toContain("last export error: none");
  });

  it("/otel-flush warns when no SDK started", async () => {
    const { commands, registerCommand } = makePi();
    registerOtelCommands({ registerCommand } as never, {
      getConfig: () => DEFAULT_CONFIG,
      getSdk: () => null,
    });
    const ctx = makeCtx();
    await commands.get("otel-flush")!.handler("", ctx);
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      "pi-otel: not active (no SDK started).",
      "warning",
    );
  });

  it("/otel-flush force-flushes and reports", async () => {
    const forceFlush = vi.fn().mockResolvedValue(undefined);
    const { commands, registerCommand } = makePi();
    registerOtelCommands({ registerCommand } as never, {
      getConfig: () => DEFAULT_CONFIG,
      getSdk: () => ({ forceFlush }) as never,
    });
    const ctx = makeCtx();
    await commands.get("otel-flush")!.handler("", ctx);
    expect(forceFlush).toHaveBeenCalled();
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      "pi-otel: flush complete.",
      "info",
    );
  });
});
