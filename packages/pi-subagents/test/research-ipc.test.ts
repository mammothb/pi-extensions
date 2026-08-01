import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { describe, expect, it, vi } from "vitest";

// Override unlinkSync so tests can force unlink failures and assert the
// poll() dedup semantics (deliver exactly once; never re-read a processed
// file, even when unlink fails).
const realFsHolder = vi.hoisted(() => ({
  realFs: null as typeof import("node:fs") | null,
}));
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  realFsHolder.realFs = actual;
  return { ...actual, unlinkSync: vi.fn() };
});

import { unlinkSync } from "node:fs";
import { researchReportPath, researchReportsDir } from "../src/lib/paths.js";
import { createIPC } from "../src/lib/research-ipc.js";
import { withAgentDir } from "./_helpers.js";

const unlinkMock = vi.mocked(unlinkSync);

const REPORT = {
  sessionId: "abc-123",
  task: "test task",
  output: "findings",
  completedAt: new Date().toISOString(),
};

function writeReport(): string {
  const path = researchReportPath("abc-123");
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(REPORT), "utf-8");
  return path;
}

// poll()/reportBack() have no internal awaits, so they run to completion
// synchronously — assertions below are safe without awaiting, and keeping
// callbacks sync honors withAgentDir's env/cleanup guarantee.
describe("FileIPC.poll", () => {
  it("delivers a report exactly once and removes the file", () => {
    withAgentDir(() => {
      unlinkMock.mockImplementation((p) => realFsHolder.realFs!.unlinkSync(p));
      const ipc = createIPC();
      const handler = vi.fn();
      ipc.onReport(handler);

      const path = writeReport();
      void ipc.poll();
      expect(handler).toHaveBeenCalledTimes(1);
      expect(existsSync(path)).toBe(false);

      void ipc.poll();
      expect(handler).toHaveBeenCalledTimes(1);
    });
  });

  it("withholds a report whose unlink fails — no delivery, no retry", () => {
    withAgentDir(() => {
      unlinkMock.mockImplementation(() => {
        throw new Error("EACCES");
      });
      const ipc = createIPC();
      const handler = vi.fn();
      ipc.onReport(handler);

      const path = writeReport();
      void ipc.poll();
      // Unlink failed after parse — report must not be delivered, and the
      // file must stay in `processed` so a later poll cannot re-deliver.
      expect(handler).not.toHaveBeenCalled();
      expect(existsSync(path)).toBe(true);

      void ipc.poll();
      expect(handler).not.toHaveBeenCalled();
    });
  });

  it("retries a malformed file on the next poll once it becomes valid", () => {
    withAgentDir(() => {
      unlinkMock.mockImplementation((p) => realFsHolder.realFs!.unlinkSync(p));
      const ipc = createIPC();
      const handler = vi.fn();
      ipc.onReport(handler);

      const path = researchReportPath("abc-123");
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, "{ not json", "utf-8");
      void ipc.poll();
      expect(handler).not.toHaveBeenCalled();
      expect(existsSync(path)).toBe(true);

      writeFileSync(path, JSON.stringify(REPORT), "utf-8");
      void ipc.poll();
      expect(handler).toHaveBeenCalledTimes(1);
      expect(existsSync(path)).toBe(false);
    });
  });

  it("reportBack writes atomically — final file only, no temp left behind", () => {
    withAgentDir(() => {
      const ipc = createIPC();
      const handler = vi.fn();
      ipc.onReport(handler);

      void ipc.reportBack(REPORT);
      const path = researchReportPath("abc-123");
      expect(readdirSync(researchReportsDir())).toEqual(["abc-123.json"]);
      expect(existsSync(path)).toBe(true);

      void ipc.poll();
      expect(handler).toHaveBeenCalledTimes(1);
    });
  });
});
