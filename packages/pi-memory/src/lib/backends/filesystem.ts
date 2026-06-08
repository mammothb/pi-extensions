import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import type {
  IndexEntry,
  MemoryBackend,
  MemoryScope,
  RecallEntry,
  RecallOptions,
  RememberParams,
} from "../backend.js";

// ── Search ───────────────────────────────────────────────────

/** Common English stop words filtered from search queries. */
const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "been",
  "but",
  "by",
  "can",
  "could",
  "did",
  "do",
  "does",
  "each",
  "every",
  "few",
  "for",
  "from",
  "had",
  "has",
  "have",
  "i",
  "if",
  "in",
  "into",
  "is",
  "it",
  "just",
  "many",
  "more",
  "most",
  "much",
  "new",
  "no",
  "not",
  "of",
  "on",
  "only",
  "or",
  "other",
  "over",
  "should",
  "so",
  "some",
  "such",
  "than",
  "that",
  "the",
  "their",
  "them",
  "then",
  "these",
  "they",
  "this",
  "those",
  "to",
  "was",
  "we",
  "were",
  "what",
  "when",
  "which",
  "who",
  "will",
  "with",
  "would",
]);

// ── Private types ────────────────────────────────────────────

interface MemoryMetaEntry {
  expiresAt: string;
}

interface ScoredKey {
  key: string;
  score: number;
}

// ── FileSystemBackend ────────────────────────────────────────

export class FileSystemBackend implements MemoryBackend {
  readonly #baseDir: string;

  constructor(options: { baseDir: string }) {
    this.#baseDir = options.baseDir;
  }

  // ── Public interface ───────────────────────────────────────

  async remember(params: RememberParams): Promise<void> {
    const { scope, cwd, key, value, ttlSeconds } = params;

    if (scope === "global") {
      const memory = this.#loadGlobalMemoryRaw();
      memory[key] = value;
      this.#saveGlobalMemory(memory);

      const meta = this.#loadGlobalMemoryMeta();
      if (ttlSeconds != null && ttlSeconds > 0) {
        meta[key] = {
          expiresAt: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
        };
      } else {
        delete meta[key];
      }
      this.#saveGlobalMemoryMeta(meta);
    } else {
      const memory = this.#loadMemoryRaw(cwd);
      memory[key] = value;
      this.#saveMemory(cwd, memory);

      const meta = this.#loadMemoryMeta(cwd);
      if (ttlSeconds != null && ttlSeconds > 0) {
        meta[key] = {
          expiresAt: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
        };
      } else {
        delete meta[key];
      }
      this.#saveMemoryMeta(cwd, meta);
    }
  }

  async recall(params: {
    cwd: string;
    options: RecallOptions;
  }): Promise<RecallEntry[]> {
    const { cwd, options } = params;

    // Load both scopes (TTL-filtered)
    const globalEntries = this.#loadGlobalMemory();
    const projectEntries = this.#loadMemory(cwd);

    // Merge: global first, then project overrides on key collision
    const merged = new Map<string, RecallEntry>();
    for (const [key, value] of Object.entries(globalEntries)) {
      merged.set(key, { key, value, scope: "global" });
    }
    for (const [key, value] of Object.entries(projectEntries)) {
      merged.set(key, { key, value, scope: "project" });
    }

    let entries = Array.from(merged.values());

    // Namespace filter
    if (options.namespace) {
      const ns = options.namespace;
      entries = entries.filter((e) => e.key.startsWith(ns));
    }

    // List mode: return all entries sorted by key
    if (options.list) {
      entries.sort((a, b) => a.key.localeCompare(b.key));
      return entries;
    }

    // Search mode
    if (options.query && options.query.trim().length > 0) {
      // Build a Record for search scoring
      const searchInput: Record<string, string> = {};
      for (const entry of entries) {
        searchInput[entry.key] = entry.value;
      }
      const scored = this.#searchMemory(
        searchInput,
        options.query,
        options.limit ?? 5,
      );

      // Map scored results back to RecallEntry with scope labels
      const entryMap = new Map(entries.map((e) => [e.key, e]));
      return scored.map((s) => {
        const entry = entryMap.get(s.key);
        return {
          key: s.key,
          value: entry?.value ?? "",
          scope: entry?.scope ?? "project",
          score: s.score,
        };
      });
    }

