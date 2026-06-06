/**
 * Smoke tests for pi-eval extension.
 *
 * Exercises the eval tool through its execute() method using real
 * node/python3 subprocesses. No LLM required — these are fast
 * integration tests that verify end-to-end behavior.
 *
 * Run:
 *   npx vitest run packages/pi-eval/evals/smoke.test.ts
 */

import { readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentToolResult } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { createEvalTool } from "../src/eval.js";

const tool = createEvalTool();
const cwd = process.cwd();

function text(result: AgentToolResult<unknown>): string {
  return result.content
    .filter((c): c is { type: "text"; text: string } => c.type === "text")
    .map((c) => c.text)
    .join("\n");
}

async function hasPython3(): Promise<boolean> {
  try {
    const { execFile } = await import("node:child_process");
    await new Promise<void>((resolvePromise, reject) => {
      execFile("python3", ["--version"], (error) => {
        if (error) reject(error);
        else resolvePromise();
      });
    });
    return true;
  } catch {
    return false;
  }
}

// ── Tool definition shape ─────────────────────────────────────
describe("smoke: tool definition", () => {
  it('is registered with name "eval"', () => {
    expect(tool.name).toBe("eval");
  });

  it("accepts language, code, pythonPath, nodeModulesPath", () => {
    const props = tool.parameters.properties;
    expect(props.language).toBeDefined();
    expect(props.code).toBeDefined();
    expect(props.pythonPath).toBeDefined();
    expect(props.nodeModulesPath).toBeDefined();
  });

  it("has a non-empty description and promptSnippet", () => {
    expect(tool.description.length).toBeGreaterThan(50);
    expect(tool.promptSnippet.length).toBeGreaterThan(10);
  });
});

// ── JavaScript execution ──────────────────────────────────────
describe("smoke: JavaScript execution", () => {
  it('console.log("hello world") returns STDOUT with greeting', async () => {
    const r = await tool.execute(
      "js1",
      { language: "javascript", code: 'console.log("hello world");' },
      undefined,
      undefined,
      { cwd } as any,
    );
    expect(text(r)).toContain("STDOUT:\nhello world");
  });

  it("throw produces STDERR with stack trace and rejects", async () => {
    await expect(
      tool.execute(
        "js2",
        { language: "javascript", code: 'throw new Error("boom");' },
        undefined,
        undefined,
        { cwd } as any,
      ),
    ).rejects.toThrow();
  });

  it("process.exit(0) resolves with exitCode 0", async () => {
    const r = await tool.execute(
      "js3",
      { language: "javascript", code: "process.exit(0);" },
      undefined,
      undefined,
      { cwd } as any,
    );
    expect(r.details.exitCode).toBe(0);
  });

  it("process.exit(1) rejects with non-zero exit", async () => {
    await expect(
      tool.execute(
        "js4",
        { language: "javascript", code: "process.exit(1);" },
        undefined,
        undefined,
        { cwd } as any,
      ),
    ).rejects.toThrow();
  });

  it("JSON.stringify produces valid JSON in STDOUT", async () => {
    const r = await tool.execute(
      "js5",
      {
        language: "javascript",
        code: "console.log(JSON.stringify({ a: 1, b: [2, 3] }));",
      },
      undefined,
      undefined,
      { cwd } as any,
    );
    const t = text(r);
    expect(t).toContain('{"a":1,"b":[2,3]}');
  });

  it("both stdout and stderr are labelled separately", async () => {
    const r = await tool.execute(
      "js6",
      {
        language: "javascript",
        code: 'console.log("out"); console.error("err");',
      },
      undefined,
      undefined,
      { cwd } as any,
    );
    const t = text(r);
    expect(t).toContain("STDOUT:\nout");
    expect(t).toContain("STDERR:\nerr");
  });

  it("empty code prints (no output)", async () => {
    const r = await tool.execute(
      "js7",
      { language: "javascript", code: "" },
      undefined,
      undefined,
      { cwd } as any,
    );
    expect(text(r)).toContain("(no output)");
  });

  it("temp file is cleaned up after execution", async () => {
    const before = (await readdir(tmpdir())).filter((f) =>
      f.startsWith("pi-eval-"),
    ).length;

    await tool.execute(
      "js8",
      { language: "javascript", code: 'console.log("cleanup");' },
      undefined,
      undefined,
      { cwd } as any,
    );

    // Small delay to let rm resolve
    await new Promise((r) => setTimeout(r, 100));

    const after = (await readdir(tmpdir())).filter((f) =>
      f.startsWith("pi-eval-"),
    ).length;

    expect(after).toBeLessThanOrEqual(before);
  });

  it("temp file is cleaned up even on error", async () => {
    const before = (await readdir(tmpdir())).filter((f) =>
      f.startsWith("pi-eval-"),
    ).length;

    try {
      await tool.execute(
        "js9",
        { language: "javascript", code: 'throw new Error("cleanup fail");' },
        undefined,
        undefined,
        { cwd } as any,
      );
    } catch {
      // expected
    }

    await new Promise((r) => setTimeout(r, 100));

    const after = (await readdir(tmpdir())).filter((f) =>
      f.startsWith("pi-eval-"),
    ).length;

    expect(after).toBeLessThanOrEqual(before);
  });
});

