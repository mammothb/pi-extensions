import { existsSync } from "node:fs";
import { basename } from "node:path";

/**
 * Determine how to invoke the `pi` binary.
 *
 * Priority:
 * - If the current script path exists on disk, use it (development mode).
 * - If the current runtime is not a generic node/bun binary, use it directly.
 * - Otherwise, fall back to `pi` on PATH.
 */
export function getPiInvocation(args: string[]): {
  command: string;
  args: string[];
} {
  const currentScript = process.argv[1];
  const isBunVirtualScript = currentScript?.startsWith("/$bunfs/root/");

  if (currentScript && !isBunVirtualScript && existsSync(currentScript)) {
    return { command: process.execPath, args: [currentScript, ...args] };
  }

  const execName = basename(process.execPath).toLowerCase();
  const isGenericRuntime = /^(node|bun)(\.exe)?$/.test(execName);
  if (!isGenericRuntime) {
    return { command: process.execPath, args };
  }

  return { command: "pi", args };
}
