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
      getSdkError: () => null,
    });
    expect(commands.has("otel-status")).toBe(true);
    expect(commands.has("otel-flush")).toBe(true);
  });

  it("/otel-status warns when no session started", async () => {
    const { commands, registerCommand } = makePi();
    registerOtelCommands({ registerCommand } as never, {
      getConfig: () => null,
      getSdk: () => null,
      getSdkError: () => null,
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
      getSdkError: () => null,
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
    expect(msg).toContain("init error: none");
  });

  it("/otel-status never leaks header secrets into the notification text", async () => {
    const { commands, registerCommand } = makePi();
    const secret = "super-secret-value-XYZ";
    registerOtelCommands({ registerCommand } as never, {
      getConfig: () => ({
        ...DEFAULT_CONFIG,
        headers: { "X-API-Key": secret },
      }),
      getSdk: () => null,
      getSdkError: () => null,
    });
    const ctx = makeCtx();
    await commands.get("otel-status")!.handler("", ctx);
    const msg = ctx.ui.notify.mock.calls[0]![0] as string;
    expect(msg).toContain("enabled: true");
    // The resolved secret value must never appear in the status text.
    expect(msg).not.toContain(secret);
  });

  it("/otel-status reports a non-null init error", async () => {
    const { commands, registerCommand } = makePi();
    registerOtelCommands({ registerCommand } as never, {
      getConfig: () => DEFAULT_CONFIG,
      getSdk: () => null,
      getSdkError: () => "ECONNREFUSED 127.0.0.1:4318",
    });
    const ctx = makeCtx();
    await commands.get("otel-status")!.handler("", ctx);
    const msg = ctx.ui.notify.mock.calls[0]![0] as string;
    expect(msg).toContain("init error: ECONNREFUSED 127.0.0.1:4318");
  });

  it("/otel-flush warns when no SDK started", async () => {
    const { commands, registerCommand } = makePi();
    registerOtelCommands({ registerCommand } as never, {
      getConfig: () => DEFAULT_CONFIG,
      getSdk: () => null,
      getSdkError: () => null,
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
      getSdkError: () => null,
    });
    const ctx = makeCtx();
    await commands.get("otel-flush")!.handler("", ctx);
    expect(forceFlush).toHaveBeenCalled();
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      "pi-otel: flush complete.",
      "info",
    );
  });

  it("/otel-flush reports a failure without a success notice", async () => {
    const forceFlush = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    const { commands, registerCommand } = makePi();
    registerOtelCommands({ registerCommand } as never, {
      getConfig: () => DEFAULT_CONFIG,
      getSdk: () => ({ forceFlush }) as never,
      getSdkError: () => null,
    });
    const ctx = makeCtx();
    await commands.get("otel-flush")!.handler("", ctx);
    expect(forceFlush).toHaveBeenCalled();
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      "pi-otel: flush failed: ECONNREFUSED",
      "warning",
    );
    expect(ctx.ui.notify).not.toHaveBeenCalledWith(
      "pi-otel: flush complete.",
      "info",
    );
  });
});
