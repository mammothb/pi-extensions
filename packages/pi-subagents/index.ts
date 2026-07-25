import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createSubagentTool } from "./src/subagent-tool.js";

export default function subagentsExtension(pi: ExtensionAPI) {
  pi.registerTool(createSubagentTool());
}
