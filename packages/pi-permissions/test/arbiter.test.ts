import { chmodSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runBashArbiter } from "../src/arbiter.js";

const arbitersDir = join(tmpdir(), "pi-permissions-arbiter-tests");

function writeArbiter(filename: string, content: string): string {
  const path = join(arbitersDir, filename);
  writeFileSync(path, content);
  chmodSync(path, 0o755);
  return path;
}

beforeEach(() => {
  mkdirSync(arbitersDir, { recursive: true });
});

afterEach(() => {
  rmSync(arbitersDir, { recursive: true, force: true });
});

describe("runBashArbiter", () => {
  it("returns allow when arbiter exits 0", async () => {
    const arbiter = writeArbiter("allow.sh", "#!/bin/bash\nexit 0\n");

    const result = await runBashArbiter("git status", arbiter);
    expect(result.action).toBe("allow");
    expect(result.reason).toBe("");
  });

  it("returns deny when arbiter exits 1", async () => {
    const arbiter = writeArbiter(
      "deny.sh",
      "#!/bin/bash\necho 'destructive git operation' >&2\nexit 1\n",
    );

    const result = await runBashArbiter(
      "git push --force origin main",
      arbiter,
    );
    expect(result.action).toBe("deny");
    expect(result.reason).toContain("destructive git operation");
  });

  it("returns deny with default reason when arbiter exits 1 with no stderr", async () => {
    const arbiter = writeArbiter("deny-silent.sh", "#!/bin/bash\nexit 1\n");

    const result = await runBashArbiter("rm -rf /", arbiter);
    expect(result.action).toBe("deny");
    expect(result.reason).toContain("blocked by bash arbiter");
  });

  it("returns ask when arbiter exits 2", async () => {
    const arbiter = writeArbiter("ask.sh", "#!/bin/bash\nexit 2\n");

    const result = await runBashArbiter("npm test", arbiter);
    expect(result.action).toBe("ask");
  });

  it("returns ask with reason when arbiter exits 2 with stderr", async () => {
    const arbiter = writeArbiter(
      "ask-reason.sh",
      "#!/bin/bash\necho 'needs user confirmation' >&2\nexit 2\n",
    );

    const result = await runBashArbiter("npm publish", arbiter);
    expect(result.action).toBe("ask");
    expect(result.reason).toContain("needs user confirmation");
  });

  it("treats unknown exit codes as deny", async () => {
    const arbiter = writeArbiter("unknown.sh", "#!/bin/bash\nexit 3\n");

    const result = await runBashArbiter("some command", arbiter);
    expect(result.action).toBe("deny");
    expect(result.reason).toContain("unexpected code 3");
  });

  it("returns deny when arbiter does not exist", async () => {
    const result = await runBashArbiter(
      "git status",
      join(arbitersDir, "does-not-exist.sh"),
    );
    expect(result.action).toBe("deny");
    expect(result.reason).toContain("not found or not executable");
  });

  it("returns deny when arbiter exists but is not executable", async () => {
    const path = join(arbitersDir, "not-executable.sh");
    writeFileSync(path, "#!/bin/bash\nexit 0\n");
    // chmod 644 = not executable
    chmodSync(path, 0o644);

    const result = await runBashArbiter("git status", path);
    expect(result.action).toBe("deny");
    expect(result.reason).toContain("not found or not executable");
  });

  it("passes the command as the first positional argument ($1)", async () => {
    const arbiter = writeArbiter(
      "echo-arg.sh",
      '#!/bin/bash\necho "$1" >&2\nexit 1\n',
    );

    const result = await runBashArbiter("git push origin main", arbiter);
    // Arbiter echoes $1 to stderr, then exits 1. The stderr should contain the command.
    expect(result.reason).toContain("git push origin main");
  });

  it("kills arbiter on timeout and returns deny", async () => {
    const arbiter = writeArbiter("slow.sh", "#!/bin/bash\nsleep 10\nexit 0\n");

    const result = await runBashArbiter("git status", arbiter, 500);
    expect(result.action).toBe("deny");
    expect(result.reason).toContain("timed out");
  });

  it("stderr is trimmed in the reason", async () => {
    const arbiter = writeArbiter(
      "whitespace-stderr.sh",
      "#!/bin/bash\necho '' >&2\necho '  denied: dangerous command  ' >&2\nexit 1\n",
    );

    const result = await runBashArbiter("sudo rm -rf /", arbiter);
    expect(result.action).toBe("deny");
    // Should be trimmed (no leading/trailing whitespace)
    expect(result.reason).toBe("denied: dangerous command");
  });
});
