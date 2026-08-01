import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

/**
 * All pi-subagents state lives under the agent config dir, one subdir per
 * concern. Artifacts are keyed by the shared research session id.
 */

/** Executable launch scripts for research child panes. */
export function researchScriptsDir(): string {
  return join(getAgentDir(), "research-scripts");
}

/** Research session state files. */
export function researchSessionsDir(): string {
  return join(getAgentDir(), "research-sessions");
}

/** Research report files written by child panes. */
export function researchReportsDir(): string {
  return join(getAgentDir(), "research-reports");
}

/** Child pi session files (mirrors pi's own session layout). */
export function childSessionsDir(): string {
  return join(getAgentDir(), "sessions", "pi-subagents");
}

export function researchScriptPath(sessionId: string): string {
  return join(researchScriptsDir(), `${sessionId}.sh`);
}

/** Stderr log for a research launch (written by the script itself). */
export function researchScriptLogPath(sessionId: string): string {
  return join(researchScriptsDir(), `${sessionId}.log`);
}

export function researchSessionStatePath(sessionId: string): string {
  return join(researchSessionsDir(), `${sessionId}.json`);
}

export function researchReportPath(sessionId: string): string {
  return join(researchReportsDir(), `${sessionId}.json`);
}
