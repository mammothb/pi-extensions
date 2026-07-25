import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseFrontmatter } from "../src/lib/agents.js";

const FIXTURES = join(__dirname, "fixtures", "agents");

function readFixture(name: string): string {
  return readFileSync(join(FIXTURES, name), "utf-8");
}

describe("parseFrontmatter", () => {
  it("parses valid frontmatter with all fields", () => {
    const content = readFixture("valid.md");
    const result = parseFrontmatter(content, "valid.md");

    expect(result.frontmatter).not.toBeNull();
    expect(result.frontmatter).toEqual({
      name: "researcher",
      model: "cheap",
      tools: "read,grep,find",
    });
    expect(result.body).toBe("You are a research agent.\n");
  });

  it("returns null frontmatter when file has no --- opener", () => {
    const content = readFixture("no-opener.md");
    const result = parseFrontmatter(content, "no-opener.md");

    expect(result.frontmatter).toBeNull();
    expect(result.body).toBe(content);
  });

  it("returns null frontmatter when --- is unclosed", () => {
    const content = readFixture("unclosed.md");
    const result = parseFrontmatter(content, "unclosed.md");

    expect(result.frontmatter).toBeNull();
    expect(result.body).toBe(content);
  });

  it("handles --- inside body text without false closing", () => {
    const content = readFixture("body-dashes.md");
    const result = parseFrontmatter(content, "body-dashes.md");

    expect(result.frontmatter).not.toBeNull();
    expect(result.frontmatter).toEqual({ name: "dashy" });
    // Body should include the second --- and everything after it
    expect(result.body).toContain("--- dashes ---");
    expect(result.body).toContain("just ---");
  });

  it("handles empty frontmatter block", () => {
    const content = readFixture("empty-frontmatter.md");
    const result = parseFrontmatter(content, "empty-frontmatter.md");

    expect(result.frontmatter).not.toBeNull();
    expect(result.frontmatter).toEqual({});
    expect(result.body).toBe("Body starts here.\n");
  });

  it("strips whitespace and quotes from values", () => {
    const content = readFixture("whitespace.md");
    const result = parseFrontmatter(content, "whitespace.md");

    expect(result.frontmatter).not.toBeNull();
    expect(result.frontmatter).toEqual({
      name: "quoted name",
      model: "provider/model",
      tools: "read,edit",
    });
    expect(result.body).toBe("Body text.\n");
  });

  it("handles inline frontmatter with no body", () => {
    const result = parseFrontmatter("---\nname: x\n---", "inline.md");

    expect(result.frontmatter).not.toBeNull();
    expect(result.frontmatter).toEqual({ name: "x" });
    expect(result.body).toBe("");
  });
});
