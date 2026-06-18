/**
 * Hashline anchoring for pi — content-addressed read/edit with stale-edit
 * protection.
 *
 * To activate, load this extension:
 *   pi -e ./index.ts
 *
 * @module
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { createEditTool } from "./src/edit";
import { createGrepTool } from "./src/grep";
import { injectPrompt } from "./src/prompt";
import { createReadTool } from "./src/read";
import { InMemorySnapshotStore } from "./src/snapshots";
import { createWriteTool } from "./src/write";

export * from "./src/format";
export * from "./src/snapshots";
export * from "./src/types";

export default function (pi: ExtensionAPI) {
  const snapshots = new InMemorySnapshotStore();

  pi.registerTool(createReadTool(snapshots));
  pi.registerTool(createEditTool(snapshots));
  pi.registerTool(createWriteTool(snapshots));
  pi.registerTool(createGrepTool(snapshots));

  // Inject the hashline grammar prompt before each agent turn.
  pi.on("context", (event, _ctx) => {
    injectPrompt(event.messages);
  });
}
