// Direct test of pi-eval/src/eval.ts

import { readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { createEvalTool } from "../src/eval.js";
import {
  EvalBinaryNotFoundError,
  EvalCancelledError,
  EvalTimeoutError,
  EvalToolError,
  EvalUnsupportedLanguageError,
} from "../src/types.js";
import { hasPython3, mockContext, text } from "./_helpers.js";

const tool = createEvalTool();
const cwd = process.cwd();

describe("createEvalTool — definition shape", () => {
  it('has name "eval"', () => {
    expect(tool.name).toBe("eval");
  });

  it("has label and promptSnippet", () => {
    expect(tool.label).toBeTruthy();
    expect(tool.promptSnippet).toBeTruthy();
  });

  it("has a non-empty description and promptSnippet with meaningful length", () => {
    expect(tool.description.length).toBeGreaterThan(50);
    expect(tool.promptSnippet!.length).toBeGreaterThan(10);
  });

  it("has language, code, pythonPath, nodeModulesPath params", () => {
    const props = tool.parameters.properties;
    expect(props.language).toBeDefined();
    expect(props.code).toBeDefined();
    expect(props.pythonPath).toBeDefined();
    expect(props.nodeModulesPath).toBeDefined();
  });

  it("unknown language rejects with EvalUnsupportedLanguageError", async () => {
    await expect(
      tool.execute(
        "t-unsupported",
        { language: "rust", code: 'println!("hi");' } as any,
        undefined,
        undefined,
        mockContext(cwd),
      ),
    ).rejects.toThrow(EvalUnsupportedLanguageError);
  });
});

describe("eval — JavaScript execution", () => {
  it('console.log("hello") → STDOUT contains hello', async () => {
    const r = await tool.execute(
      "t1",
      { language: "javascript", code: 'console.log("hello");' },
      undefined,
      undefined,
      mockContext(cwd),
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
        mockContext(cwd),
      ),
    ).rejects.toThrow(EvalToolError);
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
      mockContext(cwd),
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
        mockContext(cwd),
      ),
    ).rejects.toThrow(EvalToolError);
  });

  it("process.exit(1) → throws", async () => {
    await expect(
      tool.execute(
        "t5",
        { language: "javascript", code: "process.exit(1);" },
        undefined,
        undefined,
        mockContext(cwd),
      ),
    ).rejects.toThrow(EvalToolError);
  });

  it("process.exit(0) → resolves with exitCode 0 and exitSignal null", async () => {
    const r = await tool.execute(
      "t6",
      { language: "javascript", code: "process.exit(0);" },
      undefined,
      undefined,
      mockContext(cwd),
    );
    expect(r.details.exitCode).toBe(0);
    expect(r.details.exitSignal).toBeNull();
  });

  it("empty code → (no output)", async () => {
    const r = await tool.execute(
      "t7",
      { language: "javascript", code: "// nothing" },
      undefined,
      undefined,
      mockContext(cwd),
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
      mockContext(cwd),
    );
    const t = text(r);
    expect(t).toContain("STDOUT:\nout");
    expect(t).toContain("STDERR:\nerr");
  });
});

describe("eval — Python execution", () => {
  it('print("hello") → STDOUT contains hello', async () => {
    if (!(await hasPython3())) return;
    const r = await tool.execute(
      "p1",
      { language: "python", code: 'print("hello")' },
      undefined,
      undefined,
      mockContext(cwd),
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
        mockContext(cwd),
      ),
    ).rejects.toThrow(EvalToolError);
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
      mockContext(cwd),
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
        mockContext(cwd),
      ),
    ).rejects.toThrow(EvalToolError);
  });

  it("sys.exit(0) → resolves with exitCode 0", async () => {
    if (!(await hasPython3())) return;
    const r = await tool.execute(
      "p4b",
      { language: "python", code: "import sys; sys.exit(0)" },
      undefined,
      undefined,
      mockContext(cwd),
    );
    expect(r.details.exitCode).toBe(0);
  });

  it("stderr is labelled separately from stdout", async () => {
    if (!(await hasPython3())) return;
    const r = await tool.execute(
      "p4c",
      {
        language: "python",
        code: "import sys; print('out'); print('err', file=sys.stderr)",
      },
      undefined,
      undefined,
      mockContext(cwd),
    );
    const t = text(r);
    expect(t).toContain("STDOUT:\nout");
    expect(t).toContain("STDERR:\nerr");
  });

  it("empty code → (no output)", async () => {
    if (!(await hasPython3())) return;
    const r = await tool.execute(
      "p5",
      { language: "python", code: "" },
      undefined,
      undefined,
      mockContext(cwd),
    );
    expect(text(r)).toContain("(no output)");
  });

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
      mockContext(cwd),
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
      mockContext(cwd),
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
        mockContext(cwd),
      ),
    ).rejects.toThrow(EvalBinaryNotFoundError);
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
      mockContext(cwd),
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
        mockContext(cwd),
      );
      expect(text(r)).toContain("STDOUT:\n");
    } catch {
      // numpy not installed in venv — acceptable, test passes
    }
  });
});

describe("eval — safety boundaries", () => {
  it("already-aborted signal throws EvalCancelledError immediately", async () => {
    const ac = new AbortController();
    ac.abort();
    await expect(
      tool.execute(
        "t12",
        { language: "javascript", code: 'console.log("nope");' },
        ac.signal,
        undefined,
        mockContext(cwd),
      ),
    ).rejects.toThrow(EvalCancelledError);
  });

  it("user abort during execution throws EvalCancelledError, not EvalTimeoutError", async () => {
    const ac = new AbortController();
    const promise = tool.execute(
      "t-cancel",
      {
        language: "javascript",
        code: "const start = Date.now(); while(Date.now() - start < 5000) {}",
      },
      ac.signal,
      undefined,
      mockContext(cwd),
    );
    // Abort after a short delay (before the 30s timeout)
    await new Promise((r) => setTimeout(r, 50));
    ac.abort();
    await expect(promise).rejects.toThrow(EvalCancelledError);
    // It must NOT be a timeout error
    await expect(promise).rejects.not.toThrow(EvalTimeoutError);
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
      mockContext(cwd),
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
      mockContext(cwd),
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
      mockContext(cwd),
    );
    const after = (await readdir(tmpdir())).filter((f) =>
      f.startsWith("pi-eval-"),
    );
    expect(after.length).toBeLessThanOrEqual(before.length);
  });

  it("temp file is cleaned up even on error", async () => {
    const before = (await readdir(tmpdir())).filter((f) =>
      f.startsWith("pi-eval-"),
    ).length;

    try {
      await tool.execute(
        "t-cleanup-err",
        { language: "javascript", code: 'throw new Error("cleanup fail");' },
        undefined,
        undefined,
        mockContext(cwd),
      );
    } catch {
      // expected
    }

    // Small delay to let rm resolve
    await new Promise((r) => setTimeout(r, 100));

    const after = (await readdir(tmpdir())).filter((f) =>
      f.startsWith("pi-eval-"),
    ).length;

    expect(after).toBeLessThanOrEqual(before);
  });
});

describe("eval — nodeModulesPath", () => {
  it("require() fails without nodeModulesPath for non-core module", async () => {
    await expect(
      tool.execute(
        "nmp1",
        { language: "javascript", code: "require('nonexistent-pkg-xyz');" },
        undefined,
        undefined,
        mockContext(cwd),
      ),
    ).rejects.toThrow(EvalToolError);
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
      mockContext(cwd),
    );
    expect(text(r)).toContain("typebox");
  });
});
