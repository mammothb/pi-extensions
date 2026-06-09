/**
 * Wildcard pattern compilation and matching for tools and paths permissions.
 *
 * Syntax:
 *   `*`   — matches any characters except `/` (within a path segment)
 *   `**`  — matches any characters including `/` (across path segments)
 *   `?`   — matches exactly one character except `/`
 *
 * Backslashes in patterns and inputs are normalized to forward slashes.
 * Matching iterates in reverse for last-match-wins semantics.
 */

export interface CompiledWildcardPattern {
  pattern: string;
  regex: RegExp;
}

export interface WildcardMatch {
  pattern: string;
  matchedInput: string;
}

/**
 * Compile a wildcard pattern string into a RegExp.
 *
 * `*`  → `[^/]*`
 * `**` → `.*`
 * `?`  → `[^/]`
 */
export function compileWildcardPattern(
  pattern: string,
): CompiledWildcardPattern {
  // Normalize backslashes to forward slashes
  const normalized = pattern.replaceAll("\\", "/");

  // Escape regex metacharacters first
  let escaped = normalized.replace(/[.+^${}()|[\]\\]/g, "\\$&");

  // Replace wildcard tokens. Use string placeholders to prevent
  // intermediate regex syntax from being consumed by later replacements.
  // \uE000 — **/ placeholder → (.*/)?
  // \uE001 — /** placeholder  → (/.*)?
  // **  → .*
  // *   → [^/]*
  // ?   → [^/]
  escaped = escaped
    .replace(/\*\*\//g, "\uE000")
    .replace(/\/\*\*/g, "\uE001")
    .replace(/\*\*/g, ".*")
    .replace(/\*/g, "[^/]*")
    .replace(/\?/g, "[^/]")
    .replace(/\uE000/g, "(.*/)?")
    .replace(/\uE001/g, "(/.*)?");

  // Anchor: full string match
  escaped = `^${escaped}$`;

  return {
    pattern: normalized,
    regex: new RegExp(escaped),
  };
}

/**
 * Compile an array of [pattern, state] entries into CompiledWildcardPatterns.
 * The state is preserved with each compiled pattern.
 */
export function compilePatternEntries<T>(
  entries: Iterable<readonly [string, T]>,
): (CompiledWildcardPattern & { state: T })[] {
  return Array.from(entries, ([pattern, state]) => ({
    ...compileWildcardPattern(pattern),
    state,
  }));
}

/**
 * Compile a Record<pattern, state> into an array of compiled patterns with state.
 */
export function compilePatterns<T>(
  patterns: Record<string, T>,
): (CompiledWildcardPattern & { state: T })[] {
  return compilePatternEntries(Object.entries(patterns));
}

/**
 * Find the last matching pattern for the given input.
 * Returns the match info (pattern name + matched input) or null.
 *
 * Iterates in reverse for last-match-wins semantics: later entries in the
 * config override earlier ones.
 */
export function findCompiledWildcardMatch<T>(
  patterns: readonly (CompiledWildcardPattern & { state: T })[],
  input: string,
): (WildcardMatch & { state: T }) | null {
  const normalizedInput = input.replaceAll("\\", "/");

  for (let i = patterns.length - 1; i >= 0; i -= 1) {
    const compiled = patterns[i];
    if (!compiled) continue;
    if (compiled.regex.test(normalizedInput)) {
      return {
        pattern: compiled.pattern,
        matchedInput: input,
        state: compiled.state,
      };
    }
  }

  return null;
}

/**
 * Find the last matching pattern for the first matching name in a list.
 * Each name is tried in order; the first name that has any match wins.
 */
export function findCompiledWildcardMatchForNames<T>(
  patterns: readonly (CompiledWildcardPattern & { state: T })[],
  names: readonly string[],
): (WildcardMatch & { state: T }) | null {
  const normalizedNames = names
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

  if (normalizedNames.length === 0) {
    return null;
  }

  for (const name of normalizedNames) {
    const match = findCompiledWildcardMatch(patterns, name);
    if (match) {
      return match;
    }
  }

  return null;
}
