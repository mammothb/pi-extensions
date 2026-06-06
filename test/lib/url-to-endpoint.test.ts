import { describe, expect, it } from "vitest";
import { githubUrlToEndpoint } from "../../src/lib/url-to-endpoint.js";

describe("githubUrlToEndpoint", () => {
  it("converts github.com/owner/repo to repos/owner/repo", () => {
    expect(githubUrlToEndpoint("https://github.com/octocat/Hello-World")).toBe(
      "repos/octocat/Hello-World",
    );
  });

  it("converts github.com/owner/repo/issues/42", () => {
    expect(
      githubUrlToEndpoint("https://github.com/octocat/Hello-World/issues/42"),
    ).toBe("repos/octocat/Hello-World/issues/42");
  });

  it("converts github.com/owner/repo/pull/42 to pulls (note: pull→pulls)", () => {
    expect(
      githubUrlToEndpoint("https://github.com/octocat/Hello-World/pull/42"),
    ).toBe("repos/octocat/Hello-World/pulls/42");
  });

  it("converts blob URL to contents with ref", () => {
    expect(
      githubUrlToEndpoint(
        "https://github.com/octocat/Hello-World/blob/main/src/file.ts",
      ),
    ).toBe("repos/octocat/Hello-World/contents/src/file.ts?ref=main");
  });

  it("converts tree URL to contents with ref", () => {
    expect(
      githubUrlToEndpoint(
        "https://github.com/octocat/Hello-World/tree/main/src",
      ),
    ).toBe("repos/octocat/Hello-World/contents/src?ref=main");
  });

  it("converts commit URL", () => {
    expect(
      githubUrlToEndpoint(
        "https://github.com/octocat/Hello-World/commit/abc123",
      ),
    ).toBe("repos/octocat/Hello-World/commits/abc123");
  });

  it("passes through api.github.com URLs", () => {
    expect(
      githubUrlToEndpoint(
        "https://api.github.com/repos/octocat/Hello-World/issues/42",
      ),
    ).toBe("repos/octocat/Hello-World/issues/42");
  });

  it("strips trailing slashes", () => {
    expect(githubUrlToEndpoint("https://github.com/octocat/Hello-World/")).toBe(
      "repos/octocat/Hello-World",
    );
  });

  it("ignores query parameters", () => {
    expect(
      githubUrlToEndpoint("https://github.com/octocat/Hello-World?tab=readme"),
    ).toBe("repos/octocat/Hello-World");
  });

  it("ignores hash fragments", () => {
    expect(
      githubUrlToEndpoint(
        "https://github.com/octocat/Hello-World/issues/42#issuecomment-123",
      ),
    ).toBe("repos/octocat/Hello-World/issues/42");
  });

  it("throws on invalid URL", () => {
    expect(() => githubUrlToEndpoint("not-a-url")).toThrow("Invalid URL");
  });

  it("throws on URL with no path", () => {
    expect(() => githubUrlToEndpoint("https://github.com")).toThrow(
      "Could not extract path",
    );
  });

  it("works with custom enterprise hostnames", () => {
    expect(
      githubUrlToEndpoint("https://github.internal/org/repo/issues/42"),
    ).toBe("repos/org/repo/issues/42");
  });

  it("handles issues list (no issue number, no trailing slash)", () => {
    expect(
      githubUrlToEndpoint("https://github.com/octocat/Hello-World/issues"),
    ).toBe("repos/octocat/Hello-World/issues");
  });

  it("handles pulls list (no PR number, no trailing slash)", () => {
    expect(
      githubUrlToEndpoint("https://github.com/octocat/Hello-World/pulls"),
    ).toBe("repos/octocat/Hello-World/pulls");
  });

  it("handles commits list (no trailing slash)", () => {
    expect(
      githubUrlToEndpoint("https://github.com/octocat/Hello-World/commits"),
    ).toBe("repos/octocat/Hello-World/commits");
  });

  it("passes through generic resources", () => {
    expect(
      githubUrlToEndpoint("https://github.com/octocat/Hello-World/releases/1"),
    ).toBe("repos/octocat/Hello-World/releases/1");
  });
});
