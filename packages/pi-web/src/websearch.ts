import type { Theme, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Container, Spacer, Text } from "@earendil-works/pi-tui";
import {
  extractTextContent,
  getCollapseHint,
  getExpandHint,
  PREVIEW_LINES,
  renderError,
} from "@mammothb/pi-shared";
import type { WebsearchConfig } from "./config";
import { createProvider } from "./lib/providers";
import type { SearchArgs } from "./lib/types";
import { WebsearchParameters } from "./lib/types";

interface WebsearchDetails {
  query: string;
}

function renderExpandableResult(
  details: WebsearchDetails,
  textContent: string,
  expanded: boolean,
  theme: Theme,
): Container {
  const container = new Container();

  const title = details.query;
  container.addChild(
    new Text(
      theme.fg("syntaxKeyword", "query: ") + theme.fg("syntaxString", title),
    ),
  );

  if (!textContent) {
    return container;
  }

  container.addChild(new Spacer(1));

  if (expanded) {
    container.addChild(new Text(textContent));
    container.addChild(new Spacer(1));
    container.addChild(new Text(getCollapseHint(theme)));
  } else {
    const lines = textContent
      .split("\n")
      .filter(
        (line, index, arr) =>
          line.length > 0 || index === 0 || index < arr.length - 1,
      );
    const previewLines = lines.slice(0, PREVIEW_LINES);
    const remaining = Math.max(0, lines.length - previewLines.length);

    const preview = previewLines.join("\n");
    container.addChild(new Text(preview));

    if (remaining > 0) {
      container.addChild(new Spacer(1));
      container.addChild(new Text(getExpandHint(theme, remaining)));
    }
  }
  return container;
}

export function createWebsearchTool(
  config: WebsearchConfig,
): ToolDefinition<typeof WebsearchParameters, WebsearchDetails> {
  const year = new Date().getFullYear();
  const { defaults } = config;
  const provider = createProvider(config);

  const TOOL_NAME = "WebSearch";
  const usageNotes = provider.usageNotes;

  return {
    name: TOOL_NAME,
    label: "Web Search",
    description: `- Search the web using the session's web search provider - performs real-time web searches and can scrape content from specific URLs.
- Provides up-to-date information for current events and recent data.
- Supports configurable result counts and returns the content from the most relevant websites.
- Use this tool for accessing information beyond knowledge cutoff.
- Searches are performed automatically within a single API call.

Usage notes:${usageNotes}
  - Configurable context length for optimal LLM integration`,
    promptSnippet: "Search the web",
    promptGuidelines: [
      `Use ${TOOL_NAME} to find current information, documentation, or answers that require up-to-date web data. Always cite sources from search results.`,
      `${TOOL_NAME}: the current year is ${year}. Use this year when searching for recent information or current events.`,
    ],
    parameters: WebsearchParameters,
    execute: async (_toolCallId, params, signal, _onUpdate, _ctx) => {
      const args: SearchArgs = {
        query: params.query,
        type: params.type ?? defaults.type,
        numResults: params.numResults ?? defaults.numResults,
        livecrawl: params.livecrawl ?? defaults.livecrawl,
        contextMaxCharacters:
          params.contextMaxCharacters ?? defaults.contextMaxCharacters,
      };

      try {
        const result = await provider.search(args, signal);

        return {
          content: [
            {
              type: "text",
              text:
                result ??
                "No search results found. Please try a different query.",
            },
          ],
          details: { query: params.query },
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new Error(message);
      }
    },
    renderCall: (args, theme, _ctx) => {
      return new Text(
        theme.fg("toolTitle", theme.bold(`${TOOL_NAME} `)) +
          theme.fg("muted", `"${args.query}"`),
      );
    },
    renderResult: (result, options, theme, ctx) => {
      if (options.isPartial) {
        return new Text(theme.fg("warning", "Searching..."));
      }

      if (ctx.isError) {
        return renderError(extractTextContent(result), theme, {
          toolLabel: TOOL_NAME,
        });
      }

      const textContent = extractTextContent(result);

      return renderExpandableResult(
        result.details,
        textContent,
        options.expanded,
        theme,
      );
    },
  };
}
