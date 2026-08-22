/**
 * `/otel-status` and `/otel-flush` commands.
 *
 * Both report through `ctx.ui.notify` — never through the OTel SDK itself.
 * A broken exporter must not be the thing reporting its own failure.
 */
import type {
  ExtensionAPI,
  ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import type { ResolvedConfig } from "../config.js";
import type { OtelSdk } from "../sdk.js";

/** Accessors into the extension's per-session state. */
export interface OtelCommandDeps {
  getConfig(): ResolvedConfig | null;
  getSdk(): OtelSdk | null;
  getSdkError(): string | null;
}

/** Reject `promise` if it does not settle within `ms`. */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`timeout after ${ms}ms`)),
      ms,
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

function formatCapture(config: ResolvedConfig): string {
  const c = config.capture;
  return [
    `prompts=${c.prompts}`,
    `toolArgs=${c.toolArgs}`,
    `toolResults=${c.toolResults}`,
    `providerPayloads=${c.providerPayloads}`,
  ].join(" ");
}

function formatStatus(
  config: ResolvedConfig,
  sdk: OtelSdk | null,
  sdkError: string | null,
): string {
  const stats = sdk?.getStats();
  return [
    `enabled: ${config.enabled}`,
    `endpoint: ${config.endpoint}`,
    `  traces:  ${config.tracesEndpoint}`,
    `  metrics: ${config.metricsEndpoint}`,
    `service.name: ${config.serviceName}`,
    `sampleRatio: ${config.sampleRatio}`,
    `capture: ${formatCapture(config)}`,
    `summaryLength: ${config.summaryLength}`,
    `exported spans: ${stats?.exportedSpans ?? 0}`,
    `exported data points: ${stats?.exportedDataPoints ?? 0}`,
    `last export error: ${stats?.lastError ?? "none"}`,
    `init error: ${sdkError ?? "none"}`,
  ].join("\n");
}

/** Register `/otel-status` and `/otel-flush`. */
export function registerOtelCommands(
  pi: ExtensionAPI,
  deps: OtelCommandDeps,
): void {
  pi.registerCommand("otel-status", {
    description: "Show pi-otel resolved config and export stats",
    async handler(_args: string, ctx: ExtensionCommandContext) {
      const config = deps.getConfig();
      if (!config) {
        ctx.ui.notify("pi-otel: not active (no session started).", "warning");
        return;
      }
      ctx.ui.notify(
        formatStatus(config, deps.getSdk(), deps.getSdkError()),
        "info",
      );
    },
  });

  pi.registerCommand("otel-flush", {
    description: "Force-flush pending pi-otel spans and metrics",
    async handler(_args: string, ctx: ExtensionCommandContext) {
      const sdk = deps.getSdk();
      if (!sdk) {
        ctx.ui.notify("pi-otel: not active (no SDK started).", "warning");
        return;
      }
      try {
        await withTimeout(sdk.forceFlush(), 10_000);
        ctx.ui.notify("pi-otel: flush complete.", "info");
      } catch (err) {
        ctx.ui.notify(
          `pi-otel: flush failed: ${
            err instanceof Error ? err.message : String(err)
          }`,
          "warning",
        );
      }
    },
  });
}
