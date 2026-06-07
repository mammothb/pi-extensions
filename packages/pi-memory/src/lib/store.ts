import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

/** Short hash of the cwd for per-project memory isolation. */
export function hashCwd(cwd: string): string {
  return crypto.createHash("sha256").update(cwd).digest("hex").slice(0, 16);
}

/** Entry in the index.json registry. */
export interface IndexEntry {
  path: string;
  lastAccess: string;
}

/** TTL metadata entry: maps a key to its expiry timestamp. */
export interface MemoryMetaEntry {
  expiresAt: string;
}

// ── Path resolution ──────────────────────────────────────────

/** Base directory for all pi-memory files. */
function memoryRoot(baseDir?: string): string {
  const root = baseDir ?? path.join(os.homedir(), ".pi", "agent");
  return path.join(root, "pi-memory");
}

/** Resolve the memory.json path for a given cwd. */
export function resolveMemoryPath(cwd: string, baseDir?: string): string {
  const hash = hashCwd(cwd);
  return path.join(memoryRoot(baseDir), hash, "memory.json");
}

/** Resolve the memory-meta.json path (TTL metadata) for a given cwd. */
export function resolveMemoryMetaPath(cwd: string, baseDir?: string): string {
  const hash = hashCwd(cwd);
  return path.join(memoryRoot(baseDir), hash, "memory-meta.json");
}

/** Resolve the global.json path (shared across projects). */
export function resolveGlobalPath(baseDir?: string): string {
  return path.join(memoryRoot(baseDir), "global.json");
}

/** Resolve the global-meta.json path (TTL metadata for global memory). */
export function resolveGlobalMetaPath(baseDir?: string): string {
  return path.join(memoryRoot(baseDir), "global-meta.json");
}

/** Resolve the index.json path (project registry). */
export function resolveIndexPath(baseDir?: string): string {
  return path.join(memoryRoot(baseDir), "index.json");
}

// ── Project memory ───────────────────────────────────────────

/**
 * Load memory from disk, filtering out expired entries.
 * Returns {} if file is missing or invalid.
 */
export function loadMemory(
  cwd: string,
  baseDir?: string,
): Record<string, string> {
  const entries = loadMemoryRaw(cwd, baseDir);
  const meta = loadMemoryMeta(cwd, baseDir);
  return filterExpired(entries, meta);
}

/**
 * Load memory from disk WITHOUT TTL filtering (includes expired entries).
 * Use for tools that need to read/write all entries (retain, reflect, edit).
 */
export function loadMemoryRaw(
  cwd: string,
  baseDir?: string,
): Record<string, string> {
  return filterStrings(loadJsonFile(resolveMemoryPath(cwd, baseDir)));
}

/**
 * Save memory to disk atomically via .tmp + rename.
 */
export function saveMemory(
  cwd: string,
  data: Record<string, string>,
  baseDir?: string,
): void {
  const filePath = resolveMemoryPath(cwd, baseDir);
  saveJsonFile(filePath, data);
}

// ── Project TTL metadata ─────────────────────────────────────

/**
 * Load TTL metadata for a project. Returns {} if file is missing or invalid.
 */
export function loadMemoryMeta(
  cwd: string,
  baseDir?: string,
): Record<string, MemoryMetaEntry> {
  const filePath = resolveMemoryMetaPath(cwd, baseDir);
  const raw = loadJsonFile(filePath);
  const result: Record<string, MemoryMetaEntry> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (
      typeof value === "object" &&
      value !== null &&
      typeof (value as MemoryMetaEntry).expiresAt === "string"
    ) {
      result[key] = { expiresAt: (value as MemoryMetaEntry).expiresAt };
    }
  }
  return result;
}

/**
 * Save TTL metadata atomically.
 */
export function saveMemoryMeta(
  cwd: string,
  meta: Record<string, MemoryMetaEntry>,
  baseDir?: string,
): void {
  const filePath = resolveMemoryMetaPath(cwd, baseDir);
  // Only write the file if there are entries (avoids empty meta files)
  saveJsonFile(filePath, meta);
}

// ── Global memory ────────────────────────────────────────────

/**
 * Load global memory from disk, filtering out expired entries.
 * Returns {} if file is missing or invalid.
 */
export function loadGlobalMemory(baseDir?: string): Record<string, string> {
  const entries = loadGlobalMemoryRaw(baseDir);
  const meta = loadGlobalMemoryMeta(baseDir);
  return filterExpired(entries, meta);
}

/**
 * Load global memory WITHOUT TTL filtering (includes expired entries).
 */
export function loadGlobalMemoryRaw(baseDir?: string): Record<string, string> {
  return filterStrings(loadJsonFile(resolveGlobalPath(baseDir)));
}

/**
 * Save global memory to disk atomically.
 */
export function saveGlobalMemory(
  data: Record<string, string>,
  baseDir?: string,
): void {
  const filePath = resolveGlobalPath(baseDir);
  saveJsonFile(filePath, data);
}