// ── Python execution ──────────────────────────────────────────
describe("smoke: Python execution", () => {
  it('print("hello world") returns STDOUT with greeting', async () => {
    if (!(await hasPython3())) return;
    const r = await tool.execute(
      "py1",
      { language: "python", code: 'print("hello world")' },
      undefined,
      undefined,
      { cwd } as any,
    );
    expect(text(r)).toContain("STDOUT:\nhello world");
  });

  it("1/0 throws ZeroDivisionError", async () => {
    if (!(await hasPython3())) return;
    await expect(
      tool.execute(
        "py2",
        { language: "python", code: "1/0" },
        undefined,
        undefined,
        { cwd } as any,
      ),
    ).rejects.toThrow(/STDERR:\n.*ZeroDivisionError/s);
  });

  it("multiline code works (for loop)", async () => {
    if (!(await hasPython3())) return;
    const r = await tool.execute(
      "py3",
      {
        language: "python",
        code: "for i in range(3):\n  print(i)",
      },
      undefined,
      undefined,
      { cwd } as any,
    );
    expect(text(r)).toContain("STDOUT:\n0\n1\n2");
  });

  it("sys.exit(1) rejects with non-zero exit", async () => {
    if (!(await hasPython3())) return;
    await expect(
      tool.execute(
        "py4",
        { language: "python", code: "import sys; sys.exit(1)" },
        undefined,
        undefined,
        { cwd } as any,
      ),
    ).rejects.toThrow();
  });

  it("sys.exit(0) resolves with exitCode 0", async () => {
    if (!(await hasPython3())) return;
    const r = await tool.execute(
      "py5",
      { language: "python", code: "import sys; sys.exit(0)" },
      undefined,
      undefined,
      { cwd } as any,
    );
    expect(r.details.exitCode).toBe(0);
  });

  it("stderr is labelled separately from stdout", async () => {
    if (!(await hasPython3())) return;
    const r = await tool.execute(
      "py6",
      {
        language: "python",
        code: "import sys; print('out'); print('err', file=sys.stderr)",
      },
      undefined,
      undefined,
      { cwd } as any,
    );
    const t = text(r);
    expect(t).toContain("STDOUT:\nout");
    expect(t).toContain("STDERR:\nerr");
  });

  it("empty code returns (no output)", async () => {
    if (!(await hasPython3())) return;
    const r = await tool.execute(
      "py7",
      { language: "python", code: "" },
      undefined,
      undefined,
      { cwd } as any,
    );
    expect(text(r)).toContain("(no output)");
  });

  it("pythonPath: /nonexistent gives clear error", async () => {
    await expect(
      tool.execute(
        "py8",
        {
          language: "python",
          code: 'print("hi")',
          pythonPath: "/nonexistent/python3",
        },
        undefined,
        undefined,
        { cwd } as any,
      ),
    ).rejects.toThrow(/not found or not executable/);
  });

  it("pythonPath: relative venv path resolves correctly", async () => {
    if (!(await hasPython3())) return;
    const { access } = await import("node:fs/promises");
    let hasVenv = false;
    try {
      await access(`${cwd}/.venv/bin/python3`, 1);
      hasVenv = true;
    } catch {
      // no venv
    }
    if (!hasVenv) return;

    const r = await tool.execute(
      "py9",
      {
        language: "python",
        code: "import sys; print(sys.executable)",
        pythonPath: ".venv/bin/python3",
      },
      undefined,
      undefined,
      { cwd } as any,
    );
    expect(text(r)).toContain(".venv/bin/python3");
  });
});

