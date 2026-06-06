import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createWebfetchTool } from "./src/webfetch.js";

export default function (pi: ExtensionAPI) {
  pi.registerTool(createWebfetchTool());
}
