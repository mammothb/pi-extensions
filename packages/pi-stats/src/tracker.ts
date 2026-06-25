import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const LOG_FILE = path.join(
  os.homedir(),
  ".pi",
  "agent",
  "extension-stats.jsonl",
);

export interface UsageRecord {
  ts: number;
  ext: string;
  kind: "tool" | "ext-cmd";
  session?: string;
}

export interface UsageStats {
  extensions: Record<string, number>;
}

export function appendRecord(rec: UsageRecord): void {
  try {
    fs.appendFileSync(LOG_FILE, `${JSON.stringify(rec)}\n`);
  } catch {
    // never let metrics break the agent
  }
}

export function readRecords(sinceMs?: number): UsageRecord[] {
  let raw: string;
  try {
    raw = fs.readFileSync(LOG_FILE, "utf8");
  } catch {
    return [];
  }
  const out: UsageRecord[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) {
      continue;
    }
    try {
      const r = JSON.parse(line) as UsageRecord;
      if (sinceMs && r.ts < sinceMs) {
        continue;
      }
      out.push(r);
    } catch {
      // skip bad line
    }
  }
  return out;
}

export function aggregate(records: UsageRecord[]): UsageStats {
  const extensions: Record<string, number> = {};
  for (const r of records) {
    extensions[r.ext] = (extensions[r.ext] ?? 0) + 1;
  }
  return { extensions };
}

export class StatsTracker {
  private logFile: string;

  constructor(logFile?: string) {
    this.logFile = logFile ?? LOG_FILE;
  }

  recordExtension(
    name: string,
    kind: "tool" | "ext-cmd",
    session?: string,
  ): void {
    appendTo(this.logFile, { ts: Date.now(), ext: name, kind, session });
  }

  getStats(sinceMs?: number): UsageStats {
    return aggregate(readFrom(this.logFile, sinceMs));
  }

  reset(): void {
    try {
      fs.writeFileSync(this.logFile, "");
    } catch {
      // ignore
    }
  }
}

function appendTo(file: string, rec: UsageRecord): void {
  try {
    fs.appendFileSync(file, `${JSON.stringify(rec)}\n`);
  } catch {
    // never let metrics break the agent
  }
}

function readFrom(file: string, sinceMs?: number): UsageRecord[] {
  let raw: string;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch {
    return [];
  }
  const out: UsageRecord[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) {
      continue;
    }
    try {
      const r = JSON.parse(line) as UsageRecord;
      if (sinceMs && r.ts < sinceMs) {
        continue;
      }
      out.push(r);
    } catch {
      // skip bad line
    }
  }
  return out;
}
