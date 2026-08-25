import { resolveSecret } from "@mammothb/pi-shared";
import type { SharepointConfig } from "./config.js";

/**
 * Minimal Microsoft Graph client for downloading SharePoint files.
 *
 * URL shapes supported (parsed by parseSharepointUrl):
 * - Direct document paths  → site → drive → /root:{path}:/content
 *   (site/drive lookups cached per session)
 * - Editor pages (_layouts/Doc.aspx?sourcedoc={GUID}) and opaque share
 *   links → resolved through the /shares/{u!encoded}/driveItem endpoint
 */

export interface DirectFileRef {
  kind: "direct";
  /** SharePoint host, e.g. "contoso.sharepoint.com". */
  host: string;
  /** Site path without leading slash, e.g. "sites/team". Null for root site. */
  sitePath: string | null;
  /** Item path inside the drive, no leading slash, e.g. "Shared Documents/report.pdf". */
  itemPath: string;
}

export interface SharedLinkRef {
  kind: "shared";
  /** Fragment-stripped URL to resolve via the /shares endpoint. */
  url: string;
}

export type ParsedSharepointUrl = DirectFileRef | SharedLinkRef;

/** Site URL prefixes under which a site lives below the host root. */
const SITE_SEGMENTS = new Set(["sites", "teams", "personal"]);

/** Share-link decoration segment, e.g. ":x:", ":w:", ":p:". */
const SHARE_MARKER_RE = /^:[a-z]:$/i;

/** Encode a URL into a Graph sharing token: "u!" + unpadded base64url. */
function encodeSharingUrl(url: string): string {
  const b64 = Buffer.from(url, "utf-8").toString("base64");
  return `u!${b64.replace(/=+$/, "").replace(/\//g, "_").replace(/\+/g, "-")}`;
}

/**
 * Build a direct file reference from a server-relative path such as
 * "/sites/team/Shared Documents/report.pdf".
 * Returns undefined when no item path remains.
 */
function refFromServerRelative(
  host: string,
  path: string,
): DirectFileRef | undefined {
  const segments = path.split("/").filter((s) => s.length > 0);
  const [first, second] = segments;
  if (first && second && SITE_SEGMENTS.has(first.toLowerCase())) {
    return {
      kind: "direct",
      host,
      sitePath: `${first}/${second}`,
      itemPath: segments.slice(2).join("/"),
    };
  }
  return {
    kind: "direct",
    host,
    sitePath: null,
    itemPath: segments.join("/"),
  };
}

function hasFileExtension(segment: string | undefined): boolean {
  return segment !== undefined && /\.[a-z0-9]+$/i.test(segment);
}

/** Strip the URL fragment — hashes in pasted URLs would break resolution. */
function withoutFragment(rawUrl: string): string {
  return rawUrl.split("#")[0] ?? rawUrl;
}

/**
 * Office web editor pages carry the real target in ?sourcedoc={GUID}; let
 * the Graph shares endpoint resolve them. Other _layouts system pages
 * cannot be mapped to a document.
 */
function parseLayoutsPage(url: URL, rawUrl: string): SharedLinkRef | undefined {
  if (!/\/_layouts\//i.test(url.pathname)) {
    return undefined;
  }
  if (!url.searchParams.has("sourcedoc")) {
    throw new Error(
      `Unsupported SharePoint system page: "${rawUrl}". Paste a direct file ` +
        `URL, an editor URL (?sourcedoc=...), or a share link instead.`,
    );
  }
  return { kind: "shared", url: withoutFragment(rawUrl) };
}

/** Browser folder views expose the selected file via ?id=/server/rel/path. */
function parseSelectedBrowserFile(url: URL): DirectFileRef | undefined {
  const idParam = url.searchParams.get("id");
  if (
    !idParam?.startsWith("/") ||
    !hasFileExtension(idParam.split("/").pop())
  ) {
    return undefined;
  }
  const ref = refFromServerRelative(url.host, idParam);
  return ref?.itemPath ? ref : undefined;
}

/**
 * Share links: "/:x:/r/sites/team/file.xlsx" embeds the real path after the
 * marker; other forms ("/:x:/s/<token>") are opaque and need /shares.
 */
function parseShareMarker(
  host: string,
  segments: string[],
  rawUrl: string,
): ParsedSharepointUrl | undefined {
  const markerIndex = segments.findIndex((s) => SHARE_MARKER_RE.test(s));
  if (markerIndex === -1) {
    return undefined;
  }
  const afterMarker = segments[markerIndex + 1];
  const rest = segments.slice(markerIndex + 2);
  if (afterMarker?.toLowerCase() === "r" && hasFileExtension(rest.at(-1))) {
    const ref = refFromServerRelative(host, `/${rest.join("/")}`);
    if (ref?.itemPath) {
      return ref;
    }
  }
  return { kind: "shared", url: withoutFragment(rawUrl) };
}

/** Plain document-library path; rejects folder views without a selection. */
function parsePlainPath(
  host: string,
  segments: string[],
  rawUrl: string,
): DirectFileRef {
  const ref = refFromServerRelative(host, `/${segments.join("/")}`);
  const lastSegment = ref?.itemPath.split("/").pop();
  if (!ref?.itemPath || lastSegment?.toLowerCase() === "allitems.aspx") {
    throw new Error(
      `URL does not point at a file: "${rawUrl}". Paste the URL of a specific ` +
        `document, not a folder view.`,
    );
  }
  return ref;
}

