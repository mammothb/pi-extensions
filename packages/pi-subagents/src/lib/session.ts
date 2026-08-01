import { randomUUID } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  CURRENT_SESSION_VERSION,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import { childSessionsDir } from "./paths.js";
import type { AgentConfig } from "./types.js";

// =============================================================================
// Report extraction
// =============================================================================

/**
 * Extract the last non-empty assistant text output from session entries.
 * Handles the v3 nested shape (`entry.message`) and falls back to flat
 * shapes. Returns "" when no assistant text output is found.
 */
export function extractLastAssistantOutput(
  entries: Array<Record<string, unknown>>,
): string {
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    if (!entry) {
      continue;
    }
    const msg = (entry.message as Record<string, unknown> | undefined) ?? entry;
    if (msg.role !== "assistant") {
      continue;
    }
    const content = msg.content;
    if (typeof content === "string") {
      if (content) {
        return content;
      }
      continue;
    }
    if (Array.isArray(content)) {
      const text = content
        .filter((p: Record<string, unknown>) => p.type === "text")
        .map((p: Record<string, unknown>) => String(p.text ?? ""))
        .join("");
      if (text) {
        return text;
      }
    }
  }
  return "";
}

// =============================================================================
// Session file helpers
// =============================================================================

/**
 * Generate the child session file path for a research session under the pi
 * session directory (`~/.pi/agent/sessions/pi-subagents/`). The session id
 * is shared with the header and the extension's bookkeeping, matching pi's
 * own session files (session-manager: `${ts}_${id}.jsonl`).
 */
export function generateChildSessionFile(sessionId: string): string {
  const dir = childSessionsDir();
  mkdirSync(dir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  return join(dir, `${ts}_${sessionId}.jsonl`);
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
  sessionId: string,
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
      sessionId,
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
      sessionId,
    );
    return;
  }

  // Write session file: new header + parent branch entries
  const header: Record<string, unknown> = {
    type: "session",
    version: parentVersion,
    id: sessionId,
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
    id: generateEntryId(path),
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
  sessionId?: string,
): void {
  mkdirSync(dirname(path), { recursive: true });
  const header: Record<string, unknown> = {
    type: "session",
    version,
    id: sessionId ?? randomUUID(),
    timestamp: new Date().toISOString(),
    cwd,
    ...(parentSessionFile ? { parentSession: parentSessionFile } : {}),
  };
  writeFileSync(path, `${JSON.stringify(header)}\n`, "utf8");
}

/**
 * Generate a unique short entry id (8 hex chars), avoiding ids already
 * present in the session file. Mirrors pi's SessionManager#generateId.
 */
function generateEntryId(path: string): string {
  const existing = new Set<string>();
  try {
    const manager = SessionManager.open(path);
    for (const entry of manager.getEntries()) {
      const id = (entry as { id?: string }).id;
      if (id) {
        existing.add(id);
      }
    }
  } catch {
    // Unreadable file — skip collision check
  }
  for (let i = 0; i < 100; i++) {
    const id = randomUUID().slice(0, 8);
    if (!existing.has(id)) {
      return id;
    }
  }
  return randomUUID();
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
