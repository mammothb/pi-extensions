import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerMmCompactCommand } from "./src/commands/mm-compact";
import { registerMmRecallCommand } from "./src/commands/mm-recall";
import { scaffoldSettings } from "./src/core/settings";
import { registerBeforeCompactHook } from "./src/hooks/before-compact";
import { registerRecallTool } from "./src/tools/recall";

export default (pi: ExtensionAPI) => {
  scaffoldSettings();
  registerBeforeCompactHook(pi);
  registerMmCompactCommand(pi);
  registerMmRecallCommand(pi);
  registerRecallTool(pi);
};
