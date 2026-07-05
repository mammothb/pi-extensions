import { writeFileSync } from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { convertToLlm } from "@earendil-works/pi-coding-agent";
import {
  MM_COMPACT_INSTRUCTION,
  parseKeepAndPrompt,
} from "../core/compact-args";
import type { MmCompactDetails } from "../core/details";
import { loadSettings, type MmCompactSettings } from "../core/settings";
// TODO: rename MmCompactSettings → MmCompactSettings
import { compile } from "../core/summarize";
import type { CompactionReason } from "../core/types";

export { MM_COMPACT_INSTRUCTION } from "../core/compact-args";

export interface CompactionStats {
  summarized: number;
  kept: number;
  keptUserTurns: number;
  totalUserTurns: number;
  requestedKeepUserTurns: number;
  keepUserTurnsExplicit: boolean;
  keepFallbackToCompactAll: boolean;
  keptTokensEst: number;
  reason?: CompactionReason;
  willRetry?: boolean;
}

let lastStats: CompactionStats | null = null;
let lastCompactWasMmCompact = false;
let pendingFollowUpPrompt: string | null = null;
export const getLastCompactionStats = () => lastStats;

const formatTokens = (n: number): string => {
  if (n >= 1000) {
    return `${(n / 1000).toFixed(1)}k`;
  }
  return String(n);
};

export const formatCompactionStats = (stats: CompactionStats): string => {
  const fallbackNote = stats.keepFallbackToCompactAll
    ? stats.keepUserTurnsExplicit
      ? `; requested keep:${stats.requestedKeepUserTurns}, compact-all fallback`
      : "; compact-all fallback"
    : "";
  return `mm-compact: ${stats.summarized} source entries processed; tail kept ${stats.keptUserTurns}/${stats.totalUserTurns} user turns${fallbackNote} (${stats.kept} messages, ~${formatTokens(stats.keptTokensEst)} tok).`;
};

const readCompactionEventContext = (
  event: unknown,
): { reason?: CompactionReason; willRetry: boolean } => {
  const raw = event as { reason?: unknown; willRetry?: unknown };
  const reason =
    raw.reason === "manual" ||
    raw.reason === "threshold" ||
    raw.reason === "overflow"
      ? raw.reason
      : undefined;
  return { reason, willRetry: raw.willRetry === true };
};

const parseCompactionInstructions = (
  customInstructions?: string,
): {
  isMmCompact: boolean;
  keepUserTurns: number;
  keepUserTurnsExplicit: boolean;
  followUpPrompt: string | null;
} => {
  const trimmed = customInstructions?.trim();
  if (trimmed === MM_COMPACT_INSTRUCTION) {
    return {
      isMmCompact: true,
      keepUserTurns: 1,
      keepUserTurnsExplicit: false,
      followUpPrompt: null,
    };
  }

  const keepPrefix = `${MM_COMPACT_INSTRUCTION} `;
  if (trimmed?.startsWith(keepPrefix)) {
    const parsed = parseKeepAndPrompt(trimmed.slice(keepPrefix.length));
    return {
      isMmCompact: true,
      keepUserTurns: parsed.keepUserTurns ?? 1,
      keepUserTurnsExplicit: parsed.keepUserTurnsExplicit,
      followUpPrompt: null,
    };
  }

  const parsed = parseKeepAndPrompt(customInstructions);
  return {
    isMmCompact: false,
    keepUserTurns: parsed.keepUserTurns ?? 1,
    keepUserTurnsExplicit: parsed.keepUserTurnsExplicit,
    followUpPrompt: parsed.followUpPrompt || null,
  };
};

const normalizeKeepUserTurns = (keepUserTurns: number): number => {
  if (!Number.isFinite(keepUserTurns)) {
    return 0;
  }
  return Math.max(0, Math.floor(keepUserTurns));
};

const dbg = (settings: MmCompactSettings, data: Record<string, unknown>) => {
  if (!settings.debug) {
    return;
  }
  try {
    writeFileSync("/tmp/mm-compact-debug.json", JSON.stringify(data, null, 2));
  } catch {
    // best-effort debug logging
  }
};

