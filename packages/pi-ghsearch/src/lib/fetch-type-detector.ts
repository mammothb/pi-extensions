import { formatSize } from "@earendil-works/pi-coding-agent";

export type FetchedType =
  | "repo"
  | "issue"
  | "pr"
  | "file"
  | "commit"
  | "unknown";

export function detectFetchType(parsed: unknown): {
  type: FetchedType;
  summary: string;
} {
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    const obj = parsed as Record<string, unknown>;

    // GitHub Contents API (file): has name, path, encoding, content, size
    if (
      typeof obj.name === "string" &&
      typeof obj.path === "string" &&
      typeof obj.size === "number" &&
      (typeof obj.encoding === "string" || typeof obj.content === "string")
    ) {
      return {
        type: "file",
        summary: `[file] ${obj.path} (${formatSize(obj.size)})`,
      };
    }

    // Commit: has sha + commit object with message
    if (
      typeof obj.sha === "string" &&
      obj.commit &&
      typeof obj.commit === "object"
    ) {
      const commitObj = obj.commit as Record<string, unknown>;
      const shortSha = obj.sha.slice(0, 7);
      const msg = String(commitObj.message ?? "").split("\n")[0] ?? "";
      const author =
        (obj.author as Record<string, unknown> | undefined)?.login ??
        (commitObj.author as Record<string, unknown> | undefined)?.name ??
        "?";
      return {
        type: "commit",
        summary: `[commit] ${shortSha} "${msg}" — by ${author}`,
      };
    }

    // PR: has number, title, state, and draft/merged field
    if (
      typeof obj.number === "number" &&
      typeof obj.title === "string" &&
      typeof obj.state === "string" &&
      ("draft" in obj || "merged" in obj || "pull_request" in obj)
    ) {
      const draft = obj.draft ? "draft" : obj.merged ? "merged" : obj.state;
      return {
        type: "pr",
        summary: `[pr] #${obj.number} "${obj.title}" — ${draft}`,
      };
    }

    // Issue: has number, title, state (no draft/merged)
    if (
      typeof obj.number === "number" &&
      typeof obj.title === "string" &&
      typeof obj.state === "string"
    ) {
      const comments =
        typeof obj.comments === "number" ? `${obj.comments} comments` : "";
      let summary = `[issue] #${obj.number} "${obj.title}" — ${obj.state}`;
      if (comments) summary += `, ${comments}`;
      return { type: "issue", summary };
    }

    // Repo: has full_name, stargazers_count
    if (
      (typeof obj.full_name === "string" || typeof obj.fullName === "string") &&
      (typeof obj.stargazers_count === "number" ||
        typeof obj.stargazersCount === "number")
    ) {
      const fullName = obj.full_name ?? obj.fullName;
      const stars = obj.stargazers_count ?? obj.stargazersCount ?? 0;
      const forks = obj.forks_count ?? obj.forksCount ?? 0;
      const lang = obj.language ?? "none";
      const desc = obj.description ? ` — ${obj.description}` : "";
      return {
        type: "repo",
        summary: `[repo] ${fullName}${desc} — stars: ${stars}, forks: ${forks}, lang: ${lang}`,
      };
    }
  }

  // Array of something
  if (Array.isArray(parsed)) {
    const len = parsed.length;
    if (len === 0) return { type: "unknown", summary: "empty list" };
    // Try to detect type from first element, but keep it simple
    return {
      type: "unknown",
      summary: `${len} items`,
    };
  }

  // Fallback: count keys if it's an object
  if (parsed && typeof parsed === "object") {
    const keys = Object.keys(parsed as Record<string, unknown>);
    const size = formatSize(JSON.stringify(parsed).length);
    return {
      type: "unknown",
      summary: `${keys.length} fields, ${size}`,
    };
  }

  return { type: "unknown", summary: "" };
}
