import { randomUUID } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import type { AgentConfig } from "./types.js";

// =============================================================================
// Persisted launch metadata (stored in child session for resume)
// =============================================================================

export const LAUNCH_METADATA_CUSTOM_TYPE = "pi-subagents_launch_metadata";

export interface PersistedLaunchMetadata {
  version: 1;
  timestamp: string;
  name: string;
  agent?: string;
  model: string;
  thinking: string;
  tools: string[];
  mode: "clean" | "fork";
  sandbox: boolean;
  noSession: boolean;
  cwd: string;
}

function agentToMetadata(
  agent: AgentConfig,
  cwd: string,
): PersistedLaunchMetadata {
  return {
    version: 1,
    timestamp: new Date().toISOString(),
    name: agent.name,
    agent: agent.name,
    model: agent.model,
    thinking: agent.thinking,
    tools: agent.tools,
    mode: agent.mode,
    sandbox: agent.sandbox,
    noSession: agent.noSession,
    cwd,
  };
}

// =============================================================================
// Session file helpers
// =============================================================================

/**
 * Generate a unique child session file path.
 * Uses the default pi session directory under `~/.pi/agent/sessions/`
 * so sandboxed children (bubblewrap) can access it.
 */
export function generateChildSessionFile(sessionDir?: string): string {
  const dir = sessionDir ?? join(agentSessionRoot(), "pi-subagents");
  mkdirSync(dir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 23);
  const id = randomUUID();
  return join(dir, `${ts}_${id}.jsonl`);
}

/** Resolve the agent session root from env or default. */
function agentSessionRoot(): string {
  const agentDir =
    process.env.PI_CODING_AGENT_DIR ??
    join(process.env.HOME ?? "/tmp", ".pi", "agent");
  return join(agentDir, "sessions");
}

// =============================================================================
// Fork session construction
// =============================================================================

/**
 * Seed a child session file that forks (inherits) the parent's conversation
 * context. The child gets the parent's current branch entries + a boundary
 * marker, model/thinking state, and launch metadata for resume.
 *
 * Uses Pi SDK's SessionManager to read the parent session correctly —
 * handling compaction, branching, and format versioning.
 */
export function seedForkSession(
  parentSessionFile: string,
  childSessionFile: string,
  agent: AgentConfig,
  cwd: string,
): void {
  mkdirSync(dirname(childSessionFile), { recursive: true });

  // Open parent session via Pi SDK
  const parentManager = SessionManager.open(parentSessionFile, undefined, cwd);
  const leafId = parentManager.getLeafId();
  const parentVersion =
    parentManager.getHeader()?.version ?? CURRENT_SESSION_VERSION;

  if (!leafId) {
    // Empty parent session — write header-only child file
    writeHeaderOnlySessionFile(
      childSessionFile,
      cwd,
      parentSessionFile,
      parentVersion,
    );
    return;
  }

  const branch = parentManager.getBranch(leafId);
  if (branch.length === 0) {
    writeHeaderOnlySessionFile(
      childSessionFile,
      cwd,
      parentSessionFile,
      parentVersion,
    );
    return;
  }

  // Write session file: new header + parent branch entries
  const header: Record<string, unknown> = {
    type: "session",
    version: parentVersion,
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    cwd,
    parentSession: parentSessionFile,
  };

  const lines = [header, ...branch].map((entry) => JSON.stringify(entry));
  writeFileSync(childSessionFile, `${lines.join("\n")}\n`, "utf8");

  // Append state + metadata entries, threading parentId so each helper
  // avoids re-parsing the session file via getLastEntryId.
  let lastId = getLastEntryId(childSessionFile);
  lastId = appendModelStateEntries(childSessionFile, agent, lastId);
  lastId = appendLaunchMetadataEntry(childSessionFile, agent, cwd, lastId);
  appendBoundaryEntry(childSessionFile, agent.name, lastId);
}

// =============================================================================
// Entry appending helpers
// =============================================================================

/**
 * Append model_change and thinking_level_change entries to a session file.
 * These record the child's model configuration in the session so resume
 * can restore it.
 */
