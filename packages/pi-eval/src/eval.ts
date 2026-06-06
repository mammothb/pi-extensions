import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { access, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, isAbsolute, join, resolve } from "node:path";
import type {
  AgentToolResult,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const TIMEOUT_MS = 30_000;
const CONSTANTS = { X_OK: 1 };

const MAX_OUTPUT = 1024 * 1024; // 1 MB

function formatOutput(
  stdout: string,
  stderr: string,
  truncated?: boolean,
): string {
  const parts: string[] = [];
  parts.push(`STDOUT:\n${stdout || "(no output)"}`);
  if (stderr) {
    parts.push(`STDERR:\n${stderr}`);
  }
  if (truncated) {
    parts.push("[Output truncated at 1 MB]");
  }
  return parts.join("\n\n");
}

interface EvalDetails {
  language: string;
  exitCode: number;
}

const Parameters = Type.Object({
  language: Type.String({
    description: 'Programming language: "javascript" or "python".',
  }),
  code: Type.String({ description: "Code to execute" }),
  pythonPath: Type.Optional(
    Type.String({
      description:
        "Path to python3 binary (e.g., '.venv/bin/python3' for venvs). " +
        "Defaults to 'python3'.",
    }),
  ),
  nodeModulesPath: Type.Optional(
    Type.String({
      description:
        "Path to a node_modules directory. When set, NODE_PATH is passed " +
        "to the subprocess so require() resolves from this directory. " +
        "Use './node_modules' for project-local packages.",
    }),
  ),
});

async function resolvePythonBinary(
  pythonPath: string | undefined,
  cwd: string,
): Promise<string> {
  if (pythonPath) {
    // Explicit path: resolve relative to cwd, then validate
    const resolved = isAbsolute(pythonPath)
      ? pythonPath
      : resolve(cwd, pythonPath);
    try {
      await access(resolved, CONSTANTS.X_OK);
    } catch {
      throw new Error(`Python binary not found or not executable: ${resolved}`);
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
      await access(candidate, CONSTANTS.X_OK);
      return candidate;
    } catch {
      // try next
    }
  }

  throw new Error(
    "python3 not found. Install Python 3 or set pythonPath to a venv binary.",
  );
}

export function createEvalTool(): ToolDefinition<
  typeof Parameters,
  EvalDetails
> {
  return {
    name: "eval",
    label: "Eval",
    description: `Execute JavaScript or Python code in an isolated subprocess.

- Each call is a fresh subprocess — no state persists between calls
- 30-second timeout; press Escape to cancel a running evaluation
- Working directory is the agent's current working directory (like bash)
- Use nodeModulesPath to resolve require() from a project directory
- Use pythonPath to target a virtual environment`,
    promptSnippet:
      "Execute JavaScript or Python code in an isolated subprocess",
    parameters: Parameters,
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const { language, code, pythonPath, nodeModulesPath } = params;

      if (signal?.aborted) {
        throw new Error("Evaluation cancelled.");
      }

      // Build abort signal: user-provided signal + 30s timeout
      const timeoutSignal = AbortSignal.timeout(TIMEOUT_MS);
      const combinedSignal = signal
        ? AbortSignal.any([signal, timeoutSignal])
        : timeoutSignal;

      if (combinedSignal.aborted) {
        throw new Error("Evaluation cancelled.");
      }

      if (language === "python") {
        return executePython(code, pythonPath, combinedSignal, ctx.cwd);
      }

      // ── JavaScript execution via temp file + node subprocess ──
      return executeJavaScript(code, nodeModulesPath, combinedSignal, ctx.cwd);
    },
  };
}

async function executePython(
  code: string,
  pythonPath: string | undefined,
  signal: AbortSignal,
  cwd: string,
): Promise<AgentToolResult<EvalDetails>> {
  const bin = await resolvePythonBinary(pythonPath, cwd);

  const { stdout, stderr, exitCode, truncated } = await runSubprocess(
    bin,
    ["-c", code],
    cwd,
    {},
    signal,
  );

  const output = formatOutput(stdout, stderr, truncated);

  if (exitCode !== 0) {
    throw new Error(output);
  }

  return {
    content: [{ type: "text" as const, text: output }],
    details: { language: "python", exitCode },
  };
}

async function executeJavaScript(
  code: string,
  nodeModulesPath: string | undefined,
  signal: AbortSignal,
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

    const { stdout, stderr, exitCode, truncated } = await runSubprocess(
      "node",
      [tmpFile],
      cwd,
      env,
      signal,
    );

    const output = formatOutput(stdout, stderr, truncated);

    if (exitCode !== 0) {
      throw new Error(output);
    }

    return {
      content: [{ type: "text" as const, text: output }],
      details: { language: "javascript", exitCode },
    };
  } finally {
    await rm(tmpFile, { force: true });
  }
}

function runSubprocess(
  file: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
  signal: AbortSignal,
): Promise<{
  stdout: string;
  stderr: string;
  exitCode: number;
  truncated: boolean;
}> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(file, args, {
      cwd,
      env,
      signal,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let truncated = false;

    const onData = (target: "stdout" | "stderr") => (chunk: Buffer) => {
      const used = stdout.length + stderr.length;
      const remaining = MAX_OUTPUT - used;
      if (remaining <= 0) {
        truncated = true;
        child.kill();
        return;
      }
      const text = chunk.toString(
        "utf-8",
        0,
        Math.min(chunk.length, remaining),
      );
      if (target === "stdout") {
        stdout += text;
      } else {
        stderr += text;
      }
    };

    child.stdout.on("data", onData("stdout"));
    child.stderr.on("data", onData("stderr"));

    let settled = false;

    child.on("close", (exitCode, exitSignal) => {
      if (settled) return;
      // Truncation kill (we killed it) — resolve with partial output
      if (truncated) {
        settled = true;
        resolvePromise({
          stdout,
          stderr,
          exitCode: exitCode ?? 0,
          truncated,
        });
        return;
      }
      // Signal kill (timeout or user cancel)
      if (exitSignal != null || signal.aborted) {
        settled = true;
        reject(new Error("Evaluation cancelled or timed out after 30 seconds"));
        return;
      }
      settled = true;
      resolvePromise({
        stdout,
        stderr,
        exitCode: exitCode ?? 0,
        truncated,
      });
    });

    child.on("error", (err) => {
      if (settled) return;
      // Abort signal manifests as a spawn error in Node
      if (signal.aborted) {
        settled = true;
        reject(new Error("Evaluation cancelled or timed out after 30 seconds"));
        return;
      }
      settled = true;
      reject(new Error(`Failed to spawn ${file}: ${err.message}`));
    });
  });
}
