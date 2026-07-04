import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createBashTool } from "@earendil-works/pi-coding-agent";
import { loadConfig } from "./lib/config.js";

/**
 * If pi-eval has a custom pythonPath configured, override the bash tool
 * to inject the same venv into every bash command. This makes `python`
 * and `pip` in bash use the same environment as pi-eval.
 */
export function registerBashVenvHook(pi: ExtensionAPI): void {
  const config = loadConfig(process.cwd());

  if (!config.pythonPath) {
    return;
  }

  const venvBin = dirname(config.pythonPath);
  // Only set VIRTUAL_ENV if the parent directory contains pyvenv.cfg —
  // the definitive marker of a virtualenv. Avoids setting VIRTUAL_ENV=/usr
  // when pythonPath points to a system Python.
  const venvRoot = dirname(venvBin);
  const isVenv = existsSync(join(venvRoot, "pyvenv.cfg"));

  const bashTool = createBashTool(process.cwd(), {
    spawnHook: ({ command, cwd, env }) => ({
      command,
      cwd,
      env: {
        ...env,
        PATH: `${venvBin}:${env.PATH}`,
        ...(isVenv ? { VIRTUAL_ENV: venvRoot } : {}),
      },
    }),
  });

  pi.registerTool({
    ...bashTool,
    execute: (id, params, signal, onUpdate) =>
      bashTool.execute(id, params, signal, onUpdate),
  });
}
