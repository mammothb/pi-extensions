/**
 * Core types for the pi-permissions extension.
 */

export type PermissionState = "allow" | "deny" | "ask";

/** The bash section config — just a path to the arbiter executable. */
export interface BashConfig {
  arbiter?: string;
}

/** Top-level configuration as loaded from JSON files. */
export interface PermissionConfig {
  defaults?: Partial<Defaults>;
  tools?: Record<string, PermissionState>;
  bash?: BashConfig;
  paths?: Record<string, PermissionState>;
}

/** Fallback permission state when no specific rule matches. */
export interface Defaults {
  tools: PermissionState;
  bash: PermissionState;
  paths: PermissionState;
}

/** Fully resolved config with all defaults applied. */
export interface ResolvedConfig {
  defaults: Defaults;
  tools: Record<string, PermissionState>;
  /** Resolved absolute path to the bash arbiter, or undefined if none configured. */
  bashArbiterPath?: string;
  paths: Record<string, PermissionState>;
}

/** Result of a permission check. */
export interface GuardResult {
  action: PermissionState;
  reason: string;
  matchedRule?: string;
}

/** A stored session approval (in-memory, not persisted). */
export interface SessionApproval {
  toolName: string;
  command?: string;
  path?: string;
  decision: "allow" | "deny";
}
