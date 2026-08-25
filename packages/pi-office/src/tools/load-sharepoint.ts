import { writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { SharepointConfig } from "../config.js";
import { SharepointClient } from "../sharepoint.js";
import { buildToolResponse, createTempDir, truncatePreview } from "../utils.js";

export interface LoadSharepointDetails {
  outputPath: string;
  source: string;
  bytes: number;
}

const LoadSharepointSchema = Type.Object({
  url: Type.String({
    description:
      "Full SharePoint file URL, e.g. " +
      '"https://contoso.sharepoint.com/sites/team/Shared Documents/report.pdf"',
  }),
});

export function createLoadSharepointTool(
  config: SharepointConfig,
): ToolDefinition<typeof LoadSharepointSchema, LoadSharepointDetails> {
  const client = new SharepointClient(config);

  return {
    name: "load_sharepoint",
    label: "Load SharePoint File",
    description:
      "Download a file from SharePoint via Microsoft Graph and write it to a temporary " +
      "local path. Feed the returned path into read_pdf / read_docx / read_xlsx / search_pdf. " +
      "Requires sharepoint.tokenSource in the pi-office config.",
    promptSnippet: "Download a file from SharePoint to a local temp path",
    promptGuidelines: [
      "load_sharepoint: pass the full SharePoint file URL; use the returned outputPath with read_pdf/read_docx/read_xlsx.",
    ],
    parameters: LoadSharepointSchema,

    async execute(_toolCallId, params, signal) {
      if (signal?.aborted) {
        throw new Error("Cancelled");
      }

      const { bytes, fileName } = await client.downloadFile(params.url);

      if (signal?.aborted) {
        throw new Error("Cancelled");
      }

      const dir = await createTempDir();
      const outputPath = await writeBytes(dir, fileName, bytes);

      const preview = [
        `# SharePoint download: ${fileName}`,
        "",
        `- Source: ${params.url}`,
        `- Size: ${bytes.length} bytes`,
        "",
        "File saved locally — inspect it with the appropriate reader tool:",
        "",
        "```",
        `outputPath = "${outputPath}"`,
        "```",
        "",
        truncatePreview(
          `${fileName} → ${basename(outputPath)} (${bytes.length} bytes)`,
        ),
      ].join("\n");

      return buildToolResponse(preview, {
        outputPath,
        source: params.url,
        bytes: bytes.length,
      });
    },
  };
}

async function writeBytes(
  dir: string,
  fileName: string,
  bytes: Buffer,
): Promise<string> {
  // Sanitize the filename: keep the base name only, strip path separators.
  const safeName = basename(fileName).replace(/[/\\]/g, "_") || "download";
  const filePath = join(dir, safeName);
  await writeFile(filePath, bytes);
  return filePath;
}
