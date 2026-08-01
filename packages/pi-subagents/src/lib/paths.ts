import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

/**
 * All pi-subagents state lives under the agent config dir, one subdir per
 * concern. Artifacts are keyed by the shared research session id.
 */

/**
 * Session ids are generated as UUIDs. Reject anything that could escape the
 * artifact dirs (path traversal via `..`, `/`, `\`, or other unsafe chars)
 * before it is joined onto a directory path.
 */
const SESSION_ID_RE = /^[A-Za-z0-9_-]+$/;

function assertSafeSessionId(sessionId: string): void {
  if (!SESSION_ID_RE.test(sessionId)) {
    throw new Error(
      `invalid research session id: ${JSON.stringify(sessionId)}`,
    );
  }
}

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
  assertSafeSessionId(sessionId);
  return join(researchScriptsDir(), `${sessionId}.sh`);
}

/** Stderr log for a research launch (written by the script itself). */
export function researchScriptLogPath(sessionId: string): string {
  assertSafeSessionId(sessionId);
  return join(researchScriptsDir(), `${sessionId}.log`);
}

export function researchSessionStatePath(sessionId: string): string {
  assertSafeSessionId(sessionId);
  return join(researchSessionsDir(), `${sessionId}.json`);
}

export function researchReportPath(sessionId: string): string {
  assertSafeSessionId(sessionId);
  return join(researchReportsDir(), `${sessionId}.json`);
}
