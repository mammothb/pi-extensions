import { normalize, resolve } from "node:path";
import { expandTilde } from "@mammothb/pi-shared";
import { runBashArbiter } from "./arbiter.js";
import type { GuardResult, ResolvedConfig } from "./lib/types.js";
import { compilePatterns, findCompiledWildcardMatch } from "./lib/wildcard.js";

/**
 * Check whether a tool is allowed by name.
 *
 * Matches toolName against config.tools wildcard patterns (last-match-wins).
 * Falls back to config.defaults.tools.
 */
export function checkTool(
  toolName: string,
  config: ResolvedConfig,
): GuardResult {
  const patterns = compilePatterns(config.tools);
  const match = findCompiledWildcardMatch(patterns, toolName);

  if (match) {
    return {
      action: match.state,
      reason: `matched tool rule "${match.pattern}"`,
      matchedRule: match.pattern,
    };
  }

  return {
    action: config.defaults.tools,
    reason: `no tool rule matched, fallback: ${config.defaults.tools}`,
  };
}

/**
 * Check whether a bash command is allowed.
 *
 * If a bash arbiter is configured, runs it and returns its result.
 * Otherwise falls back to config.defaults.bash.
 */
export function checkBash(
  command: string,
  config: ResolvedConfig,
): Promise<GuardResult> {
  if (config.bashArbiterPath) {
    return runBashArbiter(command, config.bashArbiterPath);
  }

  return Promise.resolve({
    action: config.defaults.bash,
    reason: `no bash arbiter configured, fallback: ${config.defaults.bash}`,
  });
}

/**
 * Check whether a file path is protected.
 *
 * Resolves targetPath relative to cwd (with tilde expansion), then matches
 * against config.paths wildcard patterns (last-match-wins). Falls back to
 * config.defaults.paths.
 */
export function checkPath(
  targetPath: string,
  cwd: string,
  config: ResolvedConfig,
): GuardResult {
  // Expand ~ and resolve relative to cwd
  const expanded = expandTilde(targetPath);
  const absolute = resolve(cwd, expanded);
  const normalized = normalize(absolute);

  const patterns = compilePatterns(config.paths);
  const match = findCompiledWildcardMatch(patterns, normalized);

  if (match) {
    return {
      action: match.state,
      reason: `matched path rule "${match.pattern}" for ${normalized}`,
      matchedRule: match.pattern,
    };
  }

  return {
    action: config.defaults.paths,
    reason: `no path rule matched, fallback: ${config.defaults.paths}`,
  };
}
