export type CompactionReason = "manual" | "threshold" | "overflow";

export interface MmCompactDetails {
  compactor: "mm-compact";
  version: number;
  sections: string[];
  sourceMessageCount: number;
  previousSummaryUsed: boolean;
  reason?: CompactionReason;
  willRetry?: boolean;
}

export interface BranchEntryMessage {
  role: string;
  content: unknown;
}

export interface BranchEntry {
  id: string;
  type: string;
  message?: BranchEntryMessage;
  firstKeptEntryId?: string;
}
