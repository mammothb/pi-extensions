import {
  formatSize,
  getMarkdownTheme,
  type Theme,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { Container, Markdown, Spacer, Text } from "@earendil-works/pi-tui";
import { extractTextContent, getExpandKey } from "@mammothb/pi-shared";
import Type from "typebox";
import { buildHeaders } from "./lib/headers.js";
import { toMarkdown, toText } from "./lib/processors.js";
import { FormatSchema, type Header } from "./lib/types.js";

const COLLAPSED_PREVIEW_LINES = 7;
const DEFAULT_TIMEOUT = 30; // 30 seconds
const MAX_TIMEOUT = 120; // 2 minutes
const MAX_RESPONSE_SIZE = 5 * 1024 * 1024; // 5 MB
const USER_AGENT = "opencode";

interface WebfetchDetails {
  url: string;
  contentType: string;
  format: string;
  displayTitle: string;
  size?: number;
  isImage?: boolean;
  imageDataUrl?: string;
  error?: boolean;
  errorSummary?: string;
}

const Parameters = Type.Object({
  url: Type.String({
    description: "The URL to fetch content from",
    pattern: "^https?://.*",
  }),
  format: Type.Optional(FormatSchema),
  timeout: Type.Optional(
    Type.Number({
      description: "Optional timeout in seconds (max 120)",
      exclusiveMinimum: 0,
      maximum: 120,
    }),
  ),
});

async function fetchWithRetry(
  url: string,
  headers: Header,
  signal: AbortSignal | undefined,
  timeoutMs: number,
): Promise<{ body: ArrayBuffer; contentType: string }> {
  // Set up timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  // Forward external signal
  const onAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) {
      throw new Error("Request aborted");
    }
    signal.addEventListener("abort", onAbort, { once: true });
  }

  try {
    const doFetch = async (userAgent: string) => {
      return await fetch(url, {
        method: "GET",
        headers: { ...headers, "User-Agent": userAgent },
        signal: controller.signal,
        redirect: "follow",
      });
    };

    let response = await doFetch(headers["User-Agent"]);
    // Retry with honest UA if blocked by Cloudflare bot detection
    if (isBlockedByCloudflare(response)) {
      response = await doFetch(USER_AGENT);
    }

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const contentLength = response.headers.get("content-length");
    if (contentLength && parseInt(contentLength, 10) > MAX_RESPONSE_SIZE) {
      throw new Error(
        `Response too large (exceeds ${formatSize(MAX_RESPONSE_SIZE)} limit)`,
      );
    }

    const arrayBuffer = await response.arrayBuffer();
    if (arrayBuffer.byteLength > MAX_RESPONSE_SIZE) {
      throw new Error(
        `Response too large (exceeds ${formatSize(MAX_RESPONSE_SIZE)} limit)`,
      );
    }

    return {
      body: arrayBuffer,
      contentType: response.headers.get("content-type") || "text/html",
    };
  } catch (error) {
    if (controller.signal.aborted && !signal?.aborted) {
      throw new Error("Request timed out");
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
    if (signal) {
      signal.removeEventListener("abort", onAbort);
    }
  }
}

function formatTitle(details: WebfetchDetails): string {
  return details.displayTitle ?? details.url ?? "Unknown URL";
}

function formatSizeOrUnknown(bytes: number | undefined): string {
  return bytes !== undefined ? formatSize(bytes) : "unknown size";
}

function isBlockedByCloudflare(response: Response): boolean {
  return (
    response.status === 403 &&
    response.headers.get("cf-mitigated") === "challenge"
  );
}

function isImageAttachment(mime: string): boolean {
  return (
    mime.startsWith("image/") &&
    mime !== "image/svg+xml" &&
    mime !== "image/vnd.fastbidsheet"
  );
}

function renderWebfetchResult(
  details: WebfetchDetails,
  textContent: string,
  expanded: boolean,
  theme: Theme,
): Container {
  const container = new Container();

  const title = formatTitle(details);
  const format = details.format ? ` [${details.format}]` : "";
  container.addChild(
    new Text(
      theme.fg("syntaxKeyword", "url: ") +
        theme.fg("syntaxString", title + format),
    ),
  );

  if (details.size !== undefined) {
    container.addChild(
      new Text(
        theme.fg("syntaxKeyword", "size: ") +
          theme.fg("syntaxString", formatSizeOrUnknown(details.size)),
      ),
    );
  }

  if (!textContent) {
    return container;
  }

  container.addChild(new Spacer(1));

  if (expanded) {
    const format = details.format ?? "markdown";
    if (format === "markdown") {
      container.addChild(new Markdown(textContent, 0, 0, getMarkdownTheme()));
    } else {
      const highlighted = `\`\`\`${format}\n${textContent}\n\`\`\``;
      container.addChild(new Markdown(highlighted, 0, 0, getMarkdownTheme()));
    }
  } else {
    const lines = textContent
      .split("\n")
      .filter(
        (line, index, arr) =>
          line.length > 0 || index === 0 || index < arr.length - 1,
      );
    const previewLines = lines.slice(0, COLLAPSED_PREVIEW_LINES);
    const remaining = Math.max(0, lines.length - previewLines.length);

    const preview = previewLines.join("\n");
    const format = details.format ?? "markdown";
    if (format === "markdown") {
      container.addChild(new Markdown(preview, 0, 0, getMarkdownTheme()));
    } else {
      container.addChild(new Text(preview));
    }

    if (remaining > 0) {
      container.addChild(new Spacer(1));
      const expandKey = getExpandKey();
      container.addChild(
        new Text(
          theme.fg("muted", `... (${remaining} more lines, `) +
            theme.fg("muted", expandKey) +
            theme.fg("muted", " to expand)"),
        ),
      );
    }
  }
  return container;
}

