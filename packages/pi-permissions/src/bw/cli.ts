#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { readConfigFile } from "@mammothb/pi-shared";
import { buildBwrapArgs } from "./binds.js";
import { loadConfig, validatePaths } from "./config.js";
import type { BwRawConfig } from "./types.js";

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

export function main(): void {
  const args = process.argv.slice(2);

  // Help / version (check before flag parsing so they work anywhere)
  if (args.includes("--help") || args.includes("-h")) {
    printHelp();
    process.exit(0);
  }
  if (args.includes("--version") || args.includes("-v")) {
    console.log("bw (pi-permissions)");
    process.exit(0);
  }

  // Parse flags: --config, --validate, --print-args, -- <command...>
  let cwd = process.cwd();
  let validate = false;
  let printArgs = false;
  let command: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--config" && i + 1 < args.length) {
      const configPath = args[i + 1];
      if (configPath) {
        cwd = realpathSync(configPath);
        i++;
      }
    } else if (arg === "--validate") {
      validate = true;
    } else if (arg === "--print-args") {
      printArgs = true;
    } else if (arg === "--") {
      command = args.slice(i + 1);
      break;
    } else if (arg && !arg.startsWith("-")) {
      command = args.slice(i);
      break;
    }
  }

  // Mutual exclusion
  if (validate && printArgs) {
    console.error("bw: --validate and --print-args are mutually exclusive");
    process.exit(1);
  }

  // Load config and validate paths
  const config = loadConfig(cwd);
  const errors = collectErrors(cwd);

  if (errors.length > 0) {
    for (const msg of errors) {
      console.error(`bw: ${msg}`);
    }
    if (validate) {
      console.error(`bw: config invalid — ${errors.length} error(s)`);
    }
    process.exit(1);
  }

  // --validate: exit clean (errors would have been caught above)
  if (validate) {
    process.exit(0);
  }

  // If no command, default to shell
  if (command.length === 0) {
    command = [process.env.SHELL ?? "/bin/bash"];
  }

  // Build bwrap args
  const bwrapArgs = buildBwrapArgs(config, cwd, command);

  // --print-args: print and exit (don't spawn bwrap)
  if (printArgs) {
    printBwrapArgs(bwrapArgs);
    process.exit(0);
  }

  // Normal execution: spawn bwrap
  const result = spawnSync("bwrap", bwrapArgs.slice(1), {
    stdio: "inherit",
    cwd,
  });

  if (result.error) {
    console.error(`bw: failed to spawn bwrap: ${result.error.message}`);
    process.exit(1);
  }

  process.exit(result.status ?? 1);
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

export function collectErrors(cwd: string): string[] {
  const globalPath = join(
    process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"),
    "bw",
    "config.json",
  );
  const workspacePath = join(cwd, ".pi", "bw.json");

  const allErrors: string[] = [];

  if (existsSync(globalPath)) {
    const globalRaw = readConfigFile(globalPath, "bw") as BwRawConfig | null;
    if (globalRaw) {
      allErrors.push(
        ...validatePaths(globalRaw, cwd, "global").map(
          (e) =>
            `path not found: ${e.path} (in ~/.config/bw/config.json, binds.${e.kind}[${e.index}])`,
        ),
      );
    }
  }

  if (existsSync(workspacePath)) {
    const workspaceRaw = readConfigFile(
      workspacePath,
      "bw",
    ) as BwRawConfig | null;
    if (workspaceRaw) {
      allErrors.push(
        ...validatePaths(workspaceRaw, cwd, "workspace").map(
          (e) =>
            `path not found: ${e.path} (in .pi/bw.json, binds.${e.kind}[${e.index}])`,
        ),
      );
    }
  }

  return allErrors;
}

// ---------------------------------------------------------------------------
// Output helpers
// ---------------------------------------------------------------------------

export function printBwrapArgs(args: string[]): void {
  // Print one arg per line with \ continuation for readability
  for (let i = 0; i < args.length; i++) {
    if (i === 0) {
      // "bwrap"
      console.log(args[i]);
    } else if (i === args.length - 1) {
      console.log(`  ${args[i]}`);
    } else if (args[i] === "--") {
      console.log("  --");
    } else if (args[i]?.startsWith("--")) {
      // Flag + value pairs: print on one line, skip next iteration
      if (
        i + 1 < args.length &&
        args[i + 1] &&
        !args[i + 1]?.startsWith("--")
      ) {
        console.log(`  ${args[i]} ${args[i + 1]} \\`);
        i++;
      } else {
        console.log(`  ${args[i]} \\`);
      }
    } else {
      console.log(`  ${args[i]} \\`);
    }
  }
}

// ---------------------------------------------------------------------------
// Help
// ---------------------------------------------------------------------------

const HELP = `bw — bwrap sandbox for pi

Usage:
  bw [--config <path>] [--validate | --print-args] [--] <command...>

If no command is given, launches $SHELL (or /bin/bash).

Flags:
  --validate       Load config and validate paths. Exit 0 if valid, 1 if errors.
                   Does not spawn bwrap.
  --print-args     Print the bwrap command that would be executed. Does not
                   spawn bwrap. Useful for debugging bind-mount issues.

Config files (merged: default ← global ← workspace):
  Default        compiled into package
  Global         ~/.config/bw/config.json
  Workspace      .pi/bw.json

  Use "binds_extra" to add paths (merges with defaults).
  Use "binds" to fully replace the bind list.

Config example (~/.config/bw/config.json):
  {
    "binds_extra": {
      "ro": ["~/other-project/docs"],
      "rw": ["~/scratch"]
    },
    "options": {
      "clearenv": true,
      "env": { "GITHUB_TOKEN": "$GITHUB_TOKEN" },
      "path": ["~/.cargo/bin"],
      "tmpfsSize": "512M",
      "unshareNet": false
    }
  }

Workspace config example (.pi/bw.json):
  {
    "binds_extra": {
      "ro": ["./fixtures", "/some/data/dir"],
      "rw": ["./output"]
    }
  }

Examples:
  bw pi                     # run pi in the sandbox
  bw --validate             # check config is valid
  bw --print-args -- pi     # see the bwrap command that would run
  bw -- bash -c "npm test"  # run a shell command
  bw --config ~/other-project -- pi
`;

function printHelp(): void {
  console.log(HELP);
}