export function parseSharepointUrl(rawUrl: string): ParsedSharepointUrl {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(
      `Invalid SharePoint URL: "${rawUrl}". Expected e.g. ` +
        `https://contoso.sharepoint.com/sites/team/Shared%20Documents/file.pdf`,
    );
  }
  if (url.protocol !== "https:") {
    throw new Error(`SharePoint URL must use https://, got: ${rawUrl}`);
  }
  const segments = decodeURIComponent(url.pathname)
    .split("/")
    .filter((s) => s.length > 0);

  // Try each URL shape in turn; first match wins.
  return (
    parseLayoutsPage(url, rawUrl) ??
    parseSelectedBrowserFile(url) ??
    parseShareMarker(url.host, segments, rawUrl) ??
    parsePlainPath(url.host, segments, rawUrl)
  );
}

interface ResolvedLocation {
  driveId: string;
  sitePathKey: string;
}

interface DriveItemJson {
  name?: string;
  folder?: unknown;
}

export class SharepointClient {
  private readonly baseUrl: string;
  private readonly tokenSource: string;
  /** Cache of resolved drives keyed by "host/sitePath" or "host/". */
  private readonly drives = new Map<string, ResolvedLocation>();

  constructor(config: SharepointConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
    this.tokenSource = config.tokenSource;
  }

  private token(): string {
    if (!this.tokenSource) {
      throw new Error(
        "SharePoint is not configured. Set sharepoint.tokenSource in " +
          '~/.pi/agent/pi-office.json (e.g. { "sharepoint": { ' +
          '"tokenSource": "env:GRAPH_TOKEN" } }).',
      );
    }
    const token = resolveSecret(this.tokenSource);
    if (!token || token === this.tokenSource) {
      throw new Error(
        `Failed to resolve SharePoint token from "${this.tokenSource}" ` +
          `(env var missing, file unreadable, or command failed).`,
      );
    }
    return token;
  }

  private async request(path: string, signal?: AbortSignal): Promise<Response> {
    // Body reads (arrayBuffer) are bound to the same signal by fetch itself.
    const timeout = AbortSignal.timeout(60_000);
    const res = await fetch(`${this.baseUrl}${path}`, {
      headers: { Authorization: `Bearer ${this.token()}` },
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
    if (res.status === 401 || res.status === 403) {
      throw new Error(
        `SharePoint request unauthorized (${res.status}). The token from ` +
          `"${this.tokenSource}" may be expired or lack Files.Read / ` +
          `Sites.Read.All permission.`,
      );
    }
    return res;
  }

  private async resolveDrive(
    parsed: DirectFileRef,
    signal?: AbortSignal,
  ): Promise<string> {
    const key = `${parsed.host}/${parsed.sitePath ?? ""}`;
    const cached = this.drives.get(key);
    if (cached) {
      return cached.driveId;
    }

    // Graph format: /sites/{hostname}:/{server-relative-path}
    const siteRef = parsed.sitePath
      ? `${parsed.host}:/${parsed.sitePath}`
      : parsed.host;
    const siteRes = await this.request(`/sites/${siteRef}`, signal);
    if (!siteRes.ok) {
      throw new Error(
        `Cannot access SharePoint site (${siteRes.status}): ${siteRef}`,
      );
    }
    const site = (await siteRes.json()) as { id: string };

    const driveRes = await this.request(`/sites/${site.id}/drive`, signal);
    if (!driveRes.ok) {
      throw new Error(
        `Cannot access default document drive (${driveRes.status}) for site ${site.id}`,
      );
    }
    const drive = (await driveRes.json()) as { id: string };

    this.drives.set(key, { driveId: drive.id, sitePathKey: key });
    return drive.id;
  }

  /**
   * Download via the Graph shares endpoint (editor pages, opaque share
   * links). Two requests: metadata (validates it's a file, gets the name),
   * then the content stream.
   */
  private async downloadShared(
    url: string,
    signal?: AbortSignal,
  ): Promise<{ bytes: Buffer; fileName: string }> {
    const token = encodeSharingUrl(url);

    const metaRes = await this.request(`/shares/${token}/driveItem`, signal);
    if (!metaRes.ok) {
      throw new Error(
        `Cannot resolve shared link (${metaRes.status}${
          metaRes.status === 404 ? " — not found or no access" : ""
        }): ${url}`,
      );
    }
    const item = (await metaRes.json()) as DriveItemJson;
    if (item.folder) {
      throw new Error(
        `Shared link points at a folder (${item.name ?? "unknown"}), not a file.`,
      );
    }

    const contentRes = await this.request(
      `/shares/${token}/driveItem/content`,
      signal,
    );
    if (!contentRes.ok) {
      throw new Error(
        `Cannot download "${item.name ?? "file"}" (${contentRes.status})`,
      );
    }
    return {
      bytes: Buffer.from(await contentRes.arrayBuffer()),
      fileName: item.name ?? "download",
    };
  }

  /**
   * Download a file given any supported SharePoint URL shape.
   * Returns the raw file bytes and the original filename.
   */
  async downloadFile(
    rawUrl: string,
    signal?: AbortSignal,
  ): Promise<{ bytes: Buffer; fileName: string }> {
    const parsed = parseSharepointUrl(rawUrl.trim());

    if (signal?.aborted) {
      throw new Error("Cancelled");
    }

    if (parsed.kind === "shared") {
      return this.downloadShared(parsed.url, signal);
    }

    const driveId = await this.resolveDrive(parsed, signal);
    const itemRef = `/drives/${driveId}/root:/${parsed.itemPath
      .split("/")
      .map(encodeURIComponent)
      .join("/")}`;
    const res = await this.request(`${itemRef}:/content`);
    if (!res.ok) {
      throw new Error(
        `Cannot download "${parsed.itemPath}" (${res.status}${
          res.status === 404 ? " — file not found" : ""
        })`,
      );
    }
    return {
      bytes: Buffer.from(await res.arrayBuffer()),
      fileName: parsed.itemPath.split("/").pop() ?? "download",
    };
  }
}
