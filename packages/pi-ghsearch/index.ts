import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { loadConfig } from "./src/config.js";
import { createGhAuthStatusTool } from "./src/gh-auth-status.js";
import { createGhFetchTool } from "./src/gh-fetch.js";
import { createGhSearchTool } from "./src/gh-search.js";

export default async function (pi: ExtensionAPI) {
  const config = loadConfig(process.cwd());

  pi.registerTool(createGhSearchTool(pi, config));
  pi.registerTool(createGhAuthStatusTool(pi, config));
  pi.registerTool(createGhFetchTool(pi, config));

  // Hard-block bash gh commands when configured.
  // Only blocks the three subcommands that overlap with ghsearch tools;
  // gh repo clone, gh issue create, gh pr list, etc. pass through.
  // The extension's own pi.exec calls (session_start auth check) are NOT
  // model tool calls and are unaffected.
  if (config.banBashGh) {
    const blocked: Record<string, string> = {
      "gh search": "gh_search",
      "gh api": "gh_fetch",
      "gh auth": "gh_auth_status",
    };

    pi.on("tool_call", async (event) => {
      if (event.toolName !== "bash") {
        return;
      }

      const cmd =
        (event.input as { command?: string } | undefined)?.command ?? "";
      const trimmed = cmd.trim();

      for (const [prefix, replacement] of Object.entries(blocked)) {
        if (trimmed.startsWith(prefix)) {
          return {
            block: true,
            reason: `${prefix} is blocked by pi-ghsearch config. Use ${replacement} instead.`,
          };
        }
      }
      // gh repo clone, gh issue create, etc. — pass through
    });
  }

  pi.on("session_start", async (_event, ctx) => {
    const result = await pi.exec("gh", ["auth", "status"], {
      cwd: ctx.cwd,
      timeout: 10_000,
    });

    if (result.code !== 0) {
      const hint =
        result.stderr.trim() || result.stdout.trim() || "not authenticated";
      ctx.ui.setStatus("gh-auth", `! GitHub: ${hint}`);
    } else {
      ctx.ui.notify("GitHub: authenticated", "info");
    }
  });
}
