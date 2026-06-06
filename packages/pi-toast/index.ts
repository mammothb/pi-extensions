import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
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

  pi.on("agent_end", async (event) => {
    const sessionLabel = await getSessionLabel();
    const fullTitle = `Agent finished ${sessionLabel}`;
    await sendToast(path, fullTitle, extractPreview(event.messages));
  });
}