export function createWebfetchTool(): ToolDefinition<
  typeof Parameters,
  WebfetchDetails
> {
  return {
    name: "WebFetch",
    label: "Web Fetch",
    description:
      "Fetches content from a URL and converts to requested format (markdown, text, or HTML). " +
      "HTTP URLs are upgraded to HTTPS. Images are returned as base64 inline. " +
      `Responses over ${formatSize(MAX_RESPONSE_SIZE)} are rejected. ` +
      `Timeout configurable up to ${MAX_TIMEOUT}s (default ${DEFAULT_TIMEOUT}s).`,
    promptSnippet: "Fetch and convert web content",
    promptGuidelines: [
      "WebFetch: format options are 'markdown' (default), 'text', or 'html'.",
      "WebFetch: if another tool offers better web fetching (e.g., a provider-specific tool), prefer that instead.",
      "WebFetch: results may be summarized if content is very large. Use timeout for slow endpoints.",
    ],
    parameters: Parameters,
    async execute(_toolCallId, params, signal, _onUpdate, _ctx) {
      const url = params.url;
      const format = params.format ?? "markdown";

      if (signal?.aborted) {
        return {
          content: [{ type: "text", text: "Cancelled" }],
          details: {
            url,
            contentType: "",
            format,
            displayTitle: url,
            error: true,
            errorSummary: "Request cancelled",
          },
        };
      }

      const timeoutMs =
        Math.min(params.timeout ?? DEFAULT_TIMEOUT, MAX_TIMEOUT) * 1000;

      const headers = buildHeaders(format);
      const { body, contentType } = await fetchWithRetry(
        url,
        headers,
        signal,
        timeoutMs,
      );

      const mime = contentType.split(";")[0]?.trim().toLowerCase() || "";
      const displayTitle = `${url} (${contentType})`;

      // Handle image
      if (isImageAttachment(mime)) {
        const base64Content = Buffer.from(body).toString("base64");
        return {
          content: [
            {
              type: "text",
              text: `Image fetched successfully: ${url}\nMIME type: ${mime}\nSize: ${body.byteLength} bytes`,
            },
            {
              type: "image",
              data: base64Content,
              mimeType: mime,
            },
          ],
          details: {
            url,
            contentType: mime,
            format,
            displayTitle,
            size: body.byteLength,
            isImage: true,
            imageDataUrl: `data:${mime};base64,${base64Content}`,
          },
        };
      }

      // Handle text
      const text = new TextDecoder().decode(body);
      switch (format) {
        case "markdown": {
          return {
            content: [{ type: "text", text: toMarkdown(contentType, text) }],
            details: {
              url,
              contentType,
              format: "markdown",
              displayTitle,
              size: body.byteLength,
            },
          };
        }
        case "text": {
          return {
            content: [{ type: "text", text: toText(contentType, text) }],
            details: {
              url,
              contentType,
              format: "text",
              displayTitle,
              size: body.byteLength,
            },
          };
        }
        case "html": {
          return {
            content: [{ type: "text", text: text }],
            details: {
              url,
              contentType,
              format: "html",
              displayTitle,
              size: body.byteLength,
            },
          };
        }
        default: {
          return {
            content: [{ type: "text", text: text }],
            details: {
              url,
              contentType,
              format,
              displayTitle,
              size: body.byteLength,
            },
          };
        }
      }
    },
    renderResult(result, options, theme, _ctx) {
      const details = result.details;

      if (options.isPartial && !details.url) {
        return new Text(theme.fg("muted", "Fetching..."));
      }

      if (details.isImage) {
        return new Text(
          theme.fg(
            "muted",
            `Image: ${formatTitle(details)} (${formatSizeOrUnknown(details.size)})`,
          ),
        );
      }

      if (details.error) {
        return new Text(
          theme.fg("error", details.errorSummary ?? "Request failed"),
        );
      }

      const textContent = extractTextContent(result);
      return renderWebfetchResult(
        details,
        textContent,
        options.expanded,
        theme,
      );
    },
  };
}
