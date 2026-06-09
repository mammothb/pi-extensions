import { describe, expect, it } from "vitest";
import { type DialogDetails, promptPermission } from "../../src/lib/dialog.js";

describe("promptPermission", () => {
  it("returns allow when user confirms", async () => {
    const confirm = async (_msg: string) => true;
    const details: DialogDetails = {
      toolName: "bash",
      category: "bash",
      summary: "git push origin main",
    };

    const result = await promptPermission(confirm, details);
    expect(result).toBe("allow");
  });

  it("returns deny when user denies", async () => {
    const confirm = async (_msg: string) => false;
    const details: DialogDetails = {
      toolName: "bash",
      category: "bash",
      summary: "rm -rf /",
    };

    const result = await promptPermission(confirm, details);
    expect(result).toBe("deny");
  });

  it("includes tool name in tool category messages", async () => {
    let capturedMessage = "";
    const confirm = async (msg: string) => {
      capturedMessage = msg;
      return true;
    };

    await promptPermission(confirm, {
      toolName: "write",
      category: "tool",
      summary: "",
    });

    expect(capturedMessage).toContain("Agent wants to call: write");
  });

  it("includes command in bash category messages", async () => {
    let capturedMessage = "";
    const confirm = async (msg: string) => {
      capturedMessage = msg;
      return true;
    };

    await promptPermission(confirm, {
      toolName: "bash",
      category: "bash",
      summary: "git push --force origin main",
    });

    expect(capturedMessage).toContain(
      "Agent wants to run: git push --force origin main",
    );
  });

  it("includes path and tool in path category messages", async () => {
    let capturedMessage = "";
    const confirm = async (msg: string) => {
      capturedMessage = msg;
      return true;
    };

    await promptPermission(confirm, {
      toolName: "write",
      category: "path",
      summary: "/home/user/.env",
    });

    expect(capturedMessage).toContain(
      "Agent wants to use write on: /home/user/.env",
    );
  });

  it("includes reason when provided", async () => {
    let capturedMessage = "";
    const confirm = async (msg: string) => {
      capturedMessage = msg;
      return true;
    };

    await promptPermission(confirm, {
      toolName: "bash",
      category: "bash",
      summary: "sudo rm -rf /",
      reason: "destructive command",
    });

    expect(capturedMessage).toContain("Reason: destructive command");
  });

  it("message ends with Allow this call?", async () => {
    let capturedMessage = "";
    const confirm = async (msg: string) => {
      capturedMessage = msg;
      return true;
    };

    await promptPermission(confirm, {
      toolName: "read",
      category: "tool",
      summary: "",
    });

    expect(capturedMessage).toContain("Allow this call?");
  });
});
