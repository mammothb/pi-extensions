import { formatRecallOutput } from "./format-recall";
import { loadAllMessages } from "./load-messages";
import type { RecallScope } from "./recall-scope";
import { searchEntries } from "./search-entries";

const DEFAULT_RECENT = 25;
const PAGE_SIZE = 5;

export interface RecallPipelineInput {
  sessionFile: string;
  query?: string;
  scope: RecallScope;
  lineageEntryIds?: Set<string>;
  page?: number;
  /** Indices to expand to full untruncated content (tool mode only). */
  expand?: number[];
  /** Footer continuation prompt when more pages exist. */
  continuationPrompt?: string;
}

export interface RecallPipelineOutput {
  text: string;
}

function invalidExpandIndices(
  requested: number[],
  available: Set<number>,
): number[] {
  return requested.filter((i) => !Number.isInteger(i) || !available.has(i));
}

function handleExpandMode(
  expand: number[],
  sessionFile: string,
  lineageEntryIds: Set<string> | undefined,
  scope: string | undefined,
  scopePrefix: string,
): RecallPipelineOutput {
  const { rendered: fullMsgs } = loadAllMessages(
    sessionFile,
    true,
    lineageEntryIds,
  );
  const byIndex = new Map(fullMsgs.map((m) => [m.index, m]));
  const invalid = invalidExpandIndices(expand, new Set(byIndex.keys()));
  if (invalid.length > 0) {
    const scopeLabel = scope === "all" ? "session history" : "active lineage";
    return {
      text: `Cannot expand indices outside ${scopeLabel}: ${invalid.join(", ")}`,
    };
  }
  const expanded = expand
    .map((i) => byIndex.get(i))
    .filter((m): m is NonNullable<typeof m> => Boolean(m));
  return { text: scopePrefix + formatRecallOutput(expanded) };
}

function handleSearchMode(
  query: string | undefined,
  page: number,
  scope: string | undefined,
  sessionFile: string,
  lineageEntryIds: Set<string> | undefined,
  continuationPrompt: string | undefined,
): RecallPipelineOutput {
  const { rendered, rawMessages } = loadAllMessages(
    sessionFile,
    false,
    lineageEntryIds,
  );
  const allResults = query?.trim()
    ? searchEntries(rendered, rawMessages, query)
    : rendered.slice(-DEFAULT_RECENT);

  if (query?.trim()) {
    const start = (page - 1) * PAGE_SIZE;
    const pageResults = allResults.slice(start, start + PAGE_SIZE);
    const totalPages = Math.ceil(allResults.length / PAGE_SIZE);
    const scopeSuffix = scope === "all" ? " (scope: all)" : "";
    const header =
      totalPages > 1
        ? `Page ${page}/${totalPages} (${allResults.length} total matches${scopeSuffix})`
        : `${allResults.length} matches${scopeSuffix}`;
    const footer =
      continuationPrompt && page < totalPages
        ? `\n--- ${continuationPrompt} ---`
        : "";
    return {
      text:
        scopePrefix + formatRecallOutput(pageResults, query, header) + footer,
    };
  }

  return { text: scopePrefix + formatRecallOutput(allResults, query) };
}

export function runRecallPipeline(
  input: RecallPipelineInput,
): RecallPipelineOutput {
  const {
    sessionFile,
    query,
    scope,
    lineageEntryIds,
    page = 1,
    expand,
    continuationPrompt,
  } = input;
  const scopePrefix = scope === "all" ? "Scope: all\n\n" : "";

  if (expand && expand.length > 0 && !query) {
    return handleExpandMode(
      expand,
      sessionFile,
      lineageEntryIds,
      scope,
      scopePrefix,
    );
  }

  return handleSearchMode(
    query,
    page,
    scope,
    sessionFile,
    lineageEntryIds,
    continuationPrompt,
  );
}
