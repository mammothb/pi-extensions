/**
 * Hashline anchoring for pi — content-addressed read/edit with stale-edit
 * protection.
 *
 * To activate, load this extension:
 *   pi -e ./index.ts
 *
 * @module
 */

import { createRequire } from "node:module";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { createEditTool } from "./src/edit.js";
import { createGrepTool } from "./src/grep.js";
import { InMemorySnapshotStore } from "./src/lib/hashline/snapshots.js";
import type { BlockResolver } from "./src/lib/hashline/types.js";
import { injectPrompt } from "./src/prompt.js";
import { createReadTool } from "./src/read.js";
import { createWriteTool } from "./src/write.js";

export * from "./src/lib/hashline/format.js";
export * from "./src/lib/hashline/snapshots.js";
export * from "./src/lib/hashline/types.js";

/** Lazily load tree-sitter block resolver — returns undefined if unavailable. */
function loadBlockResolver(): BlockResolver | undefined {
  try {
    const _require = createRequire(import.meta.url);
    const mod = _require("./src/lib/tree-sitter-block-resolver.js") as {
      createTreeSitterBlockResolver: () => BlockResolver;
    };
    return mod.createTreeSitterBlockResolver();
  } catch {
    return undefined;
  }
}

export default function (pi: ExtensionAPI) {
  const snapshots = new InMemorySnapshotStore();
  const blockResolver = loadBlockResolver();

  pi.registerTool(createReadTool(snapshots));
  pi.registerTool(createEditTool(snapshots, blockResolver));
  pi.registerTool(createWriteTool(snapshots));
  pi.registerTool(createGrepTool(snapshots));

  // Inject the hashline grammar prompt before each agent turn.
  pi.on("context", (event, _ctx) => {
    injectPrompt(event.messages);
  });
}
