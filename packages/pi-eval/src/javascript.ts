import { randomUUID } from "node:crypto";
import { rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import type { AgentToolResult } from "@earendil-works/pi-coding-agent";
import { assertSuccessOrThrow } from "./format.js";
import { run } from "./subprocess.js";
import type { EvalDetails } from "./types.js";

export async function executeJavaScript(
  code: string,
  nodeModulesPath: string | undefined,
  userSignal: AbortSignal | undefined,
  timeoutSignal: AbortSignal,
  cwd: string,
): Promise<AgentToolResult<EvalDetails>> {
  const tmpFile = join(tmpdir(), `pi-eval-${randomUUID()}.js`);

  try {
    await writeFile(tmpFile, code, "utf-8");

    const env: NodeJS.ProcessEnv = { ...process.env };
    if (nodeModulesPath) {
      env.NODE_PATH = isAbsolute(nodeModulesPath)
        ? nodeModulesPath
        : resolve(cwd, nodeModulesPath);
    }

    const result = await run(
      "node",
      [tmpFile],
      cwd,
      env,
      userSignal,
      timeoutSignal,
    );
    return assertSuccessOrThrow("javascript", result);
  } finally {
    // await ensures cleanup completes before result/error propagates
    await rm(tmpFile, { force: true });
  }
}
