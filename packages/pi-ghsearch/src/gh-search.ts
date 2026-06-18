import { StringEnum } from "@earendil-works/pi-ai";
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
import { type Static, Type } from "typebox";
import type { GhSearchConfig } from "./config.js";
import { applyTruncation } from "./lib/truncation.js";
import type { GhSearchDetails } from "./lib/types.js";

const SEARCH_SCOPES = ["repos", "issues", "prs", "code", "commits"] as const;
const SORT_ORDERS = ["asc", "desc"] as const;
const ISSUE_PR_STATES = ["open", "closed"] as const;

const DEFAULT_FIELDS: Record<string, string> = {
  repos:
    "fullName,description,visibility,language,stargazersCount,forksCount,updatedAt,url",
  issues: "number,title,state,repository,author,labels,updatedAt,url",
  prs: "number,title,state,repository,author,isDraft,updatedAt,url",
  commits: "sha,repository,author,commit,url",
  // code search does not support --json; raw output is returned instead
};

const GhSearchParamsSchema = Type.Object({
  scope: StringEnum(SEARCH_SCOPES, {
    description: "Search scope: repos, issues, prs, code, or commits.",
  }),
  query: Type.String({
    description: "Search query string. Same syntax as gh search.",
  }),
  limit: Type.Optional(Type.Number({ description: "Maximum items to fetch." })),
  fields: Type.Optional(
    Type.String({
      description:
        "Comma-separated gh --json fields. Defaults per scope chosen for agent-friendly output.",
    }),
  ),
  owner: Type.Optional(
    Type.Array(Type.String(), {
      description: "Filter by organization or user owner.",
    }),
  ),
  repo: Type.Optional(
    Type.Array(Type.String(), {
      description: "Filter by repository.",
    }),
  ),
  language: Type.Optional(
    Type.String({ description: "Filter by programming language." }),
  ),
  state: Type.Optional(
    StringEnum(ISSUE_PR_STATES, {
      description: "Filter by state (issues and prs only).",
    }),
  ),
  author: Type.Optional(
    Type.String({ description: "Filter by author (issues, prs, commits)." }),
  ),
  assignee: Type.Optional(
    Type.String({ description: "Filter by assignee (issues and prs only)." }),
  ),
  label: Type.Optional(
    Type.Array(Type.String(), {
      description: "Filter by label (issues and prs only).",
    }),
  ),
  sort: Type.Optional(
    Type.String({ description: "Sort field (scope-dependent)." }),
  ),
  order: Type.Optional(StringEnum(SORT_ORDERS, { description: "Sort order." })),
  jq: Type.Optional(
    Type.String({
      description:
        "jq expression to filter --json output. Ignored for code scope.",
    }),
  ),
});

type GhSearchParams = Static<typeof GhSearchParamsSchema>;

function addOptionalFlag(
  args: string[],
  flag: string,
  value: string | undefined,
): void {
  if (value !== undefined) {
    args.push(flag, value);
  }
}

function addRepeated(
  args: string[],
  flag: string,
  values: string[] | undefined,
): void {
  for (const value of values ?? []) {
    args.push(flag, value);
  }
}

/** Build a one-line preview of the first search result for collapsed display. */
function formatFirstItem(
  scope: string,
  item: Record<string, unknown> | undefined,
): string {
  if (!item) return "";

  switch (scope) {
    case "repos": {
      const fullName = String(item.fullName ?? "?");
      const stars = item.stargazersCount ?? "?";
      const lang = item.language ?? "no lang";
      return `${fullName} (stars: ${stars}, ${lang})`;
    }
    case "issues": {
      const num = item.number ?? "?";
      const title = String(item.title ?? "");
      const state = item.state ?? "?";
      return `#${num} ${title} (${state})`;
    }
    case "prs": {
      const num = item.number ?? "?";
      const title = String(item.title ?? "");
      const draft = item.isDraft;
      const label = draft ? "draft" : (item.state ?? "?");
      return `#${num} ${title} (${label})`;
    }
    case "commits": {
      const sha = String(item.sha ?? "").slice(0, 7);
      const commit = item.commit as Record<string, unknown> | undefined;
      const msg = String(commit?.message ?? "").split("\n")[0] ?? "";
      return `${sha} ${msg}`;
    }
    default:
      return String(item.fullName ?? item.number ?? item.sha ?? "?");
  }
}

