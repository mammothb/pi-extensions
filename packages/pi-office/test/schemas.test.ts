import { describe, expect, it } from "vitest";
import {
  ReadDocxSchema,
  ReadPdfSchema,
  ReadXlsxSchema,
  SearchDocxSchema,
  SearchPdfSchema,
  SearchXlsxSchema,
} from "../src/schemas.js";

describe("ReadPdfSchema", () => {
  it("has path as required string property", () => {
    const pathProp = ReadPdfSchema.properties.path;
    expect(pathProp.type).toBe("string");
  });

  it("has pages as optional string property", () => {
    const pagesProp = ReadPdfSchema.properties.pages;
    expect(pagesProp.type).toBe("string");
  });

  it("has maxPages as optional integer property with minimum 1", () => {
    const maxPagesProp = ReadPdfSchema.properties.maxPages;
    expect(maxPagesProp.type).toBe("integer");
    expect(maxPagesProp.minimum).toBe(1);
  });

  it("has password as optional string property", () => {
    const passwordProp = ReadPdfSchema.properties.password;
    expect(passwordProp.type).toBe("string");
  });

  it("marks password as optional (not in required array)", () => {
    expect(ReadPdfSchema.required).not.toContain("password");
  });

  it("includes path in required array", () => {
    expect(ReadPdfSchema.required).toContain("path");
  });
});

describe("SearchPdfSchema", () => {
  it("has path as required string property", () => {
    const prop = SearchPdfSchema.properties.path;
    expect(prop.type).toBe("string");
    expect(SearchPdfSchema.required).toContain("path");
  });

  it("has query as required string property", () => {
    const prop = SearchPdfSchema.properties.query;
    expect(prop.type).toBe("string");
    expect(SearchPdfSchema.required).toContain("query");
  });

  it("has contextLines as optional integer with minimum 0 and maximum 5", () => {
    const prop = SearchPdfSchema.properties.contextLines;
    expect(prop.type).toBe("integer");
    expect(prop.minimum).toBe(0);
    expect(prop.maximum).toBe(5);
    expect(SearchPdfSchema.required).not.toContain("contextLines");
  });

  it("has maxMatches as optional integer with minimum 1", () => {
    const prop = SearchPdfSchema.properties.maxMatches;
    expect(prop.type).toBe("integer");
    expect(prop.minimum).toBe(1);
    expect(prop.maximum).toBeUndefined();
    expect(SearchPdfSchema.required).not.toContain("maxMatches");
  });

  it("has password as optional string property", () => {
    const prop = SearchPdfSchema.properties.password;
    expect(prop.type).toBe("string");
    expect(SearchPdfSchema.required).not.toContain("password");
  });

  it("requires only path and query", () => {
    expect(SearchPdfSchema.required).toEqual(["path", "query"]);
  });
});

describe("ReadDocxSchema", () => {
  it("has path as required string property", () => {
    const prop = ReadDocxSchema.properties.path;
    expect(prop.type).toBe("string");
    expect(ReadDocxSchema.required).toContain("path");
  });

  it("has maxChars as optional integer with minimum 1", () => {
    const prop = ReadDocxSchema.properties.maxChars;
    expect(prop.type).toBe("integer");
    expect(prop.minimum).toBe(1);
    expect(ReadDocxSchema.required).not.toContain("maxChars");
  });

  it("requires only path", () => {
    expect(ReadDocxSchema.required).toEqual(["path"]);
  });
});

describe("SearchDocxSchema", () => {
  it("has path as required string property", () => {
    const prop = SearchDocxSchema.properties.path;
    expect(prop.type).toBe("string");
    expect(SearchDocxSchema.required).toContain("path");
  });

  it("has query as required string property", () => {
    const prop = SearchDocxSchema.properties.query;
    expect(prop.type).toBe("string");
    expect(SearchDocxSchema.required).toContain("query");
  });

  it("has contextChars as optional integer with minimum 20 and maximum 500", () => {
    const prop = SearchDocxSchema.properties.contextChars;
    expect(prop.type).toBe("integer");
    expect(prop.minimum).toBe(20);
    expect(prop.maximum).toBe(500);
    expect(SearchDocxSchema.required).not.toContain("contextChars");
  });

  it("has maxMatches as optional integer with minimum 1", () => {
    const prop = SearchDocxSchema.properties.maxMatches;
    expect(prop.type).toBe("integer");
    expect(prop.minimum).toBe(1);
    expect(prop.maximum).toBeUndefined();
    expect(SearchDocxSchema.required).not.toContain("maxMatches");
  });

  it("requires only path and query", () => {
    expect(SearchDocxSchema.required).toEqual(["path", "query"]);
  });
});

describe("ReadXlsxSchema", () => {
  it("has path as required string property", () => {
    const prop = ReadXlsxSchema.properties.path;
    expect(prop.type).toBe("string");
    expect(ReadXlsxSchema.required).toContain("path");
  });

  it("has sheet as optional string property", () => {
    const prop = ReadXlsxSchema.properties.sheet;
    expect(prop.type).toBe("string");
    expect(ReadXlsxSchema.required).not.toContain("sheet");
  });

  it("has maxRows as optional integer with minimum 1", () => {
    const prop = ReadXlsxSchema.properties.maxRows;
    expect(prop.type).toBe("integer");
    expect(prop.minimum).toBe(1);
    expect(ReadXlsxSchema.required).not.toContain("maxRows");
  });

  it("requires only path", () => {
    expect(ReadXlsxSchema.required).toEqual(["path"]);
  });
});

describe("SearchXlsxSchema", () => {
  it("has path as required string property", () => {
    const prop = SearchXlsxSchema.properties.path;
    expect(prop.type).toBe("string");
    expect(SearchXlsxSchema.required).toContain("path");
  });

  it("has query as required string property", () => {
    const prop = SearchXlsxSchema.properties.query;
    expect(prop.type).toBe("string");
    expect(SearchXlsxSchema.required).toContain("query");
  });

  it("has sheet as optional string property", () => {
    const prop = SearchXlsxSchema.properties.sheet;
    expect(prop.type).toBe("string");
    expect(SearchXlsxSchema.required).not.toContain("sheet");
  });

  it("has maxMatches as optional integer with minimum 1", () => {
    const prop = SearchXlsxSchema.properties.maxMatches;
    expect(prop.type).toBe("integer");
    expect(prop.minimum).toBe(1);
    expect(prop.maximum).toBeUndefined();
    expect(SearchXlsxSchema.required).not.toContain("maxMatches");
  });

  it("requires only path and query", () => {
    expect(SearchXlsxSchema.required).toEqual(["path", "query"]);
  });
});
