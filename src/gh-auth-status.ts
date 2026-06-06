import type {
  ExtensionAPI,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import type { GhSearchConfig } from "./config.js";
import type { GhAuthStatusDetails } from "./lib/types.js";

const GhAuthStatusParams = Type.Object({
  hostname: Type.Optional(
    Type.String({ description: "GitHub hostname. Defaults to github.com." }),
  ),
  active: Type.Optional(
    Type.Boolean({ description: "Show active account only." }),
  ),
});

export function createGhAuthStatusTool(
  pi: ExtensionAPI,
  config: GhSearchConfig,
): ToolDefinition<typeof GhAuthStatusParams, GhAuthStatusDetails> {
  return {
    name: "gh_auth_status",
    label: "GitHub Auth Status",
    description:
      "Check GitHub CLI authentication status without exposing tokens. " +
      "Use to diagnose failed gh_search/gh_fetch calls. " +
      "Returns hostname and username on success; diagnostic output when not authenticated. " +
      "Supports --hostname for GHE and --active for active account only.",
    promptSnippet:
      "Check gh authentication status. Use when gh_search or gh_fetch fails.",
    promptGuidelines: [
      "On session start, if gh_auth_status reports 'not authenticated', tell the user to run `gh auth login`.",
      "Do not call gh_auth_status proactively before every gh_search — only when you suspect auth issues.",
    ],
    parameters: GhAuthStatusParams,
    renderCall(_args, theme, _context) {
      return new Text(
        theme.fg("toolTitle", theme.bold("gh_auth_status")),
        0,
        0,
      );
    },
    renderResult(result, _options, theme, context) {
      const details = result.details as GhAuthStatusDetails | undefined;
      const raw =
        result.content[0]?.type === "text" ? result.content[0].text : "";

      if (context.isError) {
        return new Text(theme.fg("error", raw), 0, 0);
      }

      if (details?.authenticated) {
        const match = raw.match(/Logged in to (\S+) as (\S+)/);
        const hostname = match?.[1] ?? "github.com";
        const user = match?.[2] ?? "unknown";
        return new Text(
          theme.fg("muted", `Authenticated to ${hostname} as ${user}`),
          0,
          0,
        );
      }

      let text = `${theme.fg("error", "!")} ${theme.fg("warning", "Not authenticated")}`;
      if (raw && raw !== "(no output)") {
        text += `\n  ${theme.fg("dim", raw)}`;
      }
      return new Text(text, 0, 0);
    },
    execute: async (_toolCallId, params, _signal, _onUpdate, ctx) => {
      const args = ["auth", "status"];
      if (params.hostname) {
        args.push("--hostname", params.hostname);
      }
      if (params.active) {
        args.push("--active");
      }

      const result = await pi.exec("gh", args, {
        cwd: ctx.cwd,
        signal: ctx.signal,
        timeout: config.timeoutMs,
      });

      // Tolerate non-zero exit — unauthenticated is a normal state to report on
      const text =
        result.stdout.trim() || result.stderr.trim() || "(no output)";

      return {
        content: [{ type: "text", text }],
        details: {
          command: ["gh", ...args],
          exitCode: result.code,
          authenticated: result.code === 0,
          stderr: result.stderr.trim() || undefined,
        },
      };
    },
  };
}
