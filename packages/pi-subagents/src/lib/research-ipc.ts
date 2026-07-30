import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { updateResearchSessionStatus } from "./research-state.js";

// ── Types ───────────────────────────────────────────────────────────────────

export interface ResearchReport {
  sessionId: string;
  task: string;
  output: string;
  completedAt: string;
}

export interface ResearchIPC {
  /** Send a report from the child research session. */
  reportBack(report: ResearchReport): Promise<void>;
  /** Register a handler for delivered reports. */
  onReport(handler: (report: ResearchReport) => void): void;
  /** Unregister a handler. */
  offReport(handler: (report: ResearchReport) => void): void;
  /** Poll for pending report files and fire handlers. Returns delivered reports. */
  poll(): Promise<ResearchReport[]>;
}

// ── File IPC implementation ─────────────────────────────────────────────────

function reportsDir(): string {
  const dir = join(getAgentDir(), "research-reports");
  mkdirSync(dir, { recursive: true });
  return dir;
}

export class FileIPC implements ResearchIPC {
  private handlers = new Set<(report: ResearchReport) => void>();
  /** Track processed filenames to avoid re-delivery on repeated poll(). */
  private processed = new Set<string>();

  async reportBack(report: ResearchReport): Promise<void> {
    const path = join(reportsDir(), `${report.sessionId}.json`);
    writeFileSync(path, JSON.stringify(report, null, 2), "utf-8");
  }

  onReport(handler: (report: ResearchReport) => void): void {
    this.handlers.add(handler);
  }

  offReport(handler: (report: ResearchReport) => void): void {
    this.handlers.delete(handler);
  }

  async poll(): Promise<ResearchReport[]> {
    const dir = reportsDir();
    if (!existsSync(dir)) {
      return [];
    }

    const delivered: ResearchReport[] = [];

    for (const file of readdirSync(dir)) {
      if (!file.endsWith(".json")) {
        continue;
      }
      if (this.processed.has(file)) {
        continue;
      }
      this.processed.add(file);

      try {
        const report = JSON.parse(
          readFileSync(join(dir, file), "utf-8"),
        ) as ResearchReport;
        updateResearchSessionStatus(report.sessionId, "completed");
        delivered.push(report);
        unlinkSync(join(dir, file));
      } catch {
        // Malformed file — retry next poll
        this.processed.delete(file);
      }
    }

    if (delivered.length > 0) {
      for (const handler of this.handlers) {
        for (const report of delivered) {
          handler(report);
        }
      }
    }

    return delivered;
  }
}

export function createIPC(): ResearchIPC {
  return new FileIPC();
}
