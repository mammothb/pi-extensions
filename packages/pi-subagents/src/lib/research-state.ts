import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { researchSessionStatePath, researchSessionsDir } from "./paths.js";

export interface ResearchSessionState {
  id: string;
  task: string;
  sessionFile: string;
  paneId: string | null;
  tmuxSession: string | null;
  startedAt: string;
  status: "running" | "completed" | "closed";
  /** PID of the child pi process — recorded by the child on startup. */
  childPid?: number;
}

export function createResearchSession(
  state: Omit<ResearchSessionState, "startedAt">,
): void {
  const full: ResearchSessionState = {
    ...state,
    startedAt: new Date().toISOString(),
  };
  mkdirSync(researchSessionsDir(), { recursive: true });
  writeFileSync(
    researchSessionStatePath(state.id),
    JSON.stringify(full, null, 2),
    "utf-8",
  );
}

export function getResearchSession(id: string): ResearchSessionState | null {
  const path = researchSessionStatePath(id);
  if (!existsSync(path)) {
    return null;
  }
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as ResearchSessionState;
  } catch {
    return null;
  }
}

export function listResearchSessions(): ResearchSessionState[] {
  const dir = researchSessionsDir();
  if (!existsSync(dir)) {
    return [];
  }
  const sessions = readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      try {
        return JSON.parse(
          readFileSync(join(dir, f), "utf-8"),
        ) as ResearchSessionState;
      } catch {
        return null;
      }
    })
    .filter((s): s is ResearchSessionState => s !== null);
  return sessions.sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1));
}

/**
 * Write state atomically: temp file + rename, so a concurrent reader in the
 * other pi process (child ↔ parent) never observes a partially-written file.
 */
function writeResearchSessionState(state: ResearchSessionState): void {
  const path = researchSessionStatePath(state.id);
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(state, null, 2), "utf-8");
  renameSync(tmp, path);
}

export function setResearchSessionChildPid(id: string, childPid: number): void {
  const state = getResearchSession(id);
  if (!state) {
    return;
  }
  state.childPid = childPid;
  writeResearchSessionState(state);
}

export function updateResearchSessionStatus(
  id: string,
  status: ResearchSessionState["status"],
): void {
  const state = getResearchSession(id);
  if (!state) {
    return;
  }
  state.status = status;
  writeResearchSessionState(state);
}

export function removeResearchSession(id: string): void {
  const path = researchSessionStatePath(id);
  if (existsSync(path)) {
    unlinkSync(path);
  }
}
