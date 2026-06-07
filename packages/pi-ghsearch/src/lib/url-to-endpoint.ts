/**
 * Convert a GitHub web URL or API URL to a gh api endpoint path.
 *
 * Examples:
 *   github.com/owner/repo                    → repos/owner/repo
 *   github.com/owner/repo/issues/42          → repos/owner/repo/issues/42
 *   github.com/owner/repo/pull/42            → repos/owner/repo/pulls/42
 *   github.com/owner/repo/blob/main/file.ts  → repos/owner/repo/contents/file.ts?ref=main
 *   github.com/owner/repo/commit/abc123      → repos/owner/repo/commits/abc123
 *   api.github.com/repos/owner/repo          → repos/owner/repo
 */
export function githubUrlToEndpoint(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid URL: ${url}`);
  }

  // Strip leading and trailing slashes from pathname
  const path = parsed.pathname.replace(/^\/|\/$/g, "");

  if (!path) {
    throw new Error(
      `Could not extract path from URL: ${url}. Expected github.com/owner/repo/...`,
    );
  }

  // gist.github.com URLs — map to the Gists API
  if (parsed.hostname === "gist.github.com") {
    const gistParts = path.split("/");
    const gistId = gistParts[1];
    if (!gistId) {
      throw new Error(
        `Could not extract gist ID from URL: ${url}. Expected gist.github.com/owner/gist_id`,
      );
    }
    return `gists/${gistId}`;
  }

  // api.github.com URLs — pass through the path
  if (parsed.hostname === "api.github.com") {
    return path;
  }

  // github.com (or enterprise) web URLs — map to API endpoints
  const parts = path.split("/");

  const owner = parts[0];
  const repo = parts[1];
  if (!owner || !repo) {
    throw new Error(
      `Could not parse GitHub URL: ${url}. Expected github.com/owner/repo/...`,
    );
  }

  if (parts.length === 2) {
    return `repos/${owner}/${repo}`;
  }

  const resource = parts[2];
  if (!resource) {
    throw new Error(
      `Could not parse GitHub URL: ${url}. Missing resource type after repo.`,
    );
  }
  const rest = parts.slice(3);

  switch (resource) {
    case "pull": {
      const pullsRest = rest.length > 0 ? `/${rest.join("/")}` : "";
      return `repos/${owner}/${repo}/pulls${pullsRest}`;
    }
    case "blob": {
      const ref = rest[0];
      const filePath = rest.slice(1).join("/");
      const contentsPath = filePath ? `/${filePath}` : "";
      if (ref) {
        return `repos/${owner}/${repo}/contents${contentsPath}?ref=${ref}`;
      }
      return `repos/${owner}/${repo}/contents${contentsPath}`;
    }
    case "tree": {
      const ref = rest[0];
      const filePath = rest.slice(1).join("/");
      const contentsPath = filePath ? `/${filePath}` : "";
      if (ref) {
        return `repos/${owner}/${repo}/contents${contentsPath}?ref=${ref}`;
      }
      return `repos/${owner}/${repo}/contents${contentsPath}`;
    }
    case "commit": {
      const commitRest = rest.length > 0 ? `/${rest.join("/")}` : "";
      return `repos/${owner}/${repo}/commits${commitRest}`;
    }
    default: {
      const defaultRest = rest.length > 0 ? `/${rest.join("/")}` : "";
      return `repos/${owner}/${repo}/${resource}${defaultRest}`;
    }
  }
}
