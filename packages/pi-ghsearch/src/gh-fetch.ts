import type {
  ExtensionAPI,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  formatSize,
} from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { firstTextBlock, renderError } from "@mammothb/pi-shared";
import { Type } from "typebox";
import type { GhSearchConfig } from "./config.js";
import { decodeGitHubContent } from "./lib/decode-contents.js";
import { detectFetchType } from "./lib/fetch-type-detector.js";
import { applyTruncation } from "./lib/truncation.js";
import type { GhFetchDetails } from "./lib/types.js";
import { githubUrlToEndpoint } from "./lib/url-to-endpoint.js";

const GhFetchParams = Type.Object({
  url: Type.String({
    description:
      "GitHub URL to fetch. Supports github.com web URLs and api.github.com API URLs.",
  }),
});

export function createGhFetchTool(
  pi: ExtensionAPI,
  config: GhSearchConfig,
): ToolDefinition<typeof GhFetchParams, GhFetchDetails> {
  return {
    name: "gh_fetch",
    label: "GitHub Fetch",
    description:
      "Fetch full content of a GitHub resource (file, issue, PR, discussion, etc.) via `gh api`. " +
      "Use after gh_search to drill into specific items. Accepts github.com and api.github.com URLs; " +
      "converts web URLs to REST endpoints automatically. Returns pretty-printed JSON for API responses, " +
      "raw text otherwise. Use instead of raw `gh api` commands. " +
      `Truncated to ${DEFAULT_MAX_LINES} lines/${formatSize(DEFAULT_MAX_BYTES)}; full output saved to temp file.`,
    promptSnippet: "Fetch full GitHub resource details by URL",
    promptGuidelines: [
      "gh_fetch: file contents from the GitHub Contents API are automatically decoded inline — no separate base64 decode step is needed.",
      "gh_fetch: large responses are truncated; the full output path is in result details. Use bash read to access it if needed.",
      "Do not use gh_fetch for URLs that are not from github.com, gist.github.com, or api.github.com.",
    ],
    parameters: GhFetchParams,
    renderCall(args, theme, _ctx) {
      const url = args.url;
      let shortUrl = url;
      try {
        const parsed = new URL(url);
        if (parsed.hostname === "github.com") {
          shortUrl = parsed.pathname.replace(/^\/|\/$/g, "");
        } else if (parsed.hostname === "api.github.com") {
          shortUrl = parsed.pathname.replace(/^\/|\/$/g, "");
        }
      } catch {
        // invalid URL — keep raw value
      }

      let text = theme.fg("toolTitle", theme.bold("gh_fetch "));
      text += theme.fg("muted", shortUrl);

      try {
        const endpoint = githubUrlToEndpoint(url);
        text += `  ${theme.fg("muted", "->")}  ${theme.fg("muted", endpoint)}`;
      } catch {
        // URL can't be converted — omit endpoint
      }

      return new Text(text, 0, 0);
    },
    renderResult(result, { expanded }, theme, ctx) {
      const details = result.details as GhFetchDetails | undefined;
      const rawText = firstTextBlock(result);

      if (ctx.isError) {
        return renderError(rawText, theme);
      }

      if (expanded) {
        return new Text(rawText, 0, 0);
      }

      const parsed = details?.parsed;
      const { type, summary } = detectFetchType(parsed);

      let text: string;
      if (summary) {
        text =
          type === "unknown" && details?.endpoint
            ? theme.fg("muted", `${details.endpoint} — ${summary}`)
            : theme.fg("muted", summary);
      } else {
        text = theme.fg(
          "muted",
          details?.endpoint
            ? `${details.endpoint} — empty response`
            : "empty response",
        );
      }

      if (details?.truncation) {
        text +=
          "\n" +
          theme.fg(
            "warning",
            `! truncated (${formatSize(details.truncation.outputBytes)} of ${formatSize(details.truncation.totalBytes)})`,
          );
      }

      return new Text(text, 0, 0);
    },
    execute: async (_toolCallId, params, _signal, _onUpdate, ctx) => {
      const endpoint = githubUrlToEndpoint(params.url);
      const args = ["api", endpoint];

      const result = await pi.exec("gh", args, {
        cwd: ctx.cwd,
        signal: ctx.signal,
        timeout: config.timeoutMs,
      });

      if (result.code !== 0) {
        const message =
          result.stderr.trim() ||
          result.stdout.trim() ||
          `gh exited ${result.code}`;
        throw new Error(message);
      }

      const raw = result.stdout.trim() || "(no output)";
      let parsed: unknown;
      let text = raw;
      try {
        parsed = JSON.parse(raw);
        text = JSON.stringify(parsed, null, 2);
      } catch {
        // not JSON — keep raw text
      }

      // Auto-decode base64 content from GitHub Contents API responses
      const decodedContent = decodeGitHubContent(parsed);
      if (decodedContent !== null) {
        const filePath = (parsed as Record<string, unknown>).path ?? "unknown";
        text += `\n\n--- Decoded file content (${filePath}) ---\n${decodedContent}`;
      }

      const {
        text: resultText,
        truncation,
        fullOutputPath,
      } = await applyTruncation(text);

      return {
        content: [{ type: "text", text: resultText }],
        details: {
          command: ["gh", ...args],
          exitCode: result.code,
          parsed,
          stderr: result.stderr.trim() || undefined,
          truncation,
          fullOutputPath,
          endpoint,
        },
      };
    },
  };
}
