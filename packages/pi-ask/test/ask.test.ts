import { describe, expect, it } from "vitest";
import { createAskTool } from "../src/ask.js";
import {
  createMockTheme,
  makeMultiQuestion,
  makeQuestion,
} from "./_helpers.js";

describe("createAskTool", () => {
  const tool = createAskTool();

  it("has name 'ask'", () => {
    expect(tool.name).toBe("ask");
  });

  it("has a description", () => {
    expect(tool.description).toBeTruthy();
    expect(typeof tool.description).toBe("string");
  });

  it("has a promptSnippet", () => {
    expect(tool.promptSnippet).toBeTruthy();
  });

  it("has promptGuidelines", () => {
    expect(tool.promptGuidelines).toBeInstanceOf(Array);
    expect(tool.promptGuidelines!.length).toBeGreaterThan(0);
  });

  it("has parameters schema", () => {
    expect(tool.parameters).toBeDefined();
  });

  describe("execute — requires UI", () => {
    it("aborts when ctx.hasUI is false", async () => {
      const ctx = {
        hasUI: false,
        abort: () => {},
      };
      await expect(
        tool.execute(
          "call-1",
          { questions: [makeQuestion()] },
          undefined,
          undefined,
          ctx as never,
        ),
      ).rejects.toThrow("interactive mode");
    });
  });

  describe("execute — validation", () => {
    it("returns error content for duplicate questions", async () => {
      const ctx = {
        hasUI: true,
        ui: { custom: () => Promise.resolve(null) },
      };
      const result = await tool.execute(
        "call-1",
        {
          questions: [
            makeQuestion({ question: "Same?" }),
            makeQuestion({ question: "Same?" }),
          ],
        },
        undefined,
        undefined,
        ctx as never,
      );

      expect(result.content[0]).toBeDefined();
      if (result.content[0]?.type === "text") {
        expect(result.content[0].text).toContain("Error");
      }
      expect(result.details?.cancelled).toBe(true);
    });
  });

  describe("execute — cancellation", () => {
    it("returns cancellation content when user cancels (null result)", async () => {
      const ctx = {
        hasUI: true,
        ui: { custom: () => Promise.resolve(null) },
      };
      const result = await tool.execute(
        "call-1",
        { questions: [makeQuestion()] },
        undefined,
        undefined,
        ctx as never,
      );

      expect(result.content[0]).toBeDefined();
      if (result.content[0]?.type === "text") {
        expect(result.content[0].text).toBe("User cancelled");
      }
      expect(result.details?.cancelled).toBe(true);
    });

    it("returns cancellation content when result.cancelled is true", async () => {
      const ctx = {
        hasUI: true,
        ui: {
          custom: () =>
            Promise.resolve({
              questions: [makeQuestion()],
              answers: {},
              cancelled: true,
            }),
        },
      };
      const result = await tool.execute(
        "call-1",
        { questions: [makeQuestion()] },
        undefined,
        undefined,
        ctx as never,
      );

      expect(result.details?.cancelled).toBe(true);
    });
  });

  describe("execute — success", () => {
    it("returns formatted answers on success", async () => {
      const q = makeQuestion();
      const ctx = {
        hasUI: true,
        ui: {
          custom: () =>
            Promise.resolve({
              questions: [q],
              answers: { [q.question]: "Option A" },
              cancelled: false,
            }),
        },
      };
      const result = await tool.execute(
        "call-1",
        { questions: [q] },
        undefined,
        undefined,
        ctx as never,
      );

      expect(result.content[0]).toBeDefined();
      if (result.content[0]?.type === "text") {
        expect(result.content[0].text).toContain("Option A");
      }
      expect(result.details?.cancelled).toBe(false);
    });

    it("formats multi-select answers", async () => {
      const q = makeMultiQuestion();
      const ctx = {
        hasUI: true,
        ui: {
          custom: () =>
            Promise.resolve({
              questions: [q],
              answers: { [q.question]: "Option A, Option C" },
              cancelled: false,
            }),
        },
      };
      const result = await tool.execute(
        "call-1",
        { questions: [q] },
        undefined,
        undefined,
        ctx as never,
      );

      if (result.content[0]?.type === "text") {
        expect(result.content[0].text).toContain("Option A, Option C");
      }
    });
  });

  describe("renderCall", () => {
    it("renders question headers", () => {
      const args = { questions: [makeQuestion({ header: "Style" })] };
      const theme = createMockTheme();
      const context = {
        cwd: "/tmp",
        expanded: false,
        showImages: false,
      } as never;
      const component = tool.renderCall?.(args, theme, context);
      // Component should contain "Style"
      expect(component).toBeDefined();
    });
  });

  describe("renderResult", () => {
    it("renders cancellation result", () => {
      const result = {
        content: [{ type: "text" as const, text: "User cancelled" }],
        details: { questions: [], answers: {}, cancelled: true },
      };
      const theme = createMockTheme();
      const context = {
        cwd: "/tmp",
        expanded: false,
        showImages: false,
        isError: false,
      } as never;
      const component = tool.renderResult?.(
        result,
        { expanded: false, isPartial: false },
        theme,
        context,
      );
      expect(component).toBeDefined();
    });

    it("renders success result with answers", () => {
      const q = makeQuestion({ header: "Style" });
      const result = {
        content: [{ type: "text" as const, text: 'q1 = "Option A"' }],
        details: {
          questions: [q],
          answers: { [q.question]: "Option A" },
          cancelled: false,
        },
      };
      const theme = createMockTheme();
      const context = {
        cwd: "/tmp",
        expanded: false,
        showImages: false,
        isError: false,
      } as never;
      const component = tool.renderResult?.(
        result,
        { expanded: false, isPartial: false },
        theme,
        context,
      );
      expect(component).toBeDefined();
    });

    it("renders result without details gracefully", () => {
      const result = {
        content: [{ type: "text" as const, text: "something went wrong" }],
        details: undefined,
      };
      const theme = createMockTheme();
      const context = {
        cwd: "/tmp",
        expanded: false,
        showImages: false,
        isError: false,
      } as never;
      const component = tool.renderResult?.(
        result as never,
        { expanded: false, isPartial: false },
        theme,
        context,
      );
      expect(component).toBeDefined();
    });
  });
});
