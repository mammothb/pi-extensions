import type { CompactionReason } from "./types";

export interface MmCompactDetails {
  compactor: "mm-compact";
  version: number;
  sections: string[];
  sourceMessageCount: number;
  previousSummaryUsed: boolean;
  reason?: CompactionReason;
  willRetry?: boolean;
}
