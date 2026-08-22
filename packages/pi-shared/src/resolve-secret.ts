import { existsSync, readFileSync } from "node:fs";
import { expandTilde } from "./expand-tilde.js";

const ENV_PREFIX = "env:";
const FILE_PREFIX = "file:";

/**
 * Resolve a config string that may reference a secret through an indirection
 * prefix, so the secret can live outside the (often committed) config file:
 *
 *   "env:MY_VAR"   → process.env.MY_VAR
 *   "file:/a/b"    → contents of /a/b (trimmed); a leading `~` is expanded
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
  return value;
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
