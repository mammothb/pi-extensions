import { parse as parseYaml } from "yaml";
import type { AgentConfig } from "./types.js";

/**
 * Parsed frontmatter result.
 * - frontmatter is null when the file does not start with a `---` delimiter
 *   (not an agent definition file).
 * - frontmatter is null and a warning is logged when the opener exists but
 *   no closing `---` is found (unclosed frontmatter).
 */
export interface ParsedFrontmatter {
  frontmatter: Record<string, string> | null;
  body: string;
}

/**
 * Parse YAML frontmatter from a markdown string.
 *
 * Frontmatter is delimited by `---` on its own line. The opening delimiter
 * must be the first line of the file. Everything between the first and
 * second `---` is parsed as flat key-value YAML (no nesting, no arrays).
 */
export function parseFrontmatter(
  content: string,
  filename: string,
): ParsedFrontmatter {
  const lines = content.split("\n");

  // Must start with ---
  if (lines[0]?.trim() !== "---") {
    return { frontmatter: null, body: content };
  }

  // Find closing ---
  let closeIdx = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i]?.trim() === "---") {
      closeIdx = i;
      break;
    }
  }

  if (closeIdx === -1) {
    console.warn(`parseFrontmatter: unclosed frontmatter in ${filename}`);
    return { frontmatter: null, body: content };
  }

  // Parse YAML lines between delimiters
  const yamlStr = lines.slice(1, closeIdx).join("\n");

  // Empty frontmatter is valid — return empty mapping
  if (yamlStr.trim() === "") {
    const body = lines.slice(closeIdx + 1).join("\n");
    return { frontmatter: {}, body };
  }

  let frontmatter: Record<string, string>;

  try {
    const parsed = parseYaml(yamlStr);
    if (
      parsed === null ||
      parsed === undefined ||
      typeof parsed !== "object" ||
      Array.isArray(parsed)
    ) {
      console.warn(
        `parseFrontmatter: invalid frontmatter in ${filename} — expected mapping, got ${parsed === null ? "null" : typeof parsed}`,
      );
      return { frontmatter: null, body: content };
    }
    // Force all values to strings (YAML may parse numbers, booleans, etc.)
    frontmatter = {};
    for (const [key, value] of Object.entries(
      parsed as Record<string, unknown>,
    )) {
      frontmatter[key] = String(value);
    }
  } catch (err) {
    console.warn(
      `parseFrontmatter: YAML parse error in ${filename}: ${err instanceof Error ? err.message : String(err)}`,
    );
    return { frontmatter: null, body: content };
  }

  const body = lines.slice(closeIdx + 1).join("\n");

  return { frontmatter, body };
}

/**
 * Discover and parse all agent definition files.
 * Scans user-level (~/.pi/agent/agents/) and project-level (.pi/agents/) directories.
 * Project agents override user agents with the same name.
 */
export function discoverAgents(_cwd: string): AgentConfig[] {
  // TODO: implement in later phases
  return [];
}
