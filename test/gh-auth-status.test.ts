import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "../src/config.js";
import { createGhAuthStatusTool } from "../src/gh-auth-status.js";
import { createMockPi } from "./_helpers/mock-pi.js";

describe("gh_auth_status tool", () => {
  it("registers with the expected name", () => {
    const pi = createMockPi({ stdout: "", stderr: "", code: 0 });
    const tool = createGhAuthStatusTool(pi as any, DEFAULT_CONFIG);
    expect(tool.name).toBe("gh_auth_status");
  });

  it("calls gh auth status with no arguments by default", async () => {
    const pi = createMockPi({
      stdout: "Logged in to github.com as someuser",
      stderr: "",
      code: 0,
    });
    const tool = createGhAuthStatusTool(pi as any, DEFAULT_CONFIG);

    const result = await tool.execute("call-1", {}, undefined, undefined, {
      cwd: "/tmp",
    } as any);

    expect(pi.exec).toHaveBeenCalledWith(
      "gh",
      ["auth", "status"],
      expect.objectContaining({ cwd: "/tmp" }),
    );
    expect(result.details.authenticated).toBe(true);
    expect(result.details.exitCode).toBe(0);
  });

  it("passes --hostname when provided", async () => {
    const pi = createMockPi({ stdout: "", stderr: "", code: 0 });
    const tool = createGhAuthStatusTool(pi as any, DEFAULT_CONFIG);

    await tool.execute(
      "call-1",
      { hostname: "github.internal" },
      undefined,
      undefined,
      {} as any,
    );

    expect(pi.exec).toHaveBeenCalledWith(
      "gh",
      ["auth", "status", "--hostname", "github.internal"],
      expect.anything(),
    );
  });

  it("passes --active when provided", async () => {
    const pi = createMockPi({ stdout: "", stderr: "", code: 0 });
    const tool = createGhAuthStatusTool(pi as any, DEFAULT_CONFIG);

    await tool.execute(
      "call-1",
      { active: true },
      undefined,
      undefined,
      {} as any,
    );

    expect(pi.exec).toHaveBeenCalledWith(
      "gh",
      ["auth", "status", "--active"],
      expect.anything(),
    );
  });

  it("does not throw on non-zero exit — reports unauthenticated", async () => {
    const pi = createMockPi({
      stdout: "",
      stderr: "not authenticated",
      code: 1,
    });
    const tool = createGhAuthStatusTool(pi as any, DEFAULT_CONFIG);

    const result = await tool.execute(
      "call-1",
      {},
      undefined,
      undefined,
      {} as any,
    );

    expect(result.details.authenticated).toBe(false);
    expect(result.details.exitCode).toBe(1);
    if (result.content[0]?.type === "text") {
      expect(result.content[0].text).toBe("not authenticated");
    }
  });

  it("falls back to stdout when stderr is empty", async () => {
    const pi = createMockPi({
      stdout: "Logged in to github.com as user",
      stderr: "",
      code: 0,
    });
    const tool = createGhAuthStatusTool(pi as any, DEFAULT_CONFIG);

    const result = await tool.execute(
      "call-1",
      {},
      undefined,
      undefined,
      {} as any,
    );

    if (result.content[0]?.type === "text") {
      expect(result.content[0].text).toBe("Logged in to github.com as user");
    }
  });

  it("returns command details for debugging", async () => {
    const pi = createMockPi({
      stdout: "ok",
      stderr: "",
      code: 0,
    });
    const tool = createGhAuthStatusTool(pi as any, DEFAULT_CONFIG);

    const result = await tool.execute(
      "call-1",
      { hostname: "github.com", active: true },
      undefined,
      undefined,
      {} as any,
    );

    expect(result.details.command).toEqual([
      "gh",
      "auth",
      "status",
      "--hostname",
      "github.com",
      "--active",
    ]);
  });
});
