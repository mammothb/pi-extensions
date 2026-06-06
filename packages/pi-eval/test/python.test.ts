import { describe, expect, it } from "vitest";
import { resolvePythonBinary } from "../src/lib/python.js";
import { EvalBinaryNotFoundError, EvalToolError } from "../src/lib/types.js";
import { hasPython3 } from "./_helpers.js";

const cwd = process.cwd();

describe("resolvePythonBinary", () => {
  it("resolves default python3 from PATH", async () => {
    if (!(await hasPython3())) return;
    const bin = await resolvePythonBinary(undefined, cwd);
    expect(bin).toBeTruthy();
    // Should contain "python3" in the path
    expect(bin).toMatch(/python3/);
  });

  it("throws EvalBinaryNotFoundError for nonexistent path", async () => {
    await expect(
      resolvePythonBinary("/nonexistent/python3", cwd),
    ).rejects.toThrow(EvalBinaryNotFoundError);
  });

  it("throws EvalBinaryNotFoundError for relative nonexistent path", async () => {
    await expect(
      resolvePythonBinary("./nonexistent/python3", cwd),
    ).rejects.toThrow(EvalBinaryNotFoundError);
  });

  it("resolves absolute pythonPath when valid", async () => {
    if (!(await hasPython3())) return;
    // First resolve default to get the absolute path
    const defaultBin = await resolvePythonBinary(undefined, cwd);
    // Then resolve using that absolute path
    const bin = await resolvePythonBinary(defaultBin, cwd);
    expect(bin).toBe(defaultBin);
  });

  it("resolves relative pythonPath from cwd", async () => {
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

    const bin = await resolvePythonBinary(".venv/bin/python3", cwd);
    expect(bin).toContain(".venv/bin/python3");
  });
});

describe("EvalToolError hierarchy", () => {
  it("EvalBinaryNotFoundError is instance of EvalToolError", () => {
    const err = new EvalBinaryNotFoundError("/bad/path");
    expect(err).toBeInstanceOf(EvalToolError);
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe("BINARY_NOT_FOUND");
  });

  it("EvalToolError carries code field", () => {
    const err = new EvalToolError("test message", "TEST_CODE");
    expect(err.code).toBe("TEST_CODE");
    expect(err.message).toBe("test message");
    expect(err.name).toBe("EvalToolError");
  });
});
