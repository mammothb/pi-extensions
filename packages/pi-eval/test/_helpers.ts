import type {
  AgentToolResult,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";

/**
 * Extract concatenated text from an AgentToolResult.
 */
export function text(result: AgentToolResult<unknown>): string {
  return result.content
    .filter((c): c is { type: "text"; text: string } => c.type === "text")
    .map((c) => c.text)
    .join("\n");
}

/**
 * Create a minimal mock of ExtensionContext for tests.
 * Only populates `cwd` — other properties are not needed by the eval tool.
 */
export function mockContext(cwd: string): ExtensionContext {
  return { cwd } as ExtensionContext;
}

/**
 * Check whether python3 is available on the system PATH.
 * Use this to skip Python tests when python3 is not installed.
 */
export async function hasPython3(): Promise<boolean> {
  try {
    const { execFile } = await import("node:child_process");
    await new Promise<void>((resolvePromise, reject) => {
      execFile("python3", ["--version"], (error) => {
        if (error) {
          reject(error);
        } else {
          resolvePromise();
        }
      });
    });
    return true;
  } catch {
    return false;
  }
}