// ── Global TTL metadata ──────────────────────────────────────

/**
 * Load TTL metadata for global memory. Returns {} if missing or invalid.
 */
export function loadGlobalMemoryMeta(
  baseDir?: string,
): Record<string, MemoryMetaEntry> {
  const filePath = resolveGlobalMetaPath(baseDir);
  const raw = loadJsonFile(filePath);
  const result: Record<string, MemoryMetaEntry> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (
      typeof value === "object" &&
      value !== null &&
      typeof (value as MemoryMetaEntry).expiresAt === "string"
    ) {
      result[key] = { expiresAt: (value as MemoryMetaEntry).expiresAt };
    }
  }
  return result;
}

/**
 * Save global TTL metadata atomically.
 */
export function saveGlobalMemoryMeta(
  meta: Record<string, MemoryMetaEntry>,
  baseDir?: string,
): void {
  const filePath = resolveGlobalMetaPath(baseDir);
  saveJsonFile(filePath, meta);
}

// ── Atomic memory + TTL writes ───────────────────────────────

/**
 * Set a project-scoped memory entry and update its TTL metadata atomically.
 * Consolidates the load/mutate/save dance for both memory and TTL meta
 * that was previously duplicated in retain and reflect.
 */
export function setMemoryAndTTL(
  cwd: string,
  key: string,
  value: string,
  ttlSeconds: number | undefined,
  baseDir?: string,
): void {
  const memory = loadMemoryRaw(cwd, baseDir);
  memory[key] = value;
  saveMemory(cwd, memory, baseDir);

  const meta = loadMemoryMeta(cwd, baseDir);
  if (ttlSeconds != null && ttlSeconds > 0) {
    meta[key] = {
      expiresAt: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
    };
  } else {
    delete meta[key];
  }
  saveMemoryMeta(cwd, meta, baseDir);
}

/**
 * Set a global-scoped memory entry and update its TTL metadata atomically.
 */
export function setGlobalMemoryAndTTL(
  key: string,
  value: string,
  ttlSeconds: number | undefined,
  baseDir?: string,
): void {
  const memory = loadGlobalMemoryRaw(baseDir);
  memory[key] = value;
  saveGlobalMemory(memory, baseDir);

  const meta = loadGlobalMemoryMeta(baseDir);
  if (ttlSeconds != null && ttlSeconds > 0) {
    meta[key] = {
      expiresAt: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
    };
  } else {
    delete meta[key];
  }
  saveGlobalMemoryMeta(meta, baseDir);
}

// ── Index (project registry) ─────────────────────────────────

/**
 * Load the index registry. Returns {} if file is missing or invalid.
 */
export function loadIndex(baseDir?: string): Record<string, IndexEntry> {
  const filePath = resolveIndexPath(baseDir);
  const raw = loadJsonFile(filePath);
  const result: Record<string, IndexEntry> = {};
  for (const [hash, entry] of Object.entries(raw)) {
    if (
      typeof entry === "object" &&
      entry !== null &&
      typeof (entry as IndexEntry).path === "string"
    ) {
      result[hash] = {
        path: (entry as IndexEntry).path,
        lastAccess:
          typeof (entry as IndexEntry).lastAccess === "string"
            ? (entry as IndexEntry).lastAccess
            : new Date().toISOString(),
      };
    }
  }
  return result;
}

/**
 * Save the index registry atomically.
 */
export function saveIndex(
  data: Record<string, IndexEntry>,
  baseDir?: string,
): void {
  const filePath = resolveIndexPath(baseDir);
  saveJsonFile(filePath, data);
}

// ── Internal helpers ─────────────────────────────────────────

/**
 * Filter a flat memory map against TTL metadata, removing expired entries.
 */
function filterExpired(
  entries: Record<string, string>,
  meta: Record<string, MemoryMetaEntry>,
): Record<string, string> {
  const now = new Date();
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(entries)) {
    const expiresAt = meta[key]?.expiresAt;
    if (expiresAt && new Date(expiresAt) <= now) {
      continue; // expired — skip
    }
    result[key] = value;
  }
  return result;
}

/** Filter an object to only string-valued entries. */
function filterStrings(obj: Record<string, unknown>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === "string") {
      result[key] = value;
    }
  }
  return result;
}

/** Load and parse a JSON file. Returns {} if missing or invalid. */
function loadJsonFile(filePath: string): Record<string, unknown> {
  try {
    if (!fs.existsSync(filePath)) {
      return {};
    }
    const raw = fs.readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      return {};
    }
    return parsed as Record<string, unknown>;
  } catch {
    return {};
  }
}

/** Write a JSON object to disk atomically via .tmp + rename. */
function saveJsonFile(filePath: string, data: Record<string, unknown>): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });

  const tmpPath = `${filePath}.tmp`;
  const json = JSON.stringify(data, null, 2);
  fs.writeFileSync(tmpPath, json, "utf-8");
  fs.renameSync(tmpPath, filePath);
}
