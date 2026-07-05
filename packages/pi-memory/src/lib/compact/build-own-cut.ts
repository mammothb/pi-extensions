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
  // Find the last compaction entry and its firstKeptEntryId
  let lastCompactionIdx = -1;
  let lastKeptId: string | undefined;
  for (let i = branchEntries.length - 1; i >= 0; i--) {
    if (branchEntries[i]?.type === "compaction") {
      lastCompactionIdx = i;
      lastKeptId = branchEntries[i]?.firstKeptEntryId;
      break;
    }
  }

  const hasPriorCompaction = lastCompactionIdx >= 0;
  const hasValidKeptId =
    !!lastKeptId && branchEntries.some((e) => e.id === lastKeptId);
  const orphanRecovery = hasPriorCompaction && !hasValidKeptId;

  const liveMessages: EntryWithMessage[] = [];
  if (orphanRecovery) {
    for (let i = lastCompactionIdx + 1; i < branchEntries.length; i++) {
      const e = branchEntries[i];
      if (!e) {
        continue;
      }
      if (e.type === "compaction") {
        continue;
      }
      if (e.type === "message" && e.message) {
        liveMessages.push({ entry: e, message: e.message });
      }
    }
  } else {
    let foundKept = !lastKeptId;
    for (const e of branchEntries) {
      if (!foundKept && e.id === lastKeptId) {
        foundKept = true;
      }
      if (!foundKept) {
        continue;
      }
      if (e.type === "compaction") {
        continue;
      }
      if (e.type === "message" && e.message) {
        liveMessages.push({ entry: e, message: e.message });
      }
    }
  }

  return liveMessages;
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
