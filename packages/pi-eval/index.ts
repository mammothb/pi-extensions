import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createEvalTool } from "./src/eval.js";

export default function (pi: ExtensionAPI) {
  pi.registerTool(createEvalTool());
}
