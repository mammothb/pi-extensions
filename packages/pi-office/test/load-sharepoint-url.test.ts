import { describe, expect, it } from "vitest";
import { parseSharepointUrl } from "../src/sharepoint.js";

describe("parseSharepointUrl", () => {
  it("parses a /sites/ URL", () => {
    expect(
      parseSharepointUrl(
        "https://contoso.sharepoint.com/sites/team/Shared Documents/report.pdf",
      ),
    ).toEqual({
      host: "contoso.sharepoint.com",
      sitePath: "sites/team",
      itemPath: "Shared Documents/report.pdf",
    });
  });

  it("parses a /teams/ URL", () => {
    expect(
      parseSharepointUrl("https://contoso.sharepoint.com/teams/eng/a.docx"),
    ).toEqual({
      host: "contoso.sharepoint.com",
      sitePath: "teams/eng",
      itemPath: "a.docx",
    });
  });

  it("treats a bare host as the root site", () => {
    expect(
      parseSharepointUrl(
        "https://contoso.sharepoint.com/Shared Documents/file.xlsx",
      ),
    ).toEqual({
      host: "contoso.sharepoint.com",
      sitePath: null,
      itemPath: "Shared Documents/file.xlsx",
    });
  });

  it("decodes percent-encoded paths", () => {
    const parsed = parseSharepointUrl(
      "https://contoso.sharepoint.com/sites/team/Docs%20Folder/my%20file.pdf",
    );
    expect(parsed.itemPath).toBe("Docs Folder/my file.pdf");
  });

  it("rejects non-https URLs", () => {
    expect(() =>
      parseSharepointUrl("http://contoso.sharepoint.com/sites/team/f.pdf"),
    ).toThrow(/https/);
  });

  it("rejects unparseable URLs", () => {
    expect(() => parseSharepointUrl("not a url")).toThrow(
      /Invalid SharePoint URL/,
    );
  });

  it("handles nested site names", () => {
    const parsed = parseSharepointUrl(
      "https://contoso.sharepoint.com/sites/my.team.name/deep/dir/file.txt",
    );
    // Only the first two segments form the site reference; Graph site
    // resolution uses the canonical /sites/<name> path.
    expect(parsed.sitePath).toBe("sites/my.team.name");
    expect(parsed.itemPath).toBe("deep/dir/file.txt");
  });
});
