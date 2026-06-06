import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { loadConfig } from "./src/config";
import {
  registerInstance,
  unregisterInstance,
} from "./src/lib/searxng-manager";
import { createWebsearchTool } from "./src/websearch";

export default function (pi: ExtensionAPI) {
  let registered = false;
  let searxngActive = false;
  let searxngScript: string | undefined;

  pi.on("session_start", async (_event, ctx) => {
    const config = loadConfig(ctx.cwd);
    pi.registerTool(createWebsearchTool(config));

    searxngActive = config.provider === "searxng";
    if (searxngActive) {
      searxngScript = config.searxng.script;
      await registerInstance(searxngScript);
    }

    if (!registered) {
      registered = true;
      const providerDetail =
        config.provider === "searxng" ? config.searxng.url : config.exaMcp.url;
      ctx.ui.notify(
        `websearch: provider ${config.provider} (${providerDetail})`,
        "info",
      );
    }
  });

  pi.on("session_shutdown", async (event, _ctx) => {
    if (event.reason === "quit" && searxngActive) {
      await unregisterInstance(searxngScript);
    }
  });
}
