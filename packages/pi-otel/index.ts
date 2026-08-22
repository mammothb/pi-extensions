/**
 * @mammothb/pi-otel — OpenTelemetry traces + metrics for the pi coding harness.
 *
 * Phase 1 scaffold: the factory does nothing at registration time. The SDK
 * lifecycle (init / start / shutdown) is wired but not yet invoked here —
 * that lands in Phase 2 alongside the event handlers that consume pi's
 * session/turn/tool lifecycle.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function piOtelExtension(_pi: ExtensionAPI): void {
  // Intentionally empty for Phase 1. The factory is invoked once per process
  // startup, including invocations that never start a session (e.g. `pi
  // --help`); we must not touch the OTel SDK here. Session lifecycle hooks
  // will be registered in Phase 2 and will call `initSdk`/`startSdk`/
  // `shutdownSdk` from `./src/sdk.ts`.
}
