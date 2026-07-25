import { describe, expect, it } from "vitest";
import { isTextContent } from "../src/is-text-content.js";

describe("isTextContent", () => {
  it("returns true for text content blocks", () => {
    expect(isTextContent({ type: "text" as const, text: "hello" })).toBe(true);
  });

  it("returns false for image content blocks", () => {
    expect(
      isTextContent({
        type: "image" as const,
        data: "base64...",
        mimeType: "image/png",
      }),
    ).toBe(false);
  });

  it("narrows type via TypeScript type guard", () => {
    const block: { type: "text"; text: string } | { type: "image" } = {
      type: "text",
      text: "x",
    };
    if (isTextContent(block)) {
      // If this compiles, the type guard works
      const _text: string = block.text;
      expect(_text).toBe("x");
    }
  });
});
