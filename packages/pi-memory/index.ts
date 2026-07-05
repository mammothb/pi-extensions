import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerBeforeCompactHook } from "./src/before-compact.js";
import { scaffoldSettings } from "./src/lib/compact/settings.js";
import { registerMmCompactCommand } from "./src/mm-compact.js";
import { registerMmRecallCommand } from "./src/mm-recall.js";
import { registerRecallTool } from "./src/recall-tool.js";

export default (pi: ExtensionAPI) => {
  scaffoldSettings();
  registerBeforeCompactHook(pi);
  registerMmCompactCommand(pi);
  registerMmRecallCommand(pi);
  registerRecallTool(pi);
};
