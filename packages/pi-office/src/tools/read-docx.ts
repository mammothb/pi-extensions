import { basename } from "node:path";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { parseDocx } from "../parsers.js";
import { ReadDocxSchema } from "../schemas.js";
import {
  buildToolResponse,
  createTempDir,
  truncatePreview,
  writeOutput,
} from "../utils.js";

export interface ReadDocxDetails {
  outputPath: string;
  stats: {
    chars: number;
    truncated: boolean;
    warnings: number;
  };
  format: "markdown";
}

function buildPreview(
  fileName: string,
  markdown: string,
  outputPath: string,
  chars: number,
  truncated: boolean,
  warningCount: number,
): string {
  const preview = truncatePreview(markdown);
  const lines = [
    `# Read DOCX: ${fileName}`,
    "",
    "## Metadata",
    `- Characters: ${chars}`,
    ...(warningCount > 0 ? [`- Warnings: ${warningCount}`] : []),
    ...(truncated ? ["- Preview truncated to 2000 characters"] : []),
    "",
    "## Preview",
    "",
    preview,
    "",
    `Full content written to ${outputPath}`,
  ];
  return lines.join("\n");
}

export function createReadDocxTool(): ToolDefinition<
  typeof ReadDocxSchema,
  ReadDocxDetails
> {
  return {
    name: "read_docx",
    label: "Read DOCX",
    description:
      "Convert a .docx file to markdown. Preserves headings, lists, tables, and text formatting. Output is written to a temporary file for further inspection.",
    promptSnippet: "Extract text from a Word document",
    promptGuidelines: [
      "read_docx: converts to markdown preserving headings, lists, tables, and formatting.",
      "read_docx: use search_docx to find specific text within a document.",
    ],
    parameters: ReadDocxSchema,

    async execute(_toolCallId, params, signal, _onUpdate) {
      if (signal?.aborted) {
        throw new Error("Cancelled");
      }

      const { path, maxChars } = params;

      const { markdown, warnings } = await parseDocx(path);

      if (signal?.aborted) {
        throw new Error("Cancelled");
      }

      const dir = await createTempDir();
      const outputPath = await writeOutput(dir, "output.md", markdown);

      const truncated = markdown.length > (maxChars ?? 2000);
      const fileName = basename(path);
      const preview = buildPreview(
        fileName,
        markdown,
        outputPath,
        markdown.length,
        truncated,
        warnings.length,
      );

      return buildToolResponse(preview, {
        outputPath,
        stats: {
          chars: markdown.length,
          truncated,
          warnings: warnings.length,
        },
        format: "markdown" as const,
      });
    },
  };
}
