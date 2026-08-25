import { describe, expect, it } from "vitest";
import { parseSharepointUrl } from "../src/sharepoint.js";

describe("parseSharepointUrl — direct paths", () => {
  it("parses a /sites/ URL", () => {
    expect(
      parseSharepointUrl(
        "https://contoso.sharepoint.com/sites/team/Shared Documents/report.pdf",
      ),
    ).toEqual({
      kind: "direct",
      host: "contoso.sharepoint.com",
      sitePath: "sites/team",
      itemPath: "Shared Documents/report.pdf",
    });
  });

  it("parses a /teams/ URL", () => {
    expect(
      parseSharepointUrl("https://contoso.sharepoint.com/teams/eng/a.docx"),
    ).toEqual({
      kind: "direct",
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
      kind: "direct",
      host: "contoso.sharepoint.com",
      sitePath: null,
      itemPath: "Shared Documents/file.xlsx",
    });
  });

  it("maps OneDrive personal hosts to their personal site", () => {
    expect(
      parseSharepointUrl(
        "https://contoso-my.sharepoint.com/personal/alice_contoso_com/Documents/notes.docx",
      ),
    ).toEqual({
      kind: "direct",
      host: "contoso-my.sharepoint.com",
      sitePath: "personal/alice_contoso_com",
      itemPath: "Documents/notes.docx",
    });
  });

  it("decodes percent-encoded paths", () => {
    const parsed = parseSharepointUrl(
      "https://contoso.sharepoint.com/sites/team/Docs%20Folder/my%20file.pdf",
    );
    expect(parsed).toMatchObject({ itemPath: "Docs Folder/my file.pdf" });
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

  it("rejects URLs that do not point at a file", () => {
    expect(() =>
      parseSharepointUrl("https://contoso.sharepoint.com/sites/team"),
    ).toThrow(/does not point at a file/);
  });
});

describe("parseSharepointUrl — editor pages", () => {
  it("routes _layouts Doc.aspx?sourcedoc to the shares resolver", () => {
    const raw =
      "https://contoso.sharepoint.com/sites/team/_layouts/15/Doc.aspx?sourcedoc=%7B8A5B1F2E-3C4D-4E5F-8A9B-0C1D2E3F4A5B%7D&file=report.docx&action=edit";
    expect(parseSharepointUrl(raw)).toEqual({
      kind: "shared",
      url: raw,
    });
  });

  it("strips fragments but keeps query for editor URLs", () => {
    const parsed = parseSharepointUrl(
      "https://contoso-my.sharepoint.com/personal/a/_layouts/15/Doc.aspx?sourcedoc={GUID}&file=x.xlsx#anchor",
    );
    expect(parsed.kind).toBe("shared");
    if (parsed.kind === "shared") {
      expect(parsed.url).not.toContain("#");
      expect(parsed.url).toContain("sourcedoc={GUID}");
    }
  });

  it("rejects other _layouts system pages with a clear error", () => {
    expect(() =>
      parseSharepointUrl(
        "https://contoso.sharepoint.com/sites/team/_layouts/15/viewlsts.aspx",
      ),
    ).toThrow(/Unsupported SharePoint system page/);
  });
});

describe("parseSharepointUrl — share links", () => {
  it("strips /:x:/r/ decoration when the real path is embedded", () => {
    const parsed = parseSharepointUrl(
      "https://contoso.sharepoint.com/:x:/r/sites/team/Documents/q3.xlsx?e=abc123",
    );
    expect(parsed).toEqual({
      kind: "direct",
      host: "contoso.sharepoint.com",
      sitePath: "sites/team",
      itemPath: "Documents/q3.xlsx",
    });
  });

  it("works on personal hosts too", () => {
    const parsed = parseSharepointUrl(
      "https://contoso-my.sharepoint.com/:w:/r/personal/alice_contoso_com/Documents/draft.docx?e=5",
    );
    expect(parsed).toEqual({
      kind: "direct",
      host: "contoso-my.sharepoint.com",
      sitePath: "personal/alice_contoso_com",
      itemPath: "Documents/draft.docx",
    });
  });

  it("falls back to the shares resolver for opaque short forms", () => {
    const raw = "https://contoso.sharepoint.com/:x:/s/sites/team/EYz8mNtoken";
    expect(parseSharepointUrl(raw)).toEqual({
      kind: "shared",
      url: raw,
    });
  });
});

describe("parseSharepointUrl — browser folder views", () => {
  it("extracts the file from AllItems.aspx?id=", () => {
    const parsed = parseSharepointUrl(
      "https://contoso.sharepoint.com/sites/team/Shared%20Documents/Forms/AllItems.aspx?id=%2Fsites%2Fteam%2FShared%20Documents%2Fplan.pdf&viewid=abc&e=xyz",
    );
    expect(parsed).toEqual({
      kind: "direct",
      host: "contoso.sharepoint.com",
      sitePath: "sites/team",
      itemPath: "Shared Documents/plan.pdf",
    });
  });

  it("ignores id= params that point at folders", () => {
    // Folder view without a selected file → falls through to path handling,
    // which rejects the AllItems.aspx folder view itself.
    expect(() =>
      parseSharepointUrl(
        "https://contoso.sharepoint.com/sites/team/Shared Documents/Forms/AllItems.aspx?id=/sites/team/Shared%20Documents&parent=/sites/team",
      ),
    ).toThrow(/folder view/);
  });
});
