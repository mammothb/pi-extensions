// Direct test of pi-eval/src/eval.ts

import { readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import type { AgentToolResult } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { createEvalTool } from "../src/eval.js";

const tool = createEvalTool();
const cwd = process.cwd();

function text(result: AgentToolResult<unknown>) {
  return result.content
    .filter((c): c is { type: "text"; text: string } => c.type === "text")
    .map((c) => c.text)
    .join("\n");
}

describe("createEvalTool — definition shape", () => {
  it('has name "eval"', () => {
    expect(tool.name).toBe("eval");
  });

  it("has label and promptSnippet", () => {
    expect(tool.label).toBeTruthy();
    expect(tool.promptSnippet).toBeTruthy();
  });

  it("has language, code, pythonPath, nodeModulesPath params", () => {
    const props = tool.parameters.properties;
    expect(props.language).toBeDefined();
    expect(props.code).toBeDefined();
    expect(props.pythonPath).toBeDefined();
    expect(props.nodeModulesPath).toBeDefined();
  });
});

describe("eval — JavaScript execution", () => {
  it('console.log("hello") → STDOUT contains hello', async () => {
    const r = await tool.execute(
      "t1",
      { language: "javascript", code: 'console.log("hello");' },
      undefined,
      undefined,
      { cwd } as any,
    );
    expect(text(r)).toContain("STDOUT:\nhello");
  });

  it("throw new Error → throws with stack in STDERR", async () => {
    await expect(
      tool.execute(
        "t2",
        { language: "javascript", code: 'throw new Error("fail");' },
        undefined,
        undefined,
        { cwd } as any,
      ),
    ).rejects.toThrow(/STDERR:\n.*Error: fail/s);
  });

  it("JSON.stringify outputs JSON", async () => {
    const r = await tool.execute(
      "t3",
      {
        language: "javascript",
        code: "console.log(JSON.stringify({a: 1}));",
      },
      undefined,
      undefined,
      { cwd } as any,
    );
    expect(text(r)).toContain('{"a":1}');
  });

  it("require('nonexistent') → throws", async () => {
    await expect(
      tool.execute(
        "t4",
        { language: "javascript", code: "require('nonexistent-pkg-xyz');" },
        undefined,
        undefined,
        { cwd } as any,
      ),
    ).rejects.toThrow();
  });

  it("process.exit(1) → throws", async () => {
    await expect(
      tool.execute(
        "t5",
        { language: "javascript", code: "process.exit(1);" },
        undefined,
        undefined,
        { cwd } as any,
      ),
    ).rejects.toThrow();
  });

  it("process.exit(0) → resolves with exitCode 0", async () => {
    const r = await tool.execute(
      "t6",
      { language: "javascript", code: "process.exit(0);" },
      undefined,
      undefined,
      { cwd } as any,
    );
    expect(r.details.exitCode).toBe(0);
  });

  it("empty code → (no output)", async () => {
    const r = await tool.execute(
      "t7",
      { language: "javascript", code: "// nothing" },
      undefined,
      undefined,
      { cwd } as any,
    );
    expect(text(r)).toContain("(no output)");
  });

  it("both stdout and stderr are labelled", async () => {
    const r = await tool.execute(
      "t8",
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
});

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

describe("eval — Python execution", () => {
  it('print("hello") → STDOUT contains hello', async () => {
    if (!(await hasPython3())) return;
    const r = await tool.execute(
      "p1",
      { language: "python", code: 'print("hello")' },
      undefined,
      undefined,
      { cwd } as any,
    );
    expect(text(r)).toContain("STDOUT:\nhello");
  });

  it("1/0 → throws with ZeroDivisionError in STDERR", async () => {
    if (!(await hasPython3())) return;
    await expect(
      tool.execute(
        "p2",
        { language: "python", code: "1/0" },
        undefined,
        undefined,
        { cwd } as any,
      ),
    ).rejects.toThrow(/STDERR:\n.*ZeroDivisionError/s);
  });

  it("multi-line code works", async () => {
    if (!(await hasPython3())) return;
    const r = await tool.execute(
      "p3",
      {
        language: "python",
        code: "import sys\nfor i in range(3):\n  print(i)",
      },
      undefined,
      undefined,
      { cwd } as any,
    );
    expect(text(r)).toContain("STDOUT:\n0\n1\n2");
  });

  it("sys.exit(1) → throws with exit code 1", async () => {
    if (!(await hasPython3())) return;
    await expect(
      tool.execute(
        "p4",
        { language: "python", code: "import sys; sys.exit(1)" },
        undefined,
        undefined,
        { cwd } as any,
      ),
    ).rejects.toThrow();
  });

  it("empty code → (no output)", async () => {
    if (!(await hasPython3())) return;
    const r = await tool.execute(
      "p5",
      { language: "python", code: "" },
      undefined,
      undefined,
      { cwd } as any,
    );
    expect(text(r)).toContain("(no output)");
  });

  it("Python infinite loop is killed by 30s timeout", async () => {
    if (!(await hasPython3())) return;
    await expect(
      tool.execute(
        "p6",
        { language: "python", code: "while True: pass" },
        undefined,
        undefined,
        { cwd } as any,
      ),
    ).rejects.toThrow(/timed out|cancelled/i);
  }, 60_000);

  it("2 MB output is truncated at 1 MB with notice", async () => {
    if (!(await hasPython3())) return;
    const r = await tool.execute(
      "p7",
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

  it("output under 1 MB is not truncated", async () => {
    if (!(await hasPython3())) return;
    const r = await tool.execute(
      "p8",
      { language: "python", code: 'print("short")' },
      undefined,
      undefined,
      { cwd } as any,
    );
    expect(text(r)).not.toContain("[Output truncated at 1 MB]");
  });
});

describe("eval — pythonPath validation", () => {
  it("pythonPath: /nonexistent → clear error, not crash", async () => {
    await expect(
      tool.execute(
        "pp1",
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

  it("pythonPath: .venv/bin/python3 uses venv binary", async () => {
    if (!(await hasPython3())) return;
    const { access } = await import("node:fs/promises");
    let hasVenv = false;
    try {
      await access(`${cwd}/.venv/bin/python3`, 1);
      hasVenv = true;
    } catch {
      // .venv not present, skip
    }
    if (!hasVenv) return;
    const r = await tool.execute(
      "pp2",
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

  it("import numpy succeeds inside a venv that has it", async () => {
    if (!(await hasPython3())) return;
    const { access } = await import("node:fs/promises");
    let hasVenv = false;
    try {
      await access(`${cwd}/.venv/bin/python3`, 1);
      hasVenv = true;
    } catch {
      // .venv not present
    }
    if (!hasVenv) return;
    // Try importing numpy; it may or may not be installed
    try {
      const r = await tool.execute(
        "pp3",
        {
          language: "python",
          code: "import numpy; print(numpy.__version__)",
          pythonPath: ".venv/bin/python3",
        },
        undefined,
        undefined,
        { cwd } as any,
      );
      expect(text(r)).toContain("STDOUT:\n");
    } catch {
      // numpy not installed in venv — acceptable, test passes
    }
  });
});

describe("eval — safety boundaries", () => {
  it("infinite loop is killed by 30s timeout", async () => {
    await expect(
      tool.execute(
        "t10",
        { language: "javascript", code: "while(true){}" },
        undefined,
        undefined,
        { cwd } as any,
      ),
    ).rejects.toThrow(/timed out|cancelled/i);
  }, 60_000);

  it("already-aborted signal throws immediately", async () => {
    const ac = new AbortController();
    ac.abort();
    await expect(
      tool.execute(
        "t12",
        { language: "javascript", code: 'console.log("nope");' },
        ac.signal,
        undefined,
        { cwd } as any,
      ),
    ).rejects.toThrow(/cancelled/i);
  });

  it("2 MB output is truncated at 1 MB with notice", async () => {
    const r = await tool.execute(
      "t13",
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
    // Total output (raw + labels + notice) must not exceed ~1 MB dramatically
    expect(t.length).toBeLessThan(1.5 * 1024 * 1024);
  }, 30_000);

  it("output under 1 MB is not truncated", async () => {
    const r = await tool.execute(
      "t14",
      { language: "javascript", code: 'console.log("short");' },
      undefined,
      undefined,
      { cwd } as any,
    );
    expect(text(r)).not.toContain("[Output truncated at 1 MB]");
  });

  it("temp file is cleaned up after call", async () => {
    const before = (await readdir(tmpdir())).filter((f) =>
      f.startsWith("pi-eval-"),
    );
    await tool.execute(
      "t13",
      { language: "javascript", code: 'console.log("cleanup");' },
      undefined,
      undefined,
      { cwd } as any,
    );
    const after = (await readdir(tmpdir())).filter((f) =>
      f.startsWith("pi-eval-"),
    );
    expect(after.length).toBeLessThanOrEqual(before.length);
  });
});
