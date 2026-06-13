import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createAskTool } from "./src/ask.js";

export default function (pi: ExtensionAPI) {
  pi.registerTool(createAskTool(pi));
}
