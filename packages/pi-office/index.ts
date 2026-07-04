import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createReadDocxTool } from "./src/tools/read-docx.js";
import { createReadPdfTool } from "./src/tools/read-pdf.js";
import { createReadXlsxTool } from "./src/tools/read-xlsx.js";
import { createSearchDocxTool } from "./src/tools/search-docx.js";
import { createSearchPdfTool } from "./src/tools/search-pdf.js";
import { createSearchXlsxTool } from "./src/tools/search-xlsx.js";

export default function officeExtension(pi: ExtensionAPI) {
  pi.registerTool(createReadPdfTool());
  pi.registerTool(createSearchPdfTool());
  pi.registerTool(createReadDocxTool());
  pi.registerTool(createSearchDocxTool());
  pi.registerTool(createReadXlsxTool());
  pi.registerTool(createSearchXlsxTool());
}
