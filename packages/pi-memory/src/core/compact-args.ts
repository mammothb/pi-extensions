export const MM_COMPACT_INSTRUCTION = "__mm_compact__";

const KEEP_TOKEN_RE = /^keep:(\d+)$/;

export interface ParsedCompactionArgs {
  followUpPrompt: string;
  keepUserTurns: number | null;
  keepUserTurnsExplicit: boolean;
}

const parseKeepUserTurns = (raw: string): number => {
  const value = Number(raw);
  return Number.isSafeInteger(value) ? value : Number.MAX_SAFE_INTEGER;
};

export const parseKeepAndPrompt = (args?: string): ParsedCompactionArgs => {
  const trimmed = args?.trim() ?? "";
  if (!trimmed) {
    return {
      followUpPrompt: "",
      keepUserTurns: null,
      keepUserTurnsExplicit: false,
    };
  }

  const startMatch = trimmed.match(/^keep:(\d+)(?:\s+|$)([\s\S]*)$/);
  if (startMatch?.[1] && startMatch[2] !== undefined) {
    return {
      followUpPrompt: startMatch[2].trim(),
      keepUserTurns: parseKeepUserTurns(startMatch[1]),
      keepUserTurnsExplicit: true,
    };
  }

  const parts = trimmed.split(/\s+/);
  const lastPart = parts[parts.length - 1];
  const endMatch = lastPart?.match(KEEP_TOKEN_RE);
  if (endMatch?.[1] && lastPart) {
    return {
      followUpPrompt: trimmed.slice(0, trimmed.length - lastPart.length).trim(),
      keepUserTurns: parseKeepUserTurns(endMatch[1]),
      keepUserTurnsExplicit: true,
    };
  }

  return {
    followUpPrompt: trimmed,
    keepUserTurns: null,
    keepUserTurnsExplicit: false,
  };
};

export const buildMmCompactInstructions = (
  keepUserTurns: number | null,
): string => {
  if (keepUserTurns == null) {
    return MM_COMPACT_INSTRUCTION;
  }
  return `${MM_COMPACT_INSTRUCTION} keep:${keepUserTurns}`;
};
