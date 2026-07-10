import { Value } from "typebox/value";
import { describe, expect, it } from "vitest";
import { FormatSchema } from "../src/lib/types.js";

describe("FormatSchema", () => {
  it('accepts "text"', () => {
    expect(Value.Check(FormatSchema, "text")).toBe(true);
  });

  it('accepts "markdown"', () => {
    expect(Value.Check(FormatSchema, "markdown")).toBe(true);
  });

  it('accepts "html"', () => {
    expect(Value.Check(FormatSchema, "html")).toBe(true);
  });

  it("rejects invalid values", () => {
    expect(Value.Check(FormatSchema, "json")).toBe(false);
    expect(Value.Check(FormatSchema, "")).toBe(false);
    expect(Value.Check(FormatSchema, "pdf")).toBe(false);
  });

  it("rejects non-string values", () => {
    expect(Value.Check(FormatSchema, 42)).toBe(false);
    expect(Value.Check(FormatSchema, null)).toBe(false);
    expect(Value.Check(FormatSchema, undefined)).toBe(false);
    expect(Value.Check(FormatSchema, true)).toBe(false);
  });
});