export function appendModelStateEntries(
  path: string,
  agent: AgentConfig,
  parentId?: string | null,
): string | null {
  if (!existsSync(path) || !agent.model) {
    return parentId ?? null;
  }

  let resolvedId = parentId ?? getLastEntryId(path);

  const slash = agent.model.indexOf("/");
  if (slash !== -1) {
    // model_change
    const entry = {
      type: "model_change",
      id: randomUUID().replace(/-/g, "").slice(0, 8),
      parentId: resolvedId,
      timestamp: new Date().toISOString(),
      provider: agent.model.slice(0, slash),
      modelId: agent.model.slice(slash + 1),
    };
    appendFileSync(path, `${JSON.stringify(entry)}\n`, "utf8");
    resolvedId = entry.id;
  }

  // thinking_level_change
  if (agent.thinking) {
    const entry = {
      type: "thinking_level_change",
      id: randomUUID().replace(/-/g, "").slice(0, 8),
      parentId: resolvedId,
      timestamp: new Date().toISOString(),
      thinkingLevel: agent.thinking,
    };
    appendFileSync(path, `${JSON.stringify(entry)}\n`, "utf8");
    resolvedId = entry.id;
  }

  return resolvedId;
}

/**
 * Append launch metadata as a custom entry so resume can restore
 * the original agent config (model, tools, thinking, sandbox, mode).
 */
export function appendLaunchMetadataEntry(
  path: string,
  agent: AgentConfig,
  cwd: string,
  parentId?: string | null,
): string | null {
  if (!existsSync(path)) {
    return parentId ?? null;
  }

  const resolvedId = parentId ?? getLastEntryId(path);
  const entry = {
    type: "custom",
    customType: LAUNCH_METADATA_CUSTOM_TYPE,
    data: agentToMetadata(agent, cwd),
    id: randomUUID().replace(/-/g, "").slice(0, 8),
    parentId: resolvedId,
    timestamp: new Date().toISOString(),
  };
  appendFileSync(path, `${JSON.stringify(entry)}\n`, "utf8");
  return entry.id;
}

/**
 * Append a boundary marker (custom_message) that tells the child LLM
 * where parent context ends and the child's task begins.
 */
export function appendBoundaryEntry(
  path: string,
  name: string,
  parentId?: string | null,
): string | null {
  if (!existsSync(path)) {
    return parentId ?? null;
  }

  const resolvedId = parentId ?? getLastEntryId(path);
  const entry = {
    type: "custom_message",
    customType: "subagent_boundary",
    content:
      "--- Background context from parent session ends here. " +
      "The task below is your assignment. ---",
    display: false,
    details: { name },
    id: randomUUID().replace(/-/g, "").slice(0, 8),
    parentId: resolvedId,
    timestamp: new Date().toISOString(),
  };
  appendFileSync(path, `${JSON.stringify(entry)}\n`, "utf8");
  return entry.id;
}

// =============================================================================
// Launch metadata read-back (for resume)
// =============================================================================

/**
 * Read persisted launch metadata from a child session file.
 * Returns undefined if the session was created before metadata persistence
 * was added, or if the file is unreadable.
 */
export function readLaunchMetadata(
  path: string,
): PersistedLaunchMetadata | undefined {
  try {
    const manager = SessionManager.open(path);
    const entries = manager.getEntries();

    // Scan backward for the most recent launch metadata entry
    for (let i = entries.length - 1; i >= 0; i--) {
      const entry = entries[i] as unknown as Record<string, unknown>;
      if (
        entry.type !== "custom" ||
        entry.customType !== LAUNCH_METADATA_CUSTOM_TYPE
      ) {
        continue;
      }
      const data = entry.data as Partial<PersistedLaunchMetadata> | undefined;
      if (!data || data.version !== 1 || !Array.isArray(data.tools)) {
        continue;
      }
      return data as PersistedLaunchMetadata;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

// =============================================================================
// Internal helpers
// =============================================================================

function writeHeaderOnlySessionFile(
  path: string,
  cwd: string,
  parentSessionFile?: string,
  version = CURRENT_SESSION_VERSION,
): void {
  mkdirSync(dirname(path), { recursive: true });
  const header: Record<string, unknown> = {
    type: "session",
    version,
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    cwd,
    ...(parentSessionFile ? { parentSession: parentSessionFile } : {}),
  };
  writeFileSync(path, `${JSON.stringify(header)}\n`, "utf8");
}

/**
 * Get the last entry ID from a session JSONL file.
 * Skips the header (type: "session") and returns the last non-header entry's id.
 */
function getLastEntryId(path: string): string | null {
  try {
    const manager = SessionManager.open(path);
    const entries = manager.getEntries();
    for (let i = entries.length - 1; i >= 0; i--) {
      const id = (entries[i] as { id?: string }).id;
      if (id) {
        return id;
      }
    }
  } catch {
    // fallback: return null
  }
  return null;
}
