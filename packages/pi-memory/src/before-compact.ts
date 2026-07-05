import { writeFileSync } from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { convertToLlm } from "@earendil-works/pi-coding-agent";
import {
  buildOwnCut,
  collectLiveMessages,
  REASON_MESSAGES,
} from "./lib/compact/build-own-cut";
import {
  MM_COMPACT_INSTRUCTION,
  parseKeepAndPrompt,
} from "./lib/compact/compact-args";
import { loadSettings, type MmCompactSettings } from "./lib/compact/settings";
import { compile } from "./lib/compact/summarize";
import type {
  BranchEntry,
  CompactionReason,
  MmCompactDetails,
} from "./lib/compact/types";

export { MM_COMPACT_INSTRUCTION } from "./lib/compact/compact-args";

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

// ── Factory for isolated hook state ────────────────────────────

interface BeforeCompactState {
  lastStats: CompactionStats | null;
  lastCompactWasMmCompact: boolean;
  pendingFollowUpPrompt: string | null;
}

export function createBeforeCompactHook() {
  const state: BeforeCompactState = {
    lastStats: null,
    lastCompactWasMmCompact: false,
    pendingFollowUpPrompt: null,
  };

  const register = (pi: ExtensionAPI) => {
    registerHookWithState(pi, state);
  };

  const getLastStats = () => state.lastStats;

  return { register, getLastStats };
}

// Singleton for the default export — tests use createBeforeCompactHook() directly.
const defaultHook = createBeforeCompactHook();

export const registerBeforeCompactHook = defaultHook.register;
export const getLastCompactionStats = defaultHook.getLastStats;

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

function registerHookWithState(pi: ExtensionAPI, state: BeforeCompactState) {
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
    state.pendingFollowUpPrompt = null;
    if (!isMmCompact && !settings.overrideDefaultCompaction) {
      return;
    }

    const ownCut = buildOwnCut(branchEntries as BranchEntry[], keepUserTurns);
    if (!ownCut.ok) {
      const lastComp = [...branchEntries]
        .reverse()
        .find((e) => e.type === "compaction");
      const lastCompIdx = lastComp
        ? (branchEntries as BranchEntry[]).indexOf(lastComp)
        : -1;

      // Reuse collectLiveMessages for diagnostic data
      const liveMessages = collectLiveMessages(branchEntries as BranchEntry[]);
      const liveRoles = liveMessages.map((m) => m.message.role);
      const userIndices = liveRoles.reduce<number[]>((acc, r, i) => {
        if (r === "user") {
          acc.push(i);
        }
        return acc;
      }, []);

      state.pendingFollowUpPrompt = null;
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
          messages: (branchEntries as BranchEntry[]).filter(
            (e) => e.type === "message",
          ).length,
          compactions: (branchEntries as BranchEntry[]).filter(
            (e) => e.type === "compaction",
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
              hasFirstKeptEntryId: !!lastComp.firstKeptEntryId,
              foundInBranch: lastComp.firstKeptEntryId
                ? (branchEntries as BranchEntry[]).some(
                    (e) => e.id === lastComp.firstKeptEntryId,
                  )
                : null,
            }
          : null,
        tail: (branchEntries as BranchEntry[]).slice(-5).map((e) => ({
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

    state.pendingFollowUpPrompt = followUpPrompt;
    const agentMessages = ownCut.messages;
    const firstKeptEntryId = ownCut.firstKeptEntryId;
    // Cast: BranchEntryMessage[] is structurally compatible with pi-core's AgentMessage[]
    const messages = convertToLlm(agentMessages as any[]);

    // Count kept messages and estimate tokens
    const keptIdx = (branchEntries as BranchEntry[]).findIndex(
      (e) => e.id === firstKeptEntryId,
    );
    const keptEntries =
      keptIdx >= 0
        ? (branchEntries as BranchEntry[])
            .slice(keptIdx)
            .filter((e) => e.type === "message")
        : [];
    const keptChars = keptEntries.reduce((sum, e) => {
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
    state.lastStats = {
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

    const sectionNames = [...summary.matchAll(/^\[(.+?)\]/gm)]
      .map((m) => m[1])
      .filter((s): s is string => s != null);

    const entries = branchEntries as BranchEntry[];
    const branchIds = entries.map((e) => e.id);
    const cutIdx2 = branchIds.indexOf(firstKeptEntryId);
    const cutWindow =
      cutIdx2 >= 0
        ? entries
            .slice(
              Math.max(0, cutIdx2 - 3),
              Math.min(entries.length, cutIdx2 + 3),
            )
            .map((e) => ({
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
      messagesPreviewHead: agentMessages.slice(0, 3).map((m) => ({
        role: m.role,
        preview: previewContent(m.content),
      })),
      messagesPreviewTail: agentMessages.slice(-3).map((m) => ({
        role: m.role,
        preview: previewContent(m.content),
      })),
      convertedMessages: messages.length,
      firstKeptEntryId,
      cutWindow,
      tokensBefore: preparation.tokensBefore,
      summaryLength: summary.length,
      summaryPreview: summary.slice(0, 500),
      sections: sectionNames,
    });

    const details: MmCompactDetails = {
      compactor: "mm-compact",
      version: 1,
      sections: sectionNames,
      sourceMessageCount: agentMessages.length,
      previousSummaryUsed: Boolean(preparation.previousSummary),
      reason,
      willRetry,
    };

    state.lastCompactWasMmCompact = isMmCompact;

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
    const followUpPrompt = state.pendingFollowUpPrompt;
    state.pendingFollowUpPrompt = null;
    if (state.lastCompactWasMmCompact) {
      return; // /mm-compact handles its own toast via onComplete
    }
    if (reason === "overflow" || willRetry) {
      return;
    }
    const stats = state.lastStats;
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
}
