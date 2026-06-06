import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { delimiter, isAbsolute, join, resolve } from "node:path";
import type { AgentToolResult } from "@earendil-works/pi-coding-agent";
import { assertSuccessOrThrow } from "./format.js";
import { run } from "./subprocess.js";
import { EvalBinaryNotFoundError, type EvalDetails } from "./types.js";

export async function resolvePythonBinary(
  pythonPath: string | undefined,
  cwd: string,
): Promise<string> {
  if (pythonPath) {
    // Explicit path: resolve relative to cwd, then validate
    const resolved = isAbsolute(pythonPath)
      ? pythonPath
      : resolve(cwd, pythonPath);
    try {
      await access(resolved, constants.X_OK);
    } catch {
      throw new EvalBinaryNotFoundError(resolved);
    }
    return resolved;
  }

  // Default: search PATH for python3
  const pathDirs = (process.env.PATH || "").split(delimiter);
  const candidates = [
    ...pathDirs.map((dir) => join(dir, "python3")),
    "/usr/bin/python3",
    "/usr/local/bin/python3",
  ];

  for (const candidate of candidates) {
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      // try next
    }
  }

  throw new EvalBinaryNotFoundError("python3");
}

export async function executePython(
  code: string,
  pythonPath: string | undefined,
  userSignal: AbortSignal | undefined,
  timeoutSignal: AbortSignal,
  cwd: string,
): Promise<AgentToolResult<EvalDetails>> {
  const bin = await resolvePythonBinary(pythonPath, cwd);
  const result = await run(
    bin,
    ["-c", code],
    cwd,
    {},
    userSignal,
    timeoutSignal,
  );
  return assertSuccessOrThrow("python", result);
}
