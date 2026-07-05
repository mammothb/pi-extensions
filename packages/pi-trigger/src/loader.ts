import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { getAgentDir, stripFrontmatter } from "@earendil-works/pi-coding-agent";
import { expandTilde } from "@mammothb/pi-shared";
import type { TriggerDefinition } from "./types.js";

const SKILL_MD = "SKILL.md";

/**
 * Resolve npm: and git: package specs from the agent settings.json
 * to filesystem roots so we can discover prompts/ and skills/
 * subdirectories inside installed packages.
 */
function packageRootFromSource(source: string): string | undefined {
  if (source.startsWith("/") || source.startsWith("~/")) {
    return expandTilde(source);
  }
  if (source.startsWith("npm:")) {
    const name = source.slice(4);
    return join(getAgentDir(), "npm/node_modules", name);
  }
  if (!source.startsWith("git:")) {
    return undefined;
  }
  let spec = source.slice(4).replace(/\.git$/, "");
  spec = spec.replace(/^https?:\/\/github\.com\//, "github.com/");
  if (!spec.startsWith("github.com/")) {
    return undefined;
  }
  return join(getAgentDir(), "git", spec);
}

/** Read ~/.pi/agent/settings.json and resolve all package roots. */
function activePackageRoots(): string[] {
  try {
    const settings = JSON.parse(
      readFileSync(join(getAgentDir(), "settings.json"), "utf-8"),
    ) as { packages?: unknown[] };
    const roots: string[] = [];
    for (const entry of settings.packages ?? []) {
      const source =
        typeof entry === "string"
          ? entry
          : entry && typeof entry === "object"
            ? (entry as { source?: unknown }).source
            : undefined;
      if (typeof source !== "string") {
        continue;
      }
      const root = packageRootFromSource(source);
      if (root) {
        roots.push(root);
      }
    }
    return roots;
  } catch {
    return [];
  }
}

/**
 * Recursively scan directories for SKILL.md files.
 * Returns skill definitions keyed by skill name.
 */
export function loadSkills(roots: string[]): Map<string, TriggerDefinition> {
  const skills = new Map<string, TriggerDefinition>();

  function visit(dir: string) {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }

    if (entries.includes(SKILL_MD)) {
      const skillPath = join(dir, SKILL_MD);
      const skillName = dir.split(/[\\/]/).pop() || dir;
      try {
        const raw = readFileSync(skillPath, "utf-8");
        const body = stripFrontmatter(raw).trim();
        skills.set(skillName, {
          namespace: "skill",
          name: skillName,
          content: body,
          filePath: skillPath,
          baseDir: dir,
        });
      } catch {
        // skip unreadable
      }
      return;
    }

    for (const entry of entries) {
      if (entry.startsWith(".") || entry === "node_modules") {
        continue;
      }
      const full = join(dir, entry);
      try {
        if (statSync(full).isDirectory()) {
          visit(full);
        }
      } catch {
        // skip inaccessible
      }
    }
  }

  for (const root of roots) {
    visit(root);
  }
  return skills;
}

/**
 * Scan a single directory (non-recursive) for .md prompt template files.
 * Returns prompt definitions keyed by template name (filename minus .md).
 */
export function loadPromptsFromDir(
  dir: string,
): Map<string, TriggerDefinition> {
  const prompts = new Map<string, TriggerDefinition>();

  if (!existsSync(dir)) {
    return prompts;
  }

  try {
    for (const entry of readdirSync(dir)) {
      if (!entry.endsWith(".md")) {
        continue;
      }
      const filePath = join(dir, entry);
      try {
        if (!statSync(filePath).isFile()) {
          continue;
        }
      } catch {
        continue;
      }
      const name = entry.replace(/\.md$/, "");
      try {
        const raw = readFileSync(filePath, "utf-8");
        const body = stripFrontmatter(raw).trim();
        prompts.set(name, {
          namespace: "prompt",
          name,
          content: body,
          filePath,
          baseDir: dir,
        });
      } catch {
        // skip unreadable
      }
    }
  } catch {
    // skip inaccessible dir
  }

  return prompts;
}

/** Build the full set of roots for skill and prompt discovery. */
export function buildDefaultRoots(cwd: string): {
  skillRoots: string[];
  promptDirs: string[];
} {
  const resolvedCwd = resolve(cwd);

  const skillRoots = [
    join(getAgentDir(), "skills"),
    expandTilde("~/.agents/skills"),
    resolve(resolvedCwd, ".pi/skills"),
  ];

  const promptDirs = [
    join(getAgentDir(), "prompts"),
    resolve(resolvedCwd, ".pi/prompts"),
  ];

  // Add package roots: scan <pkg>/prompts/ and <pkg>/skills/ for each
  // installed package.
  for (const root of activePackageRoots()) {
    skillRoots.push(root); // recursive scan catches SKILL.md anywhere
    promptDirs.push(join(root, "prompts"));
  }

  return { skillRoots, promptDirs };
}
