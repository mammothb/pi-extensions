import { basename } from "node:path";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { parsePdf } from "../parsers.js";
import { ReadPdfSchema } from "../schemas.js";
import {
  buildToolResponse,
  createTempDir,
  truncatePreview,
  writeOutput,
} from "../utils.js";

export interface ReadPdfDetails {
  outputPath: string;
  stats: {
    pages: number;
    chars: number;
    truncated: boolean;
  };
  format: "text";
}

function buildPreview(
  fileName: string,
  text: string,
  outputPath: string,
  pages: number,
  truncated: boolean,
): string {
  const preview = truncatePreview(text);
  const lines = [
    `# Read PDF: ${fileName}`,
    "",
    "## Metadata",
    `- Pages: ${pages}`,
    `- Characters: ${text.length}`,
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

export function createReadPdfTool(): ToolDefinition<
  typeof ReadPdfSchema,
  ReadPdfDetails
> {
  return {
    name: "read_pdf",
    label: "Read PDF",
    description:
      "Extract text from a PDF file. Supports page ranges, max pages limit, and encrypted PDFs with password. Output is written to a temporary file for further inspection.",
    promptSnippet: "Extract text from a PDF file",
    promptGuidelines: [
      "read_pdf: extracts all text; use search_pdf to find specific text within a document.",
      "read_pdf: use page ranges or maxPages to limit output on large PDFs.",
      "read_pdf: provide a password for encrypted PDFs.",
    ],
    parameters: ReadPdfSchema,

    async execute(_toolCallId, params, signal, _onUpdate) {
      // Check for cancellation before starting
      if (signal?.aborted) {
        throw new Error("Cancelled");
      }

      const { path, pages, maxPages, password } = params;

      // Parse the PDF
      const { totalPages, text } = await parsePdf(path, {
        pages,
        maxPages,
        password,
      });

      // Check for cancellation after parse
      if (signal?.aborted) {
        throw new Error("Cancelled");
      }

      // Write full text to temp file
      const dir = await createTempDir();
      const outputPath = await writeOutput(dir, "output.txt", text);

      const truncated = text.length > 2000;
      const fileName = basename(path);
      const preview = buildPreview(
        fileName,
        text,
        outputPath,
        totalPages,
        truncated,
      );

      return buildToolResponse(preview, {
        outputPath,
        stats: {
          pages: totalPages,
          chars: text.length,
          truncated,
        },
        format: "text" as const,
      });
    },
  };
}
