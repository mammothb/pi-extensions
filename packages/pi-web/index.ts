import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { loadConfig, resolveUnslothEngines } from "./src/config.js";
import {
  getInstancesDir,
  inspectShutdownState,
  registerInstance,
  unregisterInstance,
} from "./src/lib/searxng-manager.js";
import { createWebfetchTool } from "./src/webfetch.js";
import { createWebsearchTool } from "./src/websearch.js";

function describeProvider(config: ReturnType<typeof loadConfig>): string {
  switch (config.provider) {
    case "searxng":
      return config.searxng.url;
    case "exa-mcp":
      return config.exaMcp.url;
    case "unsloth":
      return `engines: ${resolveUnslothEngines(config.unsloth).join(",")}`;
  }
}

/**
 * Set up the SearXNG Docker lifecycle for the current pi session.
 *
 * Checks for unclean shutdowns from previous sessions, starts the
 * container (fire-and-forget), and returns a shutdown handle that
 * stops it when pi exits.
 */
function setupSearxng(scriptPath: string | undefined): {
  shutdown: () => void;
} {
  const instancesDir = getInstancesDir();

  // Check for unclean shutdowns from previous sessions
  const health = inspectShutdownState(instancesDir);
  if (health.uncleanCount > 0) {
    console.warn(
      `pi-web: ${health.uncleanCount} unclean shutdown(s) detected. ` +
        `SearXNG containers may still be running from a previous session.`,
    );
    health.cleanup();
  } else if (health.stillRunning > 0) {
    console.warn(
      `pi-web: ${health.stillRunning} shutdown(s) still in progress from a previous session.`,
    );
  }

  // Fire-and-forget: don't block pi startup waiting for Docker.
  // The provider retries connection errors until SearXNG is ready.
  registerInstance(scriptPath).catch((err) => {
    console.error(`pi-web: failed to start SearXNG: ${err}`);
  });

  return {
    shutdown: () => {
      // Fire-and-forget: don't block pi exit waiting for Docker.
      // The child process (docker compose down) keeps running after pi exits.
      unregisterInstance(scriptPath).catch((err) => {
        console.error(`pi-web: failed to stop SearXNG: ${err}`);
      });
    },
  };
}

export default function (pi: ExtensionAPI) {
  // ── WebFetch tool (zero-config) ──────────────────────────────────────

  pi.registerTool(createWebfetchTool());

  // ── WebSearch tool + SearXNG lifecycle (config-driven) ───────────────

  let searxngShutdown: (() => void) | undefined;

  pi.on("session_start", async (_event, ctx) => {
    const config = loadConfig(ctx.cwd);
    pi.registerTool(createWebsearchTool(config));

    if (config.provider === "searxng") {
      searxngShutdown = setupSearxng(config.searxng.script).shutdown;
    }

    ctx.ui.notify(
      `Web: fetch + search ready (search: ${config.provider} @ ${describeProvider(config)})`,
      "info",
    );
  });

  pi.on("session_shutdown", (event, _ctx) => {
    if (event.reason === "quit" && searxngShutdown) {
      searxngShutdown();
    }
  });
}
