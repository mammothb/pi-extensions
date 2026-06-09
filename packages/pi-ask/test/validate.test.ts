import { describe, expect, it } from "vitest";
import { validateUniqueQuestions } from "../src/lib/validate.js";
import { makeMultiQuestion, makeQuestion } from "./_helpers.js";

describe("validateUniqueQuestions", () => {
  it("returns null for valid single question", () => {
    expect(validateUniqueQuestions([makeQuestion()])).toBeNull();
  });

  it("returns null for valid multiple questions", () => {
    const qs = [
      makeQuestion({ question: "A?" }),
      makeQuestion({ question: "B?" }),
    ];
    expect(validateUniqueQuestions(qs)).toBeNull();
  });

  it("detects duplicate question text", () => {
    const qs = [
      makeQuestion({ question: "Same?" }),
      makeQuestion({ question: "Same?" }),
    ];
    const err = validateUniqueQuestions(qs);
    expect(err).toContain("Duplicate question");
    expect(err).toContain("Same?");
  });

  it("detects duplicate option labels within a question", () => {
    const q = makeQuestion({
      options: [{ label: "A" }, { label: "B" }, { label: "A" }],
    });
    const err = validateUniqueQuestions([q]);
    expect(err).toContain("Duplicate option label");
    expect(err).toContain("A");
  });

  it("allows same option label across different questions", () => {
    const qs = [
      makeQuestion({
        question: "Q1",
        options: [{ label: "A" }, { label: "B" }],
      }),
      makeQuestion({
        question: "Q2",
        options: [{ label: "A" }, { label: "C" }],
      }),
    ];
    expect(validateUniqueQuestions(qs)).toBeNull();
  });

  it("returns null for valid multi-select question", () => {
    expect(validateUniqueQuestions([makeMultiQuestion()])).toBeNull();
  });
});
