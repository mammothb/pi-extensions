import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
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

export function updateResearchSessionStatus(
  id: string,
  status: ResearchSessionState["status"],
): void {
  const state = getResearchSession(id);
  if (!state) {
    return;
  }
  state.status = status;
  writeFileSync(
    researchSessionStatePath(id),
    JSON.stringify(state, null, 2),
    "utf-8",
  );
}

export function removeResearchSession(id: string): void {
  const path = researchSessionStatePath(id);
  if (existsSync(path)) {
    unlinkSync(path);
  }
}