export function createGhSearchTool(
  pi: ExtensionAPI,
  config: GhSearchConfig,
): ToolDefinition<typeof GhSearchParamsSchema, GhSearchDetails> {
  return {
    name: "gh_search",
    label: "GitHub Search",
    description:
      "Search GitHub repos, issues, PRs, code, or commits via `gh search` with structured JSON output. " +
      "Do NOT use raw `gh search` in bash — this tool provides typed parameters, --json defaults, " +
      "and automatic truncation. Supports filters: owner, repo, language, state, author, assignee, " +
      "labels, sort, jq. Code scope returns raw text; all others return JSON. " +
      `Output truncated to ${DEFAULT_MAX_LINES} lines or ${formatSize(DEFAULT_MAX_BYTES)}; full output spills to temp file.`,
    promptSnippet: "Search GitHub repos, issues, PRs, code, and commits",
    promptGuidelines: [
      "gh_search: code scope uses separate rate limits — always quote the full query string to avoid shell escaping issues.",
      "gh_search: for broad searches use fewer filters; for precise lookups combine owner, repo, language, and label.",
      "Use gh_auth_status to diagnose auth failures; use gh_fetch to drill into specific URLs from search results.",
    ],
    parameters: GhSearchParamsSchema,
    renderCall(args, theme, _ctx) {
      const text =
        `${theme.fg("toolTitle", theme.bold("gh_search"))} ` +
        `${theme.fg("muted", args.scope)} ` +
        `${theme.fg("muted", args.query)}`;
      return new Text(text, 0, 0);
    },
    renderResult(result, { expanded }, theme, ctx) {
      const details = result.details as GhSearchDetails | undefined;
      const scope: string = ctx.args?.scope ?? "results";
      const isCode = scope === "code";
      const parsed = details?.parsed;
      const rawText = firstTextBlock(result);

      // Handle errors
      if (ctx.isError) {
        return renderError(rawText, theme);
      }

      // Expanded: show raw output as sent to LLM
      if (expanded) {
        return new Text(rawText, 0, 0);
      }

      // Code scope: count file headers (non-indented lines), show full output
      if (isCode || !Array.isArray(parsed)) {
        const lines = rawText.split("\n");
        const fileCount = lines.filter(
          (l) => l.length > 0 && l[0] !== " " && l[0] !== "\t",
        ).length;
        let text = `${theme.fg("accent", String(fileCount))} ${theme.fg("muted", "files")}`;
        if (rawText && rawText !== "(no output)") {
          text += `\n${theme.fg("toolOutput", rawText)}`;
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
      }

      // JSON scopes: count + first-item preview
      const count = parsed.length;
      if (count === 0) {
        return new Text(theme.fg("muted", `— no ${scope} found`), 0, 0);
      }

      const first = parsed[0] as Record<string, unknown> | undefined;
      const preview = formatFirstItem(scope, first);
      // Singularize scope when count is 1 ("repos" -> "repo", etc.)
      const scopeLabel = count === 1 ? scope.replace(/s$/, "") : scope;

      let text = `${theme.fg("accent", String(count))} ${theme.fg("muted", scopeLabel)} — ${preview}`;
      if (count > 1) {
        text += `, ${theme.fg("muted", `+${count - 1} more`)}`;
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
    execute: async (
      _toolCallId,
      params: GhSearchParams,
      _signal,
      _onUpdate,
      ctx,
    ) => {
      const args = ["search", params.scope, params.query];

      // --json is not supported for code search; --jq requires --json
      if (params.scope !== "code") {
        args.push(
          "--json",
          params.fields ?? DEFAULT_FIELDS[params.scope] ?? "",
        );
        addOptionalFlag(args, "--jq", params.jq);
      }
      const owner = config.organization ? [config.organization] : params.owner;
      addRepeated(args, "--owner", owner);

      const limit = params.limit ?? config.defaults.limit;
      args.push("--limit", String(limit));
      addRepeated(args, "--repo", params.repo);
      addOptionalFlag(args, "--language", params.language);
      if (params.state) {
        args.push("--state", params.state);
      }
      addOptionalFlag(args, "--author", params.author);
      addOptionalFlag(args, "--assignee", params.assignee);
      addRepeated(args, "--label", params.label);
      addOptionalFlag(args, "--sort", params.sort);
      if (params.order) {
        args.push("--order", params.order);
      }

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
        // not JSON — keep raw text (e.g. code search results)
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
        },
      };
    },
  };
}
