import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { createSmartReadTool } from "../src/read-tool.js";
import type { LanguageId, OutlineSymbol, ReadConfig } from "../src/types.js";

const { builtinExecute } = vi.hoisted(() => ({
  builtinExecute: vi.fn(async () => ({
    content: [{ type: "text" as const, text: "BUILTIN" }],
    details: undefined,
  })),
}));

vi.mock("@earendil-works/pi-coding-agent", () => ({
  createReadToolDefinition: vi.fn(() => ({
    name: "read",
    label: "read",
    description: "fake read",
    parameters: {},
    execute: builtinExecute,
  })),
}));

const ALL_LANGUAGES: ReadConfig["languages"] = {
  typescript: true,
  tsx: true,
  javascript: true,
  csharp: true,
  python: true,
  rust: true,
};

const config: ReadConfig = {
  enabled: true,
  thresholdLines: 3,
  thresholdBytes: 1000,
  maxBytes: 100_000,
  maxDepth: 10,
  languages: ALL_LANGUAGES,
};

const fakeParseSymbols = vi.fn(
  async (_id: LanguageId, _source: string): Promise<OutlineSymbol[]> => [
    { name: "App", type: "class", startLine: 1, endLine: 5, children: [] },
  ],
);

let dir: string | undefined;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "pi-read-"));
  writeFileSync(join(dir, "small.ts"), "const a = 1;");
  writeFileSync(join(dir, "large.ts"), "a\nb\nc\nd\ne");
  mkdirSync(join(dir, "dir.ts"));
});

afterAll(() => {
  if (dir !== undefined) {
    rmSync(dir, { recursive: true, force: true });
  }
});

const tool = createSmartReadTool({
  getConfig: () => config,
  parseSymbols: fakeParseSymbols,
});

function run(path: string, extra: { offset?: number; limit?: number } = {}) {
  return tool.execute("id", { path, ...extra }, undefined, undefined, {
    cwd: dir,
  } as never);
}

describe("createSmartReadTool.execute", () => {
  beforeEach(() => {
    config.enabled = true;
    config.maxBytes = 100_000;
    config.languages = ALL_LANGUAGES;
    builtinExecute.mockClear();
    fakeParseSymbols.mockClear();
  });

  it("delegates images to the built-in read", async () => {
    const result = await run("photo.png");
    expect(builtinExecute).toHaveBeenCalledTimes(1);
    expect(result.content).toEqual([{ type: "text", text: "BUILTIN" }]);
  });

  it("delegates NUL-containing binary mislabeled with a code extension", async () => {
    writeFileSync(join(dir!, "binary.ts"), "fake \u0000 text");
    await run("binary.ts");
    expect(builtinExecute).toHaveBeenCalledTimes(1);
    expect(fakeParseSymbols).not.toHaveBeenCalled();
  });

  it("resolves @-prefixed paths like the built-in read", async () => {
    const result = await run("@large.ts");
    expect(builtinExecute).not.toHaveBeenCalled();
    expect(fakeParseSymbols).toHaveBeenCalledTimes(1);
    expect(result.content).toEqual([
      { type: "text", text: expect.stringContaining("class App") },
    ]);
  });

  it("delegates unsupported extensions", async () => {
    await run("README.md");
    expect(builtinExecute).toHaveBeenCalledTimes(1);
    expect(fakeParseSymbols).not.toHaveBeenCalled();
  });

  it("delegates small files", async () => {
    await run("small.ts");
    expect(builtinExecute).toHaveBeenCalledTimes(1);
    expect(fakeParseSymbols).not.toHaveBeenCalled();
  });

  it("delegates offset/limit drill-downs", async () => {
    await run("large.ts", { offset: 1, limit: 2 });
    expect(builtinExecute).toHaveBeenCalledTimes(1);
    expect(fakeParseSymbols).not.toHaveBeenCalled();
  });

  it("delegates when disabled", async () => {
    config.enabled = false;
    await run("large.ts");
    expect(builtinExecute).toHaveBeenCalledTimes(1);
    expect(fakeParseSymbols).not.toHaveBeenCalled();
  });

  it("delegates disabled languages", async () => {
    config.languages = { ...ALL_LANGUAGES, python: false };
    writeFileSync(join(dir!, "test.py"), "def f(): pass\n");
    await run("test.py");
    expect(builtinExecute).toHaveBeenCalledTimes(1);
    expect(fakeParseSymbols).not.toHaveBeenCalled();
  });

  it("delegates directories", async () => {
    await run("dir.ts");
    expect(builtinExecute).toHaveBeenCalledTimes(1);
    expect(fakeParseSymbols).not.toHaveBeenCalled();
  });

  it("delegates FIFOs without blocking", async () => {
    const fifo = join(dir!, "pipe.ts");
    execFileSync("mkfifo", [fifo]);
    await run("pipe.ts");
    expect(builtinExecute).toHaveBeenCalledTimes(1);
    expect(fakeParseSymbols).not.toHaveBeenCalled();
  });

  it("delegates missing files", async () => {
    await run("nope.ts");
    expect(builtinExecute).toHaveBeenCalledTimes(1);
    expect(fakeParseSymbols).not.toHaveBeenCalled();
  });

  it("delegates files over the size cap", async () => {
    config.maxBytes = 10;
    writeFileSync(join(dir!, "big.ts"), "x".repeat(100));
    await run("big.ts");
    expect(builtinExecute).toHaveBeenCalledTimes(1);
    expect(fakeParseSymbols).not.toHaveBeenCalled();
  });

  it("outlines large supported files without delegating", async () => {
    const result = await run("large.ts");
    expect(builtinExecute).not.toHaveBeenCalled();
    expect(fakeParseSymbols).toHaveBeenCalledTimes(1);
    expect(result.details).toBeUndefined();
    expect(result.content).toEqual([
      { type: "text", text: expect.stringContaining("class App") },
    ]);
  });

  it("delegates when the parser finds no symbols", async () => {
    fakeParseSymbols.mockResolvedValueOnce([]);
    await run("large.ts");
    expect(builtinExecute).toHaveBeenCalledTimes(1);
    expect(fakeParseSymbols).toHaveBeenCalledTimes(1);
  });

  it("rejects when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      tool.execute("id", { path: "large.ts" }, controller.signal, undefined, {
        cwd: dir,
      } as never),
    ).rejects.toThrow("Operation aborted");
    expect(fakeParseSymbols).not.toHaveBeenCalled();
  });
});
