import { describe, expect, it } from "vitest";
import { ApprovalCache } from "../../src/lib/approval-cache.js";

describe("ApprovalCache", () => {
  it("returns undefined for unknown keys", () => {
    const store = new ApprovalCache();
    expect(store.has("bash:git status")).toBe(false);
    expect(store.get("bash:git status")).toBeUndefined();
  });

  it("stores and retrieves allow decisions", () => {
    const store = new ApprovalCache();
    store.set("bash:git status", "allow");
    expect(store.has("bash:git status")).toBe(true);
    expect(store.get("bash:git status")).toBe("allow");
  });

  it("stores and retrieves deny decisions", () => {
    const store = new ApprovalCache();
    store.set("eval", "deny");
    expect(store.has("eval")).toBe(true);
    expect(store.get("eval")).toBe("deny");
  });

  it("overwrites existing decisions", () => {
    const store = new ApprovalCache();
    store.set("bash:git status", "deny");
    store.set("bash:git status", "allow");
    expect(store.get("bash:git status")).toBe("allow");
  });

  it("clear removes all decisions", () => {
    const store = new ApprovalCache();
    store.set("bash:git status", "allow");
    store.set("write:.env", "deny");
    store.clear();
    expect(store.has("bash:git status")).toBe(false);
    expect(store.has("write:.env")).toBe(false);
  });

  it("multiple keys are independent", () => {
    const store = new ApprovalCache();
    store.set("bash:git status", "allow");
    store.set("bash:rm -rf /", "deny");
    expect(store.get("bash:git status")).toBe("allow");
    expect(store.get("bash:rm -rf /")).toBe("deny");
  });

  it("handles empty strings as keys", () => {
    const store = new ApprovalCache();
    store.set("", "allow");
    expect(store.get("")).toBe("allow");
    // Keys with only whitespace are treated literally
    store.set(" ", "deny");
    expect(store.get(" ")).toBe("deny");
  });
});
