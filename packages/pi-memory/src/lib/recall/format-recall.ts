import type { SearchHit } from "./search-entries";

export const formatRecallOutput = (
  entries: SearchHit[],
  query?: string,
  headerOverride?: string,
): string => {
  if (entries.length === 0) {
    return query
      ? `No matches for "${query}" in session history.`
      : "No entries in session history.";
  }

  let header: string;
  if (headerOverride) {
    header = `${headerOverride} for "${query}":`;
  } else if (query) {
    header = `Found ${entries.length} matches for "${query}":`;
  } else {
    header = `Session history (${entries.length} entries):`;
  }

  const lines = entries.map((e) => {
    const fileSuffix = e.files?.length ? ` files:[${e.files.join(", ")}]` : "";
    const body = query && e.snippet ? e.snippet : e.summary;
    return `#${e.index} [${e.role}]${fileSuffix} ${body}`;
  });

  return `${header}\n\n${lines.join("\n\n")}`;
};