const previewContent = (content: unknown): string => {
  if (typeof content === "string") {
    return content.slice(0, 300);
  }
  if (Array.isArray(content)) {
    return content
      .map((c: any) => {
        if (c?.type === "text") {
          return c.text ?? "";
        }
        if (c?.type === "toolCall") {
          return `[toolCall:${c.name}]`;
        }
        if (c?.type === "thinking") {
          return "[thinking]";
        }
        if (c?.type === "image") {
          return `[image:${c.mimeType}]`;
        }
        return `[${c?.type ?? "unknown"}]`;
      })
      .join("\n")
      .slice(0, 300);
  }
  return "";
};

interface EntryWithMessage {
  entry: { id: string; type: string };
  message: { role: string; content: unknown };
}

export type OwnCutCancelReason = "no_live_messages" | "too_few_live_messages";

export type OwnCutResult =
  | {
      ok: true;
      messages: any[];
      firstKeptEntryId: string;
      compactAll: boolean;
      keptUserTurns: number;
      totalUserTurns: number;
      requestedKeepUserTurns: number;
      keepFallbackToCompactAll: boolean;
    }
  | { ok: false; reason: OwnCutCancelReason };

export function buildOwnCut(
  branchEntries: any[],
  keepUserTurns = 1,
): OwnCutResult {
  const normalizedKeepUserTurns = normalizeKeepUserTurns(keepUserTurns);
  // Find the last compaction entry and its firstKeptEntryId
  let lastCompactionIdx = -1;
  let lastKeptId: string | undefined;
  for (let i = branchEntries.length - 1; i >= 0; i--) {
    if (branchEntries[i].type === "compaction") {
      lastCompactionIdx = i;
      lastKeptId = branchEntries[i].firstKeptEntryId;
      break;
    }
  }

  // Orphan recovery: triggers when lastKeptId is set to "" (sentinel from prior
  // compact-all) OR set to an id that no longer exists in the branch. In both cases,
  // start collecting from right after the last compaction entry.
  const hasPriorCompaction = lastCompactionIdx >= 0;
  const hasValidKeptId =
    !!lastKeptId && branchEntries.some((e: any) => e.id === lastKeptId);
  const orphanRecovery = hasPriorCompaction && !hasValidKeptId;

  // Collect live messages
  const liveMessages: EntryWithMessage[] = [];
  if (orphanRecovery) {
    for (let i = lastCompactionIdx + 1; i < branchEntries.length; i++) {
      const e = branchEntries[i];
      if (e.type === "compaction") {
        continue;
      }
      if (e.type === "message" && e.message) {
        liveMessages.push({ entry: e, message: e.message });
      }
    }
  } else {
    let foundKept = !lastKeptId; // if no prior compaction, start collecting immediately
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

const REASON_MESSAGES: Record<OwnCutCancelReason, string> = {
  no_live_messages: "mm-compact: Nothing to compact (no live messages)",
  too_few_live_messages: "mm-compact: Too few messages to compact",
};

export const registerBeforeCompactHook = (pi: ExtensionAPI) => {
  pi.on("session_before_compact", (event, ctx) => {
    const { preparation, branchEntries, customInstructions } = event;
    const { reason, willRetry } = readCompactionEventContext(event);
    const settings = loadSettings();

    // Always handle explicit /mm-compact marker.
    // Otherwise, only handle when user opted in via settings.
    const {
      isMmCompact,
      keepUserTurns,
      keepUserTurnsExplicit,
      followUpPrompt,
    } = parseCompactionInstructions(customInstructions);
    pendingFollowUpPrompt = null;
    if (!isMmCompact && !settings.overrideDefaultCompaction) {
      return;
    }

    const ownCut = buildOwnCut(branchEntries as any[], keepUserTurns);
    if (!ownCut.ok) {
      const lastComp = [...branchEntries]
        .reverse()
        .find((e: any) => e.type === "compaction");
      const lastCompIdx = lastComp
        ? (branchEntries as any[]).indexOf(lastComp)
        : -1;

      // Recompute liveMessages view (same logic as buildOwnCut) for diagnostic
      const lastKeptId: string | undefined = (lastComp as any)
        ?.firstKeptEntryId;
      const hasPriorCompaction = lastCompIdx >= 0;
      const hasValidKeptId =
        !!lastKeptId &&
        (branchEntries as any[]).some((e: any) => e.id === lastKeptId);
      const diagOrphan = hasPriorCompaction && !hasValidKeptId;
      const liveRoles: string[] = [];
      if (diagOrphan) {
        for (let i = lastCompIdx + 1; i < branchEntries.length; i++) {
          const e = (branchEntries as any[])[i];
          if (e.type === "compaction") {
            continue;
          }
          if (e.type === "message" && e.message) {
            liveRoles.push(e.message.role);
          }
        }
      } else {
        let foundKept = !lastKeptId;
        for (const e of branchEntries as any[]) {
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
            liveRoles.push(e.message.role);
          }
        }
      }
      const userIndices = liveRoles.reduce<number[]>((acc, r, i) => {
        if (r === "user") {
          acc.push(i);
        }
        return acc;
      }, []);

      pendingFollowUpPrompt = null;
      const fallbackToCore =
        !isMmCompact && (reason === "overflow" || willRetry);
      dbg(settings, {
        cancelled: !fallbackToCore,
        fallbackToCore,
        reason: ownCut.reason,
        compaction: { reason, willRetry },
        isMmCompact,
        counts: {
          total: branchEntries.length,
          messages: (branchEntries as any[]).filter(
            (e: any) => e.type === "message",
          ).length,
          compactions: (branchEntries as any[]).filter(
            (e: any) => e.type === "compaction",
          ).length,
          entriesAfterLastCompaction:
            lastCompIdx >= 0 ? branchEntries.length - lastCompIdx - 1 : null,
        },
        liveMessages: {
          count: liveRoles.length,
          userCount: userIndices.length,
          firstUserIdx: userIndices[0] ?? null,
          lastUserIdx: userIndices[userIndices.length - 1] ?? null,
          roleSequence:
            liveRoles.length <= 30
              ? liveRoles
              : [...liveRoles.slice(0, 10), "...", ...liveRoles.slice(-10)],
        },
        lastCompaction: lastComp
          ? {
              hasFirstKeptEntryId: !!(lastComp as any).firstKeptEntryId,
              foundInBranch: (lastComp as any).firstKeptEntryId
                ? (branchEntries as any[]).some(
                    (e: any) => e.id === (lastComp as any).firstKeptEntryId,
                  )
                : null,
            }
          : null,
        tail: (branchEntries as any[]).slice(-5).map((e: any) => ({
          type: e.type,
          role: e.type === "message" ? e.message?.role : undefined,
          hasContent:
            e.type === "message" ? e.message?.content != null : undefined,
        })),
      });

      if (fallbackToCore) {
        return;
      }

      try {
        ctx?.ui?.notify?.(REASON_MESSAGES[ownCut.reason], "warning");
      } catch {
        // best-effort notification
      }
      return { cancel: true };
    }

    pendingFollowUpPrompt = followUpPrompt;
    const agentMessages = ownCut.messages;
    const firstKeptEntryId = ownCut.firstKeptEntryId;
    const messages = convertToLlm(agentMessages);

    // Count kept messages and estimate tokens
    const keptIdx = (branchEntries as any[]).findIndex(
      (e: any) => e.id === firstKeptEntryId,
    );
    const keptEntries =
      keptIdx >= 0
        ? (branchEntries as any[])
            .slice(keptIdx)
            .filter((e: any) => e.type === "message")
        : [];
    const keptChars = keptEntries.reduce((sum: number, e: any) => {
      const c = e.message?.content;
      if (typeof c === "string") {
        return sum + c.length;
      }
      if (Array.isArray(c)) {
        return (
          sum +
          c.reduce((s: number, p: any) => {
            if (p.text) {
              return s + p.text.length;
            }
            if (p.type === "toolCall") {
              return (
                s +
                (p.name?.length ?? 0) +
                (typeof p.input === "string"
                  ? p.input.length
                  : JSON.stringify(p.input ?? "").length)
              );
            }
            if (p.type === "toolResult") {
              return (
                s +
                (typeof p.content === "string"
                  ? p.content.length
                  : JSON.stringify(p.content ?? "").length)
              );
            }
            return s;
          }, 0)
        );
      }
      return sum;
    }, 0);
    lastStats = {
      summarized: agentMessages.length,
      kept: keptEntries.length,
      keptUserTurns: ownCut.keptUserTurns,
      totalUserTurns: ownCut.totalUserTurns,
      requestedKeepUserTurns: ownCut.requestedKeepUserTurns,
      keepUserTurnsExplicit,
      keepFallbackToCompactAll: ownCut.keepFallbackToCompactAll,
      keptTokensEst: Math.round(keptChars / 4),
      reason,
      willRetry,
    };

    const config = settings;

    const summary = compile({
      messages,
      previousSummary: preparation.previousSummary,
    });

    const branchIds = branchEntries.map((e: any) => e.id);
    const cutIdx2 = branchIds.indexOf(firstKeptEntryId);
    const cutWindow =
      cutIdx2 >= 0
        ? branchEntries
            .slice(
              Math.max(0, cutIdx2 - 3),
              Math.min(branchEntries.length, cutIdx2 + 3),
            )
            .map((e: any) => ({
              id: e.id,
              type: e.type,
              role: e.type === "message" ? e.message?.role : undefined,
              preview:
                e.type === "message"
                  ? previewContent(e.message?.content)
                  : undefined,
            }))
        : [];

    dbg(config, {
      usedOwnCut: true,
      compaction: { reason, willRetry },
      messagesToSummarize: agentMessages.length,
      messagesPreviewHead: agentMessages.slice(0, 3).map((m: any) => ({
        role: m.role,
        preview: previewContent(m.content),
      })),
      messagesPreviewTail: agentMessages.slice(-3).map((m: any) => ({
        role: m.role,
        preview: previewContent(m.content),
      })),
      convertedMessages: messages.length,
      firstKeptEntryId,
      cutWindow,
      tokensBefore: preparation.tokensBefore,
      summaryLength: summary.length,
      summaryPreview: summary.slice(0, 500),
      sections: [...summary.matchAll(/^\[(.+?)\]/gm)]
        .map((m) => m[1])
        .filter((s): s is string => s != null),
    });

    const details: MmCompactDetails = {
      compactor: "mm-compact",
      version: 1,
      sections: [...summary.matchAll(/^\[(.+?)\]/gm)]
        .map((m) => m[1])
        .filter((s): s is string => s != null),
      sourceMessageCount: agentMessages.length,
      previousSummaryUsed: Boolean(preparation.previousSummary),
      reason,
      willRetry,
    };

    lastCompactWasMmCompact = isMmCompact;

    return {
      compaction: {
        summary,
        details,
        tokensBefore: preparation.tokensBefore,
        firstKeptEntryId,
      },
    };
  });

  // Fire success toast for /compact path only (delayed to let UI settle).
  // /mm-compact path uses its own onComplete callback in the command handler.
  pi.on("session_compact", (event, ctx) => {
    const { reason, willRetry } = readCompactionEventContext(event);
    if (!event.fromExtension) {
      return;
    }
    const followUpPrompt = pendingFollowUpPrompt;
    pendingFollowUpPrompt = null;
    if (lastCompactWasMmCompact) {
      return; // /mm-compact handles its own toast via onComplete
    }
    if (reason === "overflow" || willRetry) {
      return;
    }
    const stats = lastStats;
    if (!stats) {
      return;
    }
    if (followUpPrompt) {
      pi.sendUserMessage(followUpPrompt);
    }
    setTimeout(() => {
      try {
        ctx?.ui?.notify?.(formatCompactionStats(stats), "info");
      } catch {
        // best-effort
      }
    }, 500);
  });
};
