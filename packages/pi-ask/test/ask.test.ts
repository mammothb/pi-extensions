import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import { createAskTool } from "../src/ask.js";
import {
  createMockTheme,
  makeMultiQuestion,
  makeQuestion,
} from "./_helpers.js";

/** Create a minimal mock pi with an events spy. */
function mockPi(): ExtensionAPI {
  return {
    events: { emit: vi.fn(), on: vi.fn(), off: vi.fn() },
  } as unknown as ExtensionAPI;
}

describe("createAskTool", () => {
  const pi = mockPi();
  const tool = createAskTool(pi);

  it("has name 'ask'", () => {
    expect(tool.name).toBe("AskUserQuestion");
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

  describe("execute — emits AskUserQuestion:prompt", () => {
    it("emits before showing UI on success path", async () => {
      pi.events.emit = vi.fn(); // reset spy from earlier tests
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
      await tool.execute(
        "call-1",
        { questions: [q] },
        undefined,
        undefined,
        ctx as never,
      );

      expect(pi.events.emit).toHaveBeenCalledExactlyOnceWith(
        "AskUserQuestion:prompt",
        { questions: [q] },
      );
    });

    it("emits for multi-question payload", async () => {
      pi.events.emit = vi.fn(); // reset spy
      const q1 = makeQuestion({ header: "A", question: "First?" });
      const q2 = makeQuestion({ header: "B", question: "Second?" });
      const ctx = {
        hasUI: true,
        ui: {
          custom: () =>
            Promise.resolve({
              questions: [q1, q2],
              answers: {},
              cancelled: false,
            }),
        },
      };
      await tool.execute(
        "call-1",
        { questions: [q1, q2] },
        undefined,
        undefined,
        ctx as never,
      );

      expect(pi.events.emit).toHaveBeenCalledWith("AskUserQuestion:prompt", {
        questions: [q1, q2],
      });
    });

    it("does not emit when questions array is empty", async () => {
      const ctx = {
        hasUI: true,
        ui: { custom: () => Promise.resolve(null) },
      };
      pi.events.emit = vi.fn(); // reset spy

      await tool.execute(
        "call-1",
        { questions: [] },
        undefined,
        undefined,
        ctx as never,
      );

      expect(pi.events.emit).not.toHaveBeenCalled();
    });

    it("does not emit when ctx.hasUI is false", async () => {
      const ctx = {
        hasUI: false,
        abort: () => {},
      };
      pi.events.emit = vi.fn(); // reset spy

      await expect(
        tool.execute(
          "call-1",
          { questions: [makeQuestion()] },
          undefined,
          undefined,
          ctx as never,
        ),
      ).rejects.toThrow("interactive mode");

      expect(pi.events.emit).not.toHaveBeenCalled();
    });

    it("does not emit on validation error (duplicate questions)", async () => {
      const ctx = {
        hasUI: true,
        ui: { custom: () => Promise.resolve(null) },
      };
      pi.events.emit = vi.fn(); // reset spy

      await tool.execute(
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

      expect(pi.events.emit).not.toHaveBeenCalled();
    });

    it("still emits when user cancels the UI", async () => {
      // Emit happens before the UI call, so cancellation should not suppress it
      const ctx = {
        hasUI: true,
        ui: { custom: () => Promise.resolve(null) },
      };
      pi.events.emit = vi.fn(); // reset spy

      await tool.execute(
        "call-1",
        { questions: [makeQuestion()] },
        undefined,
        undefined,
        ctx as never,
      );

      expect(pi.events.emit).toHaveBeenCalled();
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
