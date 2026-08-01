import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  unlinkSync,
  watch,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { researchReportPath, researchReportsDir } from "./paths.js";
import { updateResearchSessionStatus } from "./research-state.js";

// ── Types ───────────────────────────────────────────────────────────────────

export interface ResearchReport {
  sessionId: string;
  task: string;
  output: string;
  completedAt: string;
}

/** Dispose function for registered listeners / watchers. */
export type Unsubscribe = () => void;

/** Child process role: send a report back to the parent. */
export interface ResearchReporter {
  reportBack(report: ResearchReport): Promise<void>;
}

/** Parent process role: receive reports from research children. */
export interface ResearchReceiver {
  /**
   * Subscribe to incoming reports. Returns an unsubscribe function
   * (the caller doesn't need to hold a stable reference for offReport).
   */
  onReport(handler: (report: ResearchReport) => void): Unsubscribe;

  /**
   * Activate push delivery — watch for new report files and fire onReport
   * handlers as soon as they land. Returns a cleanup function to tear down
   * watchers / listeners.
   */
  start(): Promise<Unsubscribe>;

  /**
   * Explicit poll trigger for lifecycle hooks (e.g. before_agent_start).
   * Fires onReport handlers for any pending reports; deduplicates across
   * calls, so a report delivered by push won't fire again here.
   */
  poll(): Promise<void>;
}

// ── File IPC implementation ─────────────────────────────────────────────────

export class FileIPC implements ResearchReporter, ResearchReceiver {
  private handlers = new Set<(report: ResearchReport) => void>();
  /** Track processed filenames to avoid re-delivery on repeated poll(). */
  private processed = new Set<string>();
  private watcher: ReturnType<typeof watch> | null = null;

  // ── ResearchReporter ──────────────────────────────────────────────────

  async reportBack(report: ResearchReport): Promise<void> {
    mkdirSync(researchReportsDir(), { recursive: true });
    writeFileSync(
      researchReportPath(report.sessionId),
      JSON.stringify(report, null, 2),
      "utf-8",
    );
  }

  // ── ResearchReceiver ──────────────────────────────────────────────────

  onReport(handler: (report: ResearchReport) => void): Unsubscribe {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }

  async poll(): Promise<void> {
    const dir = researchReportsDir();
    if (!existsSync(dir)) {
      return;
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

    for (const handler of this.handlers) {
      for (const report of delivered) {
        handler(report);
      }
    }
  }

  async start(): Promise<Unsubscribe> {
    const dir = researchReportsDir();
    mkdirSync(dir, { recursive: true });

    this.watcher = watch(dir, { persistent: false }, (_event, filename) => {
      if (typeof filename === "string" && filename.endsWith(".json")) {
        void this.poll(); // fires onReport handlers + unlinks
      }
    });

    // persistent:false → watcher doesn't keep the event loop alive,
    // so process.exit() isn't blocked by the watch handle.

    return () => {
      this.watcher?.close();
      this.watcher = null;
    };
  }
}

export function createIPC(): ResearchReporter & ResearchReceiver {
  return new FileIPC();
}
