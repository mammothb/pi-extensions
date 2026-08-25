import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { expandTilde } from "./expand-tilde.js";

const ENV_PREFIX = "env:";
const FILE_PREFIX = "file:";
const CMD_PREFIX = "cmd:";

/**
 * Resolve a config string that may reference a secret through an indirection
 * prefix, so the secret can live outside the (often committed) config file:
 *
 *   "env:MY_VAR"   → process.env.MY_VAR
 *   "file:/a/b"    → contents of /a/b (trimmed); a leading `~` is expanded
 *   "cmd:command"  → stdout of command (trimmed); runs via execFileSync,
 *                    supports shell-style tokenization (quotes respected)
 *   "other"        → returned unchanged
 *
 * When the referenced source is missing or unreadable, the original string is
 * returned so the failure stays visible — a literal `env:MY_VAR` in the
 * resolved value is easier to spot than a silently empty secret.
 */
export function resolveSecret(value: string): string {
  if (value.startsWith(ENV_PREFIX)) {
    const name = value.slice(ENV_PREFIX.length);
    return process.env[name] ?? value;
  }
  if (value.startsWith(FILE_PREFIX)) {
    const filepath = expandTilde(value.slice(FILE_PREFIX.length));
    try {
      return existsSync(filepath)
        ? readFileSync(filepath, "utf-8").trim()
        : value;
    } catch {
      return value;
    }
  }
  if (value.startsWith(CMD_PREFIX)) {
    const tokens = tokenizeCommand(value.slice(CMD_PREFIX.length));
    const [file, ...args] = tokens;
    if (!file) {
      return value;
    }
    try {
      return execFileSync(file, args, {
        encoding: "utf-8",
        timeout: 10_000,
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
    } catch {
      return value;
    }
  }
  return value;
}

/**
 * Split a command string into argv, respecting single and double quotes.
 * No shell interpolation — `$`, backticks etc. stay literal.
 */
function tokenizeCommand(input: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: '"' | "'" | undefined;
  let started = false;
  for (const char of input) {
    if (quote) {
      if (char === quote) {
        quote = undefined;
      } else {
        current += char;
      }
    } else if (char === '"' || char === "'") {
      quote = char;
      started = true;
    } else if (/\s/.test(char)) {
      if (started) {
        tokens.push(current);
        current = "";
        started = false;
      }
    } else {
      current += char;
      started = true;
    }
  }
  if (started) {
    tokens.push(current);
  }
  return tokens;
}

/** Resolve every value in a record via `resolveSecret`. */
export function resolveSecrets(
  values: Record<string, string>,
): Record<string, string> {
  const resolved: Record<string, string> = {};
  for (const [key, value] of Object.entries(values)) {
    resolved[key] = resolveSecret(value);
  }
  return resolved;
}