    // No query and no list — empty
    return [];
  }

  async forget(params: {
    scope: MemoryScope;
    cwd: string;
    key: string;
  }): Promise<void> {
    const { scope, cwd, key } = params;

    if (scope === "global") {
      const memory = this.#loadGlobalMemoryRaw();
      delete memory[key];
      this.#saveGlobalMemory(memory);

      const meta = this.#loadGlobalMemoryMeta();
      delete meta[key];
      this.#saveGlobalMemoryMeta(meta);
    } else {
      const memory = this.#loadMemoryRaw(cwd);
      delete memory[key];
      this.#saveMemory(cwd, memory);

      const meta = this.#loadMemoryMeta(cwd);
      delete meta[key];
      this.#saveMemoryMeta(cwd, meta);
    }
  }

  async rename(params: {
    scope: MemoryScope;
    cwd: string;
    oldKey: string;
    newKey: string;
  }): Promise<void> {
    const { scope, cwd, oldKey, newKey } = params;

    if (scope === "global") {
      const memory = this.#loadGlobalMemoryRaw();
      if (oldKey in memory) {
        // biome-ignore lint/style/noNonNullAssertion: guarded by `in` check
        const value = memory[oldKey]!;
        delete memory[oldKey];
        memory[newKey] = value;
        this.#saveGlobalMemory(memory);

        const meta = this.#loadGlobalMemoryMeta();
        if (oldKey in meta) {
          const ttlEntry = meta[oldKey];
          if (ttlEntry) {
            meta[newKey] = ttlEntry;
          }
          delete meta[oldKey];
          this.#saveGlobalMemoryMeta(meta);
        }
      }
    } else {
      const memory = this.#loadMemoryRaw(cwd);
      if (oldKey in memory) {
        // biome-ignore lint/style/noNonNullAssertion: guarded by `in` check
        const value = memory[oldKey]!;
        delete memory[oldKey];
        memory[newKey] = value;
        this.#saveMemory(cwd, memory);

        const meta = this.#loadMemoryMeta(cwd);
        if (oldKey in meta) {
          const ttlEntry = meta[oldKey];
          if (ttlEntry) {
            meta[newKey] = ttlEntry;
          }
          delete meta[oldKey];
          this.#saveMemoryMeta(cwd, meta);
        }
      }
    }
  }

  async getIndex(): Promise<Record<string, IndexEntry>> {
    return this.#loadIndex();
  }

  async upsertIndex(cwd: string, entry: IndexEntry): Promise<void> {
    const hash = this.#hashCwd(cwd);
    const index = this.#loadIndex();
    index[hash] = entry;
    this.#saveIndex(index);
  }

  // ── Path resolution ────────────────────────────────────────

  #memoryRoot(): string {
    return path.join(this.#baseDir, "pi-memory");
  }

  #resolveMemoryPath(cwd: string): string {
    return path.join(this.#memoryRoot(), this.#hashCwd(cwd), "memory.json");
  }

  #resolveMemoryMetaPath(cwd: string): string {
    return path.join(
      this.#memoryRoot(),
      this.#hashCwd(cwd),
      "memory-meta.json",
    );
  }

  #resolveGlobalPath(): string {
    return path.join(this.#memoryRoot(), "global.json");
  }

  #resolveGlobalMetaPath(): string {
    return path.join(this.#memoryRoot(), "global-meta.json");
  }

  #resolveIndexPath(): string {
    return path.join(this.#memoryRoot(), "index.json");
  }

  // ── CWD hashing ────────────────────────────────────────────

  #hashCwd(cwd: string): string {
    return crypto.createHash("sha256").update(cwd).digest("hex").slice(0, 16);
  }

  // ── Project memory I/O ─────────────────────────────────────

  #loadMemory(cwd: string): Record<string, string> {
    const entries = this.#loadMemoryRaw(cwd);
    const meta = this.#loadMemoryMeta(cwd);
    return this.#filterExpired(entries, meta);
  }

  #loadMemoryRaw(cwd: string): Record<string, string> {
    return this.#filterStrings(
      this.#loadJsonFile(this.#resolveMemoryPath(cwd)),
    );
  }

  #saveMemory(cwd: string, data: Record<string, string>): void {
    this.#saveJsonFile(this.#resolveMemoryPath(cwd), data);
  }

  #loadMemoryMeta(cwd: string): Record<string, MemoryMetaEntry> {
    const raw = this.#loadJsonFile(this.#resolveMemoryMetaPath(cwd));
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

  #saveMemoryMeta(cwd: string, meta: Record<string, MemoryMetaEntry>): void {
    this.#saveJsonFile(this.#resolveMemoryMetaPath(cwd), meta);
  }

  // ── Global memory I/O ──────────────────────────────────────

  #loadGlobalMemory(): Record<string, string> {
    const entries = this.#loadGlobalMemoryRaw();
    const meta = this.#loadGlobalMemoryMeta();
    return this.#filterExpired(entries, meta);
  }

  #loadGlobalMemoryRaw(): Record<string, string> {
    return this.#filterStrings(this.#loadJsonFile(this.#resolveGlobalPath()));
  }

  #saveGlobalMemory(data: Record<string, string>): void {
    this.#saveJsonFile(this.#resolveGlobalPath(), data);
  }

  #loadGlobalMemoryMeta(): Record<string, MemoryMetaEntry> {
    const raw = this.#loadJsonFile(this.#resolveGlobalMetaPath());
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

  #saveGlobalMemoryMeta(meta: Record<string, MemoryMetaEntry>): void {
    this.#saveJsonFile(this.#resolveGlobalMetaPath(), meta);
  }

  // ── Index I/O ──────────────────────────────────────────────

  #loadIndex(): Record<string, IndexEntry> {
    const raw = this.#loadJsonFile(this.#resolveIndexPath());
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

  #saveIndex(data: Record<string, IndexEntry>): void {
    this.#saveJsonFile(this.#resolveIndexPath(), data);
  }

  // ── Search ─────────────────────────────────────────────────

  #tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 0 && !STOP_WORDS.has(w));
  }

  #scoreEntry(queryWords: string[], key: string, value: string): number {
    const keyLower = key.toLowerCase();
    const valueLower = value.toLowerCase();
    let score = 0;

    let allMatched = true;
    for (const word of queryWords) {
      const inKey = keyLower.includes(word);
      const inValue = valueLower.includes(word);

      if (inKey) {
        score += 3;
      } else if (inValue) {
        score += 1;
      } else {
        allMatched = false;
      }
    }

    // Phrase match bonus: all query words in sequence in the key
    if (
      allMatched &&
      queryWords.length >= 2 &&
      keyLower.includes(queryWords.join(" "))
    ) {
      score += 5;
    }

    return score;
  }

  #searchMemory(
    memory: Record<string, string>,
    query: string,
    limit: number,
  ): ScoredKey[] {
    const queryWords = this.#tokenize(query);
    if (queryWords.length === 0) return [];

    const results: ScoredKey[] = [];

    for (const [key, value] of Object.entries(memory)) {
      const score = this.#scoreEntry(queryWords, key, value);
      if (score > 0) {
        results.push({ key, score });
      }
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, limit);
  }

  // ── Low-level helpers ──────────────────────────────────────

  #filterExpired(
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

  #filterStrings(obj: Record<string, unknown>): Record<string, string> {
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(obj)) {
      if (typeof value === "string") {
        result[key] = value;
      }
    }
    return result;
  }

  #loadJsonFile(filePath: string): Record<string, unknown> {
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

  #saveJsonFile(filePath: string, data: Record<string, unknown>): void {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });

    const tmpPath = `${filePath}.tmp`;
    const json = JSON.stringify(data, null, 2);
    fs.writeFileSync(tmpPath, json, "utf-8");
    fs.renameSync(tmpPath, filePath);
  }
}
