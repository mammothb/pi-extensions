import { basename } from "node:path";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { parseXlsx, type XlsxSheetData } from "../parsers.js";
import { ReadXlsxSchema } from "../schemas.js";
import { buildToolResponse, createTempDir, writeOutput } from "../utils.js";

export interface ReadXlsxDetails {
  outputDir: string;
  stats: {
    sheetCount: number;
    sheet?: string;
    rows: number;
    cols: number;
  };
  format: "json";
}

function formatIndexPreview(
  fileName: string,
  sheetNames: string[],
  sheets: XlsxSheetData[],
  outputDir: string,
): string {
  const lines = [
    `# Read XLSX: ${fileName}`,
    "",
    `${sheetNames.length} sheet${sheetNames.length === 1 ? "" : "s"}: ${sheetNames.map((s) => `'${s}'`).join(", ")}`,
    "",
  ];

  for (const sheet of sheets) {
    lines.push(`──${sheet.name}── (${sheet.rows} rows, ${sheet.cols} cols)`);

    if (sheet.data.length === 0) {
      lines.push("(no data rows)");
    } else {
      const headerLine = `| ${sheet.headers.join(" | ")} |`;
      lines.push(headerLine);

      for (const row of sheet.data) {
        const rowLine = `| ${sheet.headers.map((h) => row[h] ?? "").join(" | ")} |`;
        lines.push(rowLine);
      }

      if (sheet.rows > sheet.data.length) {
        lines.push(`... (${sheet.rows - sheet.data.length} more rows)`);
      }
    }

    lines.push("");
  }

  lines.push(`Full data written to ${outputDir}/`);
  return lines.join("\n");
}

function formatSheetResult(
  fileName: string,
  sheet: XlsxSheetData,
  outputPath: string,
): string {
  return [
    `# Read XLSX: ${fileName}`,
    "",
    `Sheet "${sheet.name}" (${sheet.rows} rows, ${sheet.cols} cols)`,
    "",
    `Full data written to ${outputPath}`,
  ].join("\n");
}

export function createReadXlsxTool(): ToolDefinition<
  typeof ReadXlsxSchema,
  ReadXlsxDetails
> {
  return {
    name: "read_xlsx",
    label: "Read XLSX",
    description:
      "Read an Excel .xlsx file. Omit sheet name to see sheet index with preview rows. Provide sheet name to read full data for one sheet as JSON.",
    promptSnippet: "Read an Excel spreadsheet",
    promptGuidelines: [
      "read_xlsx: omit sheet name to see sheet index with preview rows first.",
      "read_xlsx: provide a sheet name to read full data for that sheet as JSON.",
      "read_xlsx: use search_xlsx to find specific values across sheets.",
    ],
    parameters: ReadXlsxSchema,

    async execute(_toolCallId, params, signal, _onUpdate) {
      if (signal?.aborted) {
        throw new Error("Cancelled");
      }

      const { path, sheet, maxRows, headerRow } = params;

      const result = await parseXlsx(path, { sheet, maxRows, headerRow });

      if (signal?.aborted) {
        throw new Error("Cancelled");
      }

      const dir = await createTempDir();
      const fileName = basename(path);

      if (result.sheet) {
        // Sheet mode
        const dataJson = JSON.stringify(result.sheet.data, null, 2);
        const outputPath = await writeOutput(
          dir,
          `${result.sheet.name}.json`,
          dataJson,
        );

        const preview = formatSheetResult(fileName, result.sheet, outputPath);

        return buildToolResponse(preview, {
          outputDir: dir,
          stats: {
            sheetCount: result.sheetNames.length,
            sheet: result.sheet.name,
            rows: result.sheet.rows,
            cols: result.sheet.cols,
          },
          format: "json" as const,
        });
      }

      // Index mode
      for (const s of result.sheets) {
        const dataJson = JSON.stringify(s.data, null, 2);
        await writeOutput(dir, `${s.name}.json`, dataJson);
      }

      const preview = formatIndexPreview(
        fileName,
        result.sheetNames,
        result.sheets,
        dir,
      );

      return buildToolResponse(preview, {
        outputDir: dir,
        stats: {
          sheetCount: result.sheetNames.length,
          rows: result.sheets.reduce((sum, s) => sum + s.rows, 0),
          cols: Math.max(...result.sheets.map((s) => s.cols), 0),
        },
        format: "json" as const,
      });
    },
  };
}
