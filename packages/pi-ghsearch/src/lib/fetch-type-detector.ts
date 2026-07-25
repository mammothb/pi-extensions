import { formatSize } from "@earendil-works/pi-coding-agent";

export type FetchedType =
  | "repo"
  | "issue"
  | "pr"
  | "file"
  | "commit"
  | "unknown";

type Result = { type: FetchedType; summary: string };

function tryFile(obj: Record<string, unknown>): Result | null {
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
  return null;
}

function tryCommit(obj: Record<string, unknown>): Result | null {
  if (
    typeof obj.sha !== "string" ||
    !obj.commit ||
    typeof obj.commit !== "object"
  ) {
    return null;
  }
  const commitObj = obj.commit as Record<string, unknown>;
  const shortSha = obj.sha.slice(0, 7);
  const msg = String(commitObj.message ?? "").split("\n")[0] ?? "";
  const author = String(
    (obj.author as Record<string, unknown> | undefined)?.login ??
      (commitObj.author as Record<string, unknown> | undefined)?.name ??
      "?",
  );
  return {
    type: "commit",
    summary: `[commit] ${shortSha} "${msg}" — by ${author}`,
  };
}

function tryPR(obj: Record<string, unknown>): Result | null {
  if (
    typeof obj.number !== "number" ||
    typeof obj.title !== "string" ||
    typeof obj.state !== "string" ||
    !("draft" in obj || "merged" in obj || "pull_request" in obj)
  ) {
    return null;
  }
  let draft: string;
  if (obj.draft) {
    draft = "draft";
  } else if (obj.merged) {
    draft = "merged";
  } else {
    draft = obj.state as string;
  }
  return {
    type: "pr",
    summary: `[pr] #${obj.number} "${obj.title}" — ${draft}`,
  };
}

function tryIssue(obj: Record<string, unknown>): Result | null {
  if (
    typeof obj.number !== "number" ||
    typeof obj.title !== "string" ||
    typeof obj.state !== "string"
  ) {
    return null;
  }
  const comments =
    typeof obj.comments === "number" ? `${obj.comments} comments` : "";
  let summary = `[issue] #${obj.number} "${obj.title}" — ${obj.state}`;
  if (comments) {
    summary += `, ${comments}`;
  }
  return { type: "issue", summary };
}

function tryRepo(obj: Record<string, unknown>): Result | null {
  if (
    (typeof obj.full_name !== "string" && typeof obj.fullName !== "string") ||
    (typeof obj.stargazers_count !== "number" &&
      typeof obj.stargazersCount !== "number")
  ) {
    return null;
  }
  const fullName = obj.full_name ?? obj.fullName;
  const stars = obj.stargazers_count ?? obj.stargazersCount ?? 0;
  const forks = obj.forks_count ?? obj.forksCount ?? 0;
  const lang = String(obj.language ?? "none");
  const desc = obj.description ? ` — ${String(obj.description)}` : "";
  return {
    type: "repo",
    summary: `[repo] ${fullName}${desc} — stars: ${stars}, forks: ${forks}, lang: ${lang}`,
  };
}

export function detectFetchType(parsed: unknown): Result {
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    const obj = parsed as Record<string, unknown>;

    return (
      tryFile(obj) ??
      tryCommit(obj) ??
      tryPR(obj) ??
      tryIssue(obj) ??
      tryRepo(obj) ?? {
        type: "unknown",
        summary: `${Object.keys(obj).length} fields, ${formatSize(JSON.stringify(obj).length)}`,
      }
    );
  }

  if (Array.isArray(parsed)) {
    const len = parsed.length;
    if (len === 0) {
      return { type: "unknown", summary: "empty list" };
    }
    return { type: "unknown", summary: `${len} items` };
  }

  if (parsed && typeof parsed === "object") {
    const keys = Object.keys(parsed as Record<string, unknown>);
    const size = formatSize(JSON.stringify(parsed).length);
    return { type: "unknown", summary: `${keys.length} fields, ${size}` };
  }

  return { type: "unknown", summary: "" };
}
