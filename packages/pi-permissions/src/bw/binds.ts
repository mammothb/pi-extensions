import { existsSync } from "node:fs";
import { join } from "node:path";
import type { BwResolvedConfig } from "./types.js";

/**
 * Build the full bwrap argument array from a resolved config.
 *
 * @param config   Fully resolved and path-expanded config
 * @param cwd      Workspace root (bound rw and set as --chdir)
 * @param command  The command + args to run inside the sandbox
 */
export function buildBwrapArgs(
  config: BwResolvedConfig,
  cwd: string,
  command: string[],
): string[] {
  const args: string[] = ["bwrap"];

  // Hardcoded namespace / sandbox flags
  args.push(
    "--unshare-cgroup",
    "--unshare-ipc",
    "--unshare-pid",
    "--unshare-user",
    "--unshare-uts",
    "--die-with-parent",
    "--dev",
    "/dev",
    "--proc",
    "/proc",
    "--tmpfs",
    "/tmp",
  );

  // tmpfs size
  if (config.options.tmpfsSize) {
    args.push("--tmpfs", "/tmp");
    // bwrap doesn't have a --tmpfs-size flag; we use --tmpfs /tmp and rely
    // on kernel default. For a size limit we'd need --file-label or similar.
    // For now, tmpfs size is documented intent but not directly enforced
    // via bwrap args. The kernel's default tmpfs size is half of RAM.
    // We leave this as a future enhancement (requires --tmpfs with size arg
    // which is supported by newer bwrap or kernel mount options).
  }

  // Optional network isolation
  if (config.options.unshareNet) {
    args.push("--unshare-net");
  }

  // Optional seccomp
  if (config.options.seccomp) {
    args.push("--seccomp", "11", config.options.seccomp);
  }

  // --- Bind mounts ---

  // ro binds (required — fail if missing)
  for (const p of config.binds.ro) {
    args.push("--ro-bind", p, p);
  }

  // roTry binds (optional — skip if missing)
  for (const p of config.binds.roTry) {
    if (existsSync(p)) {
      args.push("--ro-bind-try", p, p);
    }
  }

  // rw binds (required)
  for (const p of config.binds.rw) {
    args.push("--bind", p, p);
  }

  // Docker socket
  if (config.binds.docker && existsSync(config.binds.docker)) {
    args.push("--bind", config.binds.docker, config.binds.docker);
  }

  // Workspace (always rw)
  args.push("--bind", cwd, cwd);
  args.push("--chdir", cwd);

  // --- Environment ---

  if (config.options.clearenv) {
    args.push("--clearenv");
  }

  // Essential env vars
  const env: Record<string, string> = {
    HOME: process.env.HOME ?? "",
    TERM: process.env.TERM ?? "screen-256color",
    USER: process.env.USER ?? "",
    PI_OFFLINE: process.env.PI_OFFLINE ?? "0",
  };

  // PATH: user-specified paths, node dir, then standard system dirs
  const nodeDir = findNodeDir();
  const pathParts = [
    ...config.options.path,
    process.env.HOME ? `${process.env.HOME}/.local/bin` : null,
    nodeDir,
    "/usr/local/sbin",
    "/usr/local/bin",
    "/usr/sbin",
    "/usr/bin",
    "/sbin",
    "/bin",
  ].filter(Boolean) as string[];
  env.PATH = pathParts.join(":");

  // Apply user env overrides
  Object.assign(env, config.options.env);

  // Resolve $VAR references in env values
  for (const [key, val] of Object.entries(env)) {
    const resolved = val.replace(/\$(\w+)/g, (_m, name) => {
      return process.env[name] ?? "";
    });
    args.push("--setenv", key, resolved);
  }

  // --- Command ---
  args.push("--");
  args.push(...command);

  return args;
}

function findNodeDir(): string | null {
  const path = process.env.PATH ?? "";
  for (const dir of path.split(":")) {
    if (existsSync(join(dir, "node")) || existsSync(join(dir, "node.exe"))) {
      return dir;
    }
  }
  return null;
}
