import { randomUUID } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import type { AgentConfig } from "./types.js";

// =============================================================================
// Session format version (matches pi's current session JSONL format)
// =============================================================================

const CURRENT_SESSION_VERSION = 1;

// =============================================================================
// Session file helpers
// =============================================================================

/**
 * Generate a unique child session file path under the pi session directory
 * (`~/.pi/agent/sessions/pi-subagents/`).
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
 * marker so it knows where parent context ends.
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

  // Append a boundary marker as the final entry
  appendBoundaryEntry(
    childSessionFile,
    agent.name,
    getLastEntryId(childSessionFile),
  );
}

// =============================================================================
// Entry appending helpers
// =============================================================================

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
    customType: "background_boundary",
    content: "--- Background context from parent session ends here. ---",
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