// ── Safety boundaries ─────────────────────────────────────────
describe("smoke: safety boundaries", () => {
  it("already-aborted signal throws immediately without spawning", async () => {
    const ac = new AbortController();
    ac.abort();
    await expect(
      tool.execute(
        "safe1",
        { language: "javascript", code: 'console.log("never runs");' },
        ac.signal,
        undefined,
        { cwd } as any,
      ),
    ).rejects.toThrow(/cancelled/i);
  });

  it("infinite loop is killed by 30s timeout", async () => {
    await expect(
      tool.execute(
        "safe2",
        { language: "javascript", code: "while(true){}" },
        undefined,
        undefined,
        { cwd } as any,
      ),
    ).rejects.toThrow(/timed out|cancelled/i);
  }, 60_000);

  it("infinite Python loop is killed by 30s timeout", async () => {
    if (!(await hasPython3())) return;
    await expect(
      tool.execute(
        "safe3",
        { language: "python", code: "while True: pass" },
        undefined,
        undefined,
        { cwd } as any,
      ),
    ).rejects.toThrow(/timed out|cancelled/i);
  }, 60_000);

  it("large JS output is truncated at 1 MB", async () => {
    const r = await tool.execute(
      "safe4",
      {
        language: "javascript",
        code: `const s = "x".repeat(2.1 * 1024 * 1024); process.stdout.write(s);`,
      },
      undefined,
      undefined,
      { cwd } as any,
    );
    const t = text(r);
    expect(t).toContain("[Output truncated at 1 MB]");
    expect(t.length).toBeLessThan(1.5 * 1024 * 1024);
  }, 30_000);

  it("large Python output is truncated at 1 MB", async () => {
    if (!(await hasPython3())) return;
    const r = await tool.execute(
      "safe5",
      {
        language: "python",
        code: `import sys; sys.stdout.write("x" * (2 * 1024 * 1024 + 100_000))`,
      },
      undefined,
      undefined,
      { cwd } as any,
    );
    const t = text(r);
    expect(t).toContain("[Output truncated at 1 MB]");
    expect(t.length).toBeLessThan(1.5 * 1024 * 1024);
  }, 30_000);

  it("small output is NOT truncated", async () => {
    const r = await tool.execute(
      "safe6",
      { language: "javascript", code: 'console.log("short");' },
      undefined,
      undefined,
      { cwd } as any,
    );
    expect(text(r)).not.toContain("[Output truncated at 1 MB]");
  });
});

// ── nodeModulesPath ───────────────────────────────────────────
describe("smoke: nodeModulesPath", () => {
  it("require() fails without nodeModulesPath for non-core module", async () => {
    await expect(
      tool.execute(
        "nmp1",
        { language: "javascript", code: "require('nonexistent-pkg-xyz');" },
        undefined,
        undefined,
        { cwd } as any,
      ),
    ).rejects.toThrow();
  });

  it("require() resolves from nodeModulesPath when set", async () => {
    // Check if we have a local node_modules to test against
    const { access } = await import("node:fs/promises");
    let hasModules = false;
    try {
      await access(`${cwd}/node_modules/typebox`, 1);
      hasModules = true;
    } catch {
      // no local node_modules
    }
    if (!hasModules) return;

    const r = await tool.execute(
      "nmp2",
      {
        language: "javascript",
        nodeModulesPath: "./node_modules",
        code: `const pkg = require('typebox/package.json'); console.log(pkg.name);`,
      },
      undefined,
      undefined,
      { cwd } as any,
    );
    expect(text(r)).toContain("typebox");
  });
});
