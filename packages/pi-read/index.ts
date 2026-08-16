/**
 * Smart read for pi — AST outlining for large files, delegation for the rest.
 *
 * Overrides the built-in `read` tool by spreading `createReadToolDefinition`
 * and overriding only `execute`. Every non-outline path (small files, images,
 * binary files, unsupported/disabled languages, offset/limit drill-downs,
 * missing files, directories) delegates to the original read implementation,
 * preserving its exact output shape — image attachments and truncation
 * signaling included.
 *
 * tree-sitter grammars (WASM) are optionalDependencies: when absent, large
 * files fall through to the original read (truncate + "continue" markers).
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { loadConfig } from "./src/config.js";
import { createSmartReadTool } from "./src/read-tool.js";

export default function (pi: ExtensionAPI) {
  const configCache = new Map<string, ReturnType<typeof loadConfig>>();

  const getConfig = (cwd: string) => {
    let config = configCache.get(cwd);
    if (config === undefined) {
      config = loadConfig(cwd);
      configCache.set(cwd, config);
    }
    return config;
  };

  pi.registerTool(createSmartReadTool({ getConfig }));

  pi.on("session_start", async (_event, ctx) => {
    // Reload config each session so project/global changes take effect.
    configCache.delete(ctx.cwd);
  });
}
