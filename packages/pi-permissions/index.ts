import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { loadConfig } from "./src/config.js";
import { registerGuards } from "./src/guards.js";
import { ApprovalCache } from "./src/lib/approval-cache.js";

export default function (pi: ExtensionAPI) {
  const config = loadConfig(process.cwd());
  const store = new ApprovalCache();
  registerGuards(pi, config, store);
}
