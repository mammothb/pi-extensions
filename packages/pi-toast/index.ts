import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type {
  AskPromptPayload,
  PermissionPromptPayload,
} from "@mammothb/pi-shared";
import { loadConfig } from "./src/config.js";
import { extractPreview } from "./src/preview.js";

const execFileP = promisify(execFile);

// ── session label (tmux-aware) ──────────────────────────────────────────────

async function getSessionLabel(): Promise<string> {
  if (!process.env.TMUX) return "(shell)";
  try {
    const { stdout } = await execFileP(
      "tmux",
      ["display-message", "-p", "#S"],
      { encoding: "utf-8" },
    );
    return `(${stdout.trim()})`;
  } catch {
    return "(shell)";
  }
}

// ── notification ────────────────────────────────────────────────────────────

async function sendToast(
  executablePath: string,
  title: string,
  message: string,
): Promise<void> {
  try {
    await execFileP(executablePath, [title, message]);
  } catch (err) {
    console.error("pi-toast: notification failed:", err);
  }
}

// ── extension entry point ───────────────────────────────────────────────────

export default async function toastExtension(pi: ExtensionAPI) {
  const config = loadConfig(process.cwd());

  const { path } = config;
  if (!path) {
    console.warn(
      "pi-toast: no executable path configured; notifications disabled. Set `path` in ~/.pi/agent/pi-toast.json or .pi/pi-toast.json",
    );
    return;
  }

  const sessionLabel = await getSessionLabel();

  // ── agent end (existing) ────────────────────────────────────────────

  pi.on("agent_end", async (event) => {
    await sendToast(
      path,
      `Agent finished ${sessionLabel}`,
      extractPreview(event.messages),
    );
  });

  // ── ask prompt ──────────────────────────────────────────────────────

  pi.events.on("AskUserQuestion:prompt", (data) => {
    const { questions } = data as AskPromptPayload;
    const headers = questions.map((q) => q.header).join(", ");
    const label =
      questions.length > 1 ? ` (${questions.length} questions)` : "";
    sendToast(path, `pi-ask: Question ${sessionLabel}`, `${headers}${label}`);
  });

  // ── permission prompts ─────────────────────────────────────────────

  const onPermissionPrompt = (data: unknown) => {
    const { toolName, summary, reason } = data as PermissionPromptPayload;
    const body = reason
      ? `[${toolName}] ${summary} — ${reason}`
      : `[${toolName}] ${summary}`;
    sendToast(path, `pi-perms: Permission Required ${sessionLabel}`, body);
  };

  const PERMISSION_TOOLS = [
    "bash",
    "read",
    "write",
    "edit",
    "grep",
    "find",
    "ls",
  ];
  for (const tool of PERMISSION_TOOLS) {
    pi.events.on(`${tool}_permission:prompt`, onPermissionPrompt);
  }
}
