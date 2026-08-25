import { resolveSecret } from "@mammothb/pi-shared";
import type { SharepointConfig } from "./config.js";

/**
 * Minimal Microsoft Graph client for downloading SharePoint files.
 *
 * Flow per file URL (site/drive lookups cached per session):
 *   1. GET /sites/{host}:{sitePath}          → site id
 *   2. GET /sites/{siteId}/drive             → drive id
 *   3. GET /drives/{driveId}/root:/{path}:/content → file bytes
 */

export interface ParsedSharepointUrl {
  /** SharePoint host, e.g. "contoso.sharepoint.com". */
  host: string;
  /** Site path without leading slash, e.g. "sites/team". Null for root site. */
  sitePath: string | null;
  /** Item path inside the drive, no leading slash, e.g. "Shared Documents/report.pdf". */
  itemPath: string;
}

/** Site URL prefixes under which a site lives below the host root. */
const SITE_SEGMENTS = new Set(["sites", "teams"]);

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

  const [first, second] = segments;
  if (first && second && SITE_SEGMENTS.has(first.toLowerCase())) {
    return {
      host: url.host,
      sitePath: `${first}/${second}`,
      itemPath: segments.slice(2).join("/"),
    };
  }

  // Root site — everything in the path belongs to the default drive.
  return {
    host: url.host,
    sitePath: null,
    itemPath: segments.join("/"),
  };
}

interface ResolvedLocation {
  driveId: string;
  sitePathKey: string;
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

  private async request(path: string): Promise<Response> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      headers: { Authorization: `Bearer ${this.token()}` },
      signal: AbortSignal.timeout(60_000),
    });
    if (res.status === 401 || res.status === 403) {
      throw new Error(
        `SharePoint request unauthorized (${res.status}). The token from ` +
          `"${this.tokenSource}" may be expired or lack Files.Read permission.`,
      );
    }
    return res;
  }

  private async resolveDrive(parsed: ParsedSharepointUrl): Promise<string> {
    const key = `${parsed.host}/${parsed.sitePath ?? ""}`;
    const cached = this.drives.get(key);
    if (cached) {
      return cached.driveId;
    }

    const siteRef = parsed.sitePath
      ? `${parsed.host}:${parsed.sitePath}`
      : parsed.host;
    const siteRes = await this.request(`/sites/${siteRef}`);
    if (!siteRes.ok) {
      throw new Error(
        `Cannot access SharePoint site (${siteRes.status}): ${siteRef}`,
      );
    }
    const site = (await siteRes.json()) as { id: string };

    const driveRes = await this.request(`/sites/${site.id}/drive`);
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
   * Download a file given its full SharePoint URL.
   * Returns the raw file bytes and the original filename.
   */
  async downloadFile(
    rawUrl: string,
  ): Promise<{ bytes: Buffer; fileName: string }> {
    const parsed = parseSharepointUrl(rawUrl);
    if (!parsed.itemPath) {
      throw new Error(
        `URL does not point at a file: "${rawUrl}". Expected the full path ` +
          `to a document inside a document library.`,
      );
    }
    const driveId = await this.resolveDrive(parsed);
    const itemRef = `/drives/${driveId}/root:/${parsed.itemPath.split("/").map(encodeURIComponent).join("/")}`;
    const res = await this.request(`${itemRef}:/content`);
    if (!res.ok) {
      throw new Error(
        `Cannot download "${parsed.itemPath}" (${res.status}${
          res.status === 404 ? " — file not found" : ""
        })`,
      );
    }
    const bytes = Buffer.from(await res.arrayBuffer());
    const fileName = parsed.itemPath.split("/").pop() ?? "download";
    return { bytes, fileName };
  }
}
