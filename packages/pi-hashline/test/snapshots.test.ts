import { describe, expect, it } from "vitest";

import { InMemorySnapshotStore } from "../src/snapshots";

describe("InMemorySnapshotStore", () => {
  it("record returns a 4-char uppercase hex tag", () => {
    const store = new InMemorySnapshotStore();
    const tag = store.record("src/foo.ts", "const x = 42;\n");
    expect(tag).toHaveLength(4);
    expect(tag).toMatch(/^[0-9A-F]{4}$/);
  });

  it("recording identical content twice returns the same tag (read fusion)", () => {
    const store = new InMemorySnapshotStore();
    const tag1 = store.record("src/foo.ts", "hello\n");
    const tag2 = store.record("src/foo.ts", "hello\n");
    expect(tag1).toBe(tag2);
  });

  it("recording different content returns a different tag", () => {
    const store = new InMemorySnapshotStore();
    const tag1 = store.record("src/foo.ts", "hello\n");
    const tag2 = store.record("src/foo.ts", "world\n");
    expect(tag1).not.toBe(tag2);
  });

  it("head returns the latest snapshot", () => {
    const store = new InMemorySnapshotStore();
    store.record("src/foo.ts", "version 1\n");
    store.record("src/foo.ts", "version 2\n");
    const head = store.head("src/foo.ts");
    expect(head).not.toBeNull();
    expect(head!.text).toBe("version 2\n");
  });

  it("head returns null for unknown path", () => {
    const store = new InMemorySnapshotStore();
    expect(store.head("nonexistent.ts")).toBeNull();
  });

  it("byHash resolves a historical version", () => {
    const store = new InMemorySnapshotStore();
    const tag1 = store.record("src/foo.ts", "version 1\n");
    store.record("src/foo.ts", "version 2\n");

    const snapshot = store.byHash("src/foo.ts", tag1);
    expect(snapshot).not.toBeNull();
    expect(snapshot!.text).toBe("version 1\n");
    expect(snapshot!.hash).toBe(tag1);
  });

  it("byHash returns null for unknown hash", () => {
    const store = new InMemorySnapshotStore();
    store.record("src/foo.ts", "hello\n");
    expect(store.byHash("src/foo.ts", "FFFF")).toBeNull();
  });

  it("byHash returns null for unknown path", () => {
    const store = new InMemorySnapshotStore();
    expect(store.byHash("nonexistent.ts", "A1B2")).toBeNull();
  });

  it("caps versions per path (default 4)", () => {
    const store = new InMemorySnapshotStore({ maxVersionsPerPath: 4 });
    const tags: string[] = [];
    for (let i = 0; i < 6; i++) {
      tags.push(store.record("src/foo.ts", `version ${i}\n`));
    }

    // Head should be the latest (version 5).
    expect(store.head("src/foo.ts")!.text).toBe("version 5\n");

    // The oldest (version 0 and version 1) should be evicted.
    expect(store.byHash("src/foo.ts", tags[0]!)).toBeNull();
    expect(store.byHash("src/foo.ts", tags[1]!)).toBeNull();

    // Versions 2-5 should still be available.
    for (let i = 2; i < 6; i++) {
      expect(store.byHash("src/foo.ts", tags[i]!)).not.toBeNull();
    }
  });

  it("evicts coldest path when path cap is exceeded", () => {
    const store = new InMemorySnapshotStore({ maxPaths: 3 });
    store.record("a.ts", "a\n");
    store.record("b.ts", "b\n");
    store.record("c.ts", "c\n");

    // All three should be present.
    expect(store.head("a.ts")).not.toBeNull();
    expect(store.head("b.ts")).not.toBeNull();
    expect(store.head("c.ts")).not.toBeNull();

    // Recording a 4th path evicts the LRU (a.ts).
    store.record("d.ts", "d\n");
    expect(store.head("a.ts")).toBeNull();
    expect(store.head("b.ts")).not.toBeNull();
    expect(store.head("c.ts")).not.toBeNull();
    expect(store.head("d.ts")).not.toBeNull();
  });

  it("re-recording a path refreshes its LRU position", () => {
    const store = new InMemorySnapshotStore({ maxPaths: 3 });
    store.record("a.ts", "a\n");
    store.record("b.ts", "b\n");
    store.record("c.ts", "c\n");

    // Touch a.ts again — it should no longer be the LRU.
    store.record("a.ts", "a2\n");

    // Now add a 4th path: b.ts should be evicted (oldest).
    store.record("d.ts", "d\n");
    expect(store.head("a.ts")).not.toBeNull();
    expect(store.head("b.ts")).toBeNull();
    expect(store.head("c.ts")).not.toBeNull();
    expect(store.head("d.ts")).not.toBeNull();
  });

  it("invalidate removes a single path", () => {
    const store = new InMemorySnapshotStore();
    store.record("a.ts", "a\n");
    store.record("b.ts", "b\n");
    store.invalidate("a.ts");
    expect(store.head("a.ts")).toBeNull();
    expect(store.head("b.ts")).not.toBeNull();
  });

  it("clear removes all paths", () => {
    const store = new InMemorySnapshotStore();
    store.record("a.ts", "a\n");
    store.record("b.ts", "b\n");
    store.clear();
    expect(store.head("a.ts")).toBeNull();
    expect(store.head("b.ts")).toBeNull();
  });
});
