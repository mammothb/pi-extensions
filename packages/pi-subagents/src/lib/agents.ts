import { readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { parse as parseYaml } from "yaml";
import { loadSubagentConfig } from "./config.js";
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

function normalizeYamlValues(
  parsed: Record<string, unknown>,
  filename: string,
): Record<string, string> {
  const frontmatter: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (value === null || value === undefined) {
      frontmatter[key] = "";
    } else if (typeof value === "object") {
      console.warn(
        `parseFrontmatter: skipping key "${key}" in ${filename} — nested values not supported`,
      );
    } else if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      frontmatter[key] = String(value);
    } else {
      console.warn(
        `parseFrontmatter: skipping key "${key}" in ${filename} — unsupported type ${typeof value}`,
      );
    }
  }
  return frontmatter;
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
    frontmatter = normalizeYamlValues(
      parsed as Record<string, unknown>,
      filename,
    );
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
 * Validate parsed frontmatter and build an AgentConfig with defaults applied.
 * Returns null if the agent should be skipped (e.g. missing required fields).
 */
export function validateConfig(
  frontmatter: Record<string, string>,
  body: string,
  filename: string,
): AgentConfig | null {
  const model = frontmatter.model?.trim();
  if (!model) {
    console.warn(
      `validateConfig: skipping ${filename} — missing "model" field`,
    );
    return null;
  }

  let mode = frontmatter.mode?.trim() as AgentConfig["mode"] | undefined;
  if (mode !== "clean" && mode !== "fork") {
    if (mode) {
      console.warn(
        `validateConfig: invalid mode "${mode}" in ${filename} — defaulting to "clean"`,
      );
    }
    mode = "clean";
  }

  const name = frontmatter.name?.trim() || basename(filename, ".md");
  const rawTools = frontmatter.tools?.trim();
  const tools = rawTools
    ? rawTools
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean)
    : [];

  return {
    name,
    description: frontmatter.description?.trim() ?? "",
    model,
    thinking: frontmatter.thinking?.trim() ?? "",
    tools,
    mode,
    sandbox: frontmatter.sandbox === "true",
    noSession: frontmatter["no-session"] !== "false",
    body: body.trim(),
  };
}

/**
 * Resolve a model tier alias (e.g. "cheap") to its provider/model string.
 * Direct provider/model strings pass through unchanged.
 * No recursive resolution — a tier value that is itself an alias stays as-is.
 */
export function resolveModel(
  raw: string,
  tiers: Record<string, string>,
): string {
  return tiers[raw] ?? raw;
}

/**
 * Discover agent .md files from user and project directories.
 * Project agents override user agents with the same name.
 *
 * @param cwd     Working directory (project root) — used to find `.pi/agents/`
 * @param userDir Override the user agent directory (for testing).
 *                Defaults to `getAgentDir()` from pi-coding-agent.
 * @returns Map of agent name (filename stem) → absolute file path.
 */
export function discoverAgentFiles(
  cwd: string,
  userDir?: string,
): Map<string, string> {
  const agents = new Map<string, string>();

  // User-level agents (loaded first, overridden by project)
  const userAgentDir = userDir ?? join(getAgentDir(), "agents");
  collectAgentFiles(userAgentDir, agents);

  // Project-level agents (override user agents with same name)
  const projectAgentDir = join(cwd, ".pi", "agents");
  collectAgentFiles(projectAgentDir, agents);

  return agents;
}

function collectAgentFiles(dir: string, agents: Map<string, string>): void {
  let entries: Iterable<{ name: string }>;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    // Directory doesn't exist or is inaccessible — skip
    return;
  }

  for (const entry of entries) {
    if (!entry.name.endsWith(".md")) {
      continue;
    }
    const stem = basename(entry.name, ".md");
    agents.set(stem, join(dir, entry.name));
  }
}

/**
 * Discover and parse all agent definition files.
 * Scans user-level (~/.pi/agent/agents/) and project-level (.pi/agents/) directories.
 * Project agents override user agents with the same name.
 *
 * @param cwd     Working directory (project root)
 * @param userDir Override the user agent directory (for testing)
 */
export function discoverAgents(cwd: string, userDir?: string): AgentConfig[] {
  const config = loadSubagentConfig(cwd);
  const files = discoverAgentFiles(cwd, userDir);

  // Use Map keyed by resolved AgentConfig.name for deduplication.
  // Project agents already override user agents by stem (from discoverAgentFiles),
  // but the name frontmatter field may differ from filename stem.
  const seen = new Map<string, AgentConfig>();

  for (const [_stem, path] of files) {
    let content: string;
    try {
      content = readFileSync(path, "utf-8");
    } catch {
      console.warn(`discoverAgents: could not read ${path} — skipping`);
      continue;
    }

    const { frontmatter, body } = parseFrontmatter(content, path);
    if (!frontmatter) {
      continue;
    }

    const agentConfig = validateConfig(frontmatter, body, path);
    if (!agentConfig) {
      continue;
    }

    agentConfig.model = resolveModel(agentConfig.model, config.tiers);

    const existing = seen.get(agentConfig.name);
    if (existing) {
      console.warn(
        `discoverAgents: duplicate agent name "${agentConfig.name}" — ${path} overrides earlier definition`,
      );
    }
    seen.set(agentConfig.name, agentConfig);
  }

  const agents = [...seen.values()];
  agents.sort((a, b) => a.name.localeCompare(b.name));
  return agents;
}
