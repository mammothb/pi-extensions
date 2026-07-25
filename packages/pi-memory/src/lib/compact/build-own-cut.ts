import type { BranchEntry, BranchEntryMessage } from "./types";

interface EntryWithMessage {
  entry: BranchEntry;
  message: NonNullable<BranchEntry["message"]>;
}

export type OwnCutCancelReason = "no_live_messages" | "too_few_live_messages";

export type OwnCutResult =
  | {
      ok: true;
      messages: BranchEntryMessage[];
      firstKeptEntryId: string;
      compactAll: boolean;
      keptUserTurns: number;
      totalUserTurns: number;
      requestedKeepUserTurns: number;
      keepFallbackToCompactAll: boolean;
    }
  | { ok: false; reason: OwnCutCancelReason };

export const REASON_MESSAGES: Record<OwnCutCancelReason, string> = {
  no_live_messages: "mm-compact: Nothing to compact (no live messages)",
  too_few_live_messages: "mm-compact: Too few messages to compact",
};

const normalizeKeepUserTurns = (keepUserTurns: number): number => {
  if (!Number.isFinite(keepUserTurns)) {
    return 0;
  }
  return Math.max(0, Math.floor(keepUserTurns));
};

/** Find the last compaction entry, its index, and firstKeptEntryId. */
export function findLastCompaction(branchEntries: BranchEntry[]): {
  idx: number;
  entry: BranchEntry;
  firstKeptEntryId: string | undefined;
} | null {
  for (let i = branchEntries.length - 1; i >= 0; i--) {
    const e = branchEntries[i];
    if (e?.type === "compaction") {
      return { idx: i, entry: e, firstKeptEntryId: e.firstKeptEntryId };
    }
  }
  return null;
}

/** Convert a BranchEntry to an EntryWithMessage, or null if it's a compaction or has no message. */
function entryToMessage(e: BranchEntry): EntryWithMessage | null {
  if (e.type === "compaction") {
    return null;
  }
  if (e.type === "message" && e.message) {
    return { entry: e, message: e.message };
  }
  return null;
}

/** Collect message entries from an array of BranchEntry, filtering out non-messages. */
function collectMessages(entries: BranchEntry[]): EntryWithMessage[] {
  const result: EntryWithMessage[] = [];
  for (const e of entries) {
    const m = entryToMessage(e);
    if (m) {
      result.push(m);
    }
  }
  return result;
}

/**
 * Collect live message entries from a branch.
 *
 * Handles orphan recovery: when the prior compaction's firstKeptEntryId is
 * "" (compact-all sentinel) or points to an entry no longer in the branch,
 * collection starts from right after the last compaction entry. Otherwise
 * collection starts from the last kept entry.
 */
export function collectLiveMessages(
  branchEntries: BranchEntry[],
): EntryWithMessage[] {
  const comp = findLastCompaction(branchEntries);
  const hasValidKeptId =
    !!comp?.firstKeptEntryId &&
    branchEntries.some((e) => e.id === comp.firstKeptEntryId);
  const orphanRecovery = comp && !hasValidKeptId;

  if (orphanRecovery) {
    return collectMessages(branchEntries.slice(comp.idx + 1));
  }

  // Standard path: collect from the last kept entry onward (or from start if none)
  let foundKept = !comp?.firstKeptEntryId;
  const entries: BranchEntry[] = [];
  for (const e of branchEntries) {
    if (!foundKept && e.id === comp?.firstKeptEntryId) {
      foundKept = true;
    }
    if (foundKept) {
      entries.push(e);
    }
  }
  return collectMessages(entries);
}

export function buildOwnCut(
  branchEntries: BranchEntry[],
  keepUserTurns = 1,
): OwnCutResult {
  const normalizedKeepUserTurns = normalizeKeepUserTurns(keepUserTurns);
  const liveMessages = collectLiveMessages(branchEntries);

  if (liveMessages.length === 0) {
    return { ok: false, reason: "no_live_messages" };
  }
  if (liveMessages.length <= 2) {
    return { ok: false, reason: "too_few_live_messages" };
  }

  const userIndices = liveMessages.reduce<number[]>((acc, e, i) => {
    if (e.message.role === "user") {
      acc.push(i);
    }
    return acc;
  }, []);
  const compactAll = (keepFallbackToCompactAll: boolean) => ({
    ok: true as const,
    messages: liveMessages.map((e) => e.message),
    firstKeptEntryId: "",
    compactAll: true,
    keptUserTurns: 0,
    totalUserTurns: userIndices.length,
    requestedKeepUserTurns: normalizedKeepUserTurns,
    keepFallbackToCompactAll,
  });

  if (normalizedKeepUserTurns <= 0) {
    return compactAll(false);
  }

  // Summarize all messages before the requested kept user-turn tail.
  const targetUserIdx = userIndices.length - normalizedKeepUserTurns;
  const rawCutIdx = targetUserIdx >= 0 ? userIndices[targetUserIdx] : undefined;
  const cutIdx = rawCutIdx ?? -1;

  if (cutIdx <= 0) {
    // Keep request cannot form a safe boundary (single user prompt, no user prompt,
    // or keep larger than available user turns), so compact EVERYTHING and keep no tail.
    // firstKeptEntryId="" is a sentinel: pi-core's buildSessionContext won't match it
    // (so 0 kept from pre-compaction), and next buildOwnCut triggers orphan recovery.
    return compactAll(true);
  }

  const firstKept = liveMessages[cutIdx];
  if (!firstKept) {
    return compactAll(true);
  }

  return {
    ok: true,
    messages: liveMessages.slice(0, cutIdx).map((e) => e.message),
    firstKeptEntryId: firstKept.entry.id,
    compactAll: false,
    keptUserTurns: userIndices.length - targetUserIdx,
    totalUserTurns: userIndices.length,
    requestedKeepUserTurns: normalizedKeepUserTurns,
    keepFallbackToCompactAll: false,
  };
}
