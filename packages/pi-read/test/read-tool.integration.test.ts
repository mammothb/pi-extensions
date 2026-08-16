import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
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

const config: ReadConfig = {
  enabled: true,
  thresholdLines: 3,
  thresholdBytes: 1000,
  maxDepth: 10,
  languages: {
    typescript: true,
    tsx: true,
    javascript: true,
    csharp: true,
    python: true,
    rust: true,
  },
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
    builtinExecute.mockClear();
    fakeParseSymbols.mockClear();
  });

  it("delegates images to the built-in read", async () => {
    const result = await run("photo.png");
    expect(builtinExecute).toHaveBeenCalledTimes(1);
    expect(result.content).toEqual([{ type: "text", text: "BUILTIN" }]);
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

  it("outlines large supported files without delegating", async () => {
    const result = await run("large.ts");
    expect(builtinExecute).not.toHaveBeenCalled();
    expect(fakeParseSymbols).toHaveBeenCalledTimes(1);
    expect(result.details).toBeUndefined();
    expect(result.content).toEqual([
      { type: "text", text: expect.stringContaining("class App") },
    ]);
  });
});
