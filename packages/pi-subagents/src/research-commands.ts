import { randomUUID } from "node:crypto";
import { existsSync, unlinkSync } from "node:fs";
import type {
  ExtensionAPI,
  ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { getPiInvocation } from "./lib/launch.js";
import type { ResearchIPC } from "./lib/research-ipc.js";
import {
  createResearchSession,
  getResearchSession,
  listResearchSessions,
  removeResearchSession,
} from "./lib/research-state.js";
import { generateChildSessionFile, seedForkSession } from "./lib/session.js";
import {
  tmuxActive,
  tmuxGetSessionName,
  tmuxKillPane,
  tmuxSplitWindow,
} from "./lib/tmux.js";
import type { AgentConfig } from "./lib/types.js";

// ── Fork agent config ───────────────────────────────────────────────────────

function makeResearchAgent(): AgentConfig {
  return {
    name: "research",
    description: "",
    model: "",
    thinking: "",
    tools: [],
    mode: "fork",
    sandbox: false,
    noSession: true,
    body: "",
  };
}

// ── Shell-escaping ──────────────────────────────────────────────────────────

/** Single-quote a string for shell use, handling embedded quotes. */
function shq(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}

/** Collect PI_* env vars + research session identity to pass to the child pane. */
function collectPiEnv(sessionId: string, task: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (k.startsWith("PI_") && v) {
      env[k] = v;
    }
  }
  env.PI_RSH_SESSION_ID = sessionId;
  env.PI_RSH_TASK = task;
  return env;
}

// ── /research ───────────────────────────────────────────────────────────────

export function createResearchHandler(pi: ExtensionAPI) {
  return async (args: string, ctx: ExtensionCommandContext) => {
    const task = args.trim();
    if (!task) {
      ctx.ui.notify("Usage: /research <task>", "error");
      return;
    }

    const parentSessionFile = ctx.sessionManager.getSessionFile();
    if (!parentSessionFile) {
      ctx.ui.notify("No active session to fork from.", "error");
      return;
    }

    const cwd = ctx.cwd;
    const childSessionFile = generateChildSessionFile();
    const researchAgent = makeResearchAgent();

    try {
      seedForkSession(parentSessionFile, childSessionFile, researchAgent, cwd);
    } catch (err) {
      ctx.ui.notify(
        `Failed to fork session: ${err instanceof Error ? err.message : String(err)}`,
        "error",
      );
      return;
    }

    // Build pi command: interactive mode with the forked session
    const piArgs = ["--session", childSessionFile];
    const modelId = ctx.model
      ? `${ctx.model.provider}/${ctx.model.id}`
      : undefined;
    if (modelId) {
      piArgs.push("--model", modelId);
    }

    const sessionId = randomUUID();

    const { command, args: cmdArgs } = getPiInvocation(piArgs);
    const shellCmd = [command, ...cmdArgs].map(shq).join(" ");
    const piEnv = collectPiEnv(sessionId, task);

    if (tmuxActive()) {
      const tmuxSession = tmuxGetSessionName();
      const paneId = tmuxSplitWindow(shellCmd, "h", piEnv);

      createResearchSession({
        id: sessionId,
        task,
        sessionFile: childSessionFile,
        paneId,
        tmuxSession,
        status: "running",
      });

      pi.sendMessage({
        customType: "research_start",
        content: `**Research:** ${task}\n\nOpened in tmux pane ${paneId}. When done, type \`/rsh-report\` in the child pane to send findings back here.`,
        display: true,
      });
    } else {
      createResearchSession({
        id: sessionId,
        task,
        sessionFile: childSessionFile,
        paneId: null,
        tmuxSession: null,
        status: "running",
      });

      ctx.ui.notify("No tmux session detected.", "warning");
      ctx.ui.notify(`Run this in another terminal to continue:`, "info");
      ctx.ui.notify(`  ${shellCmd}`, "info");

      pi.sendMessage({
        customType: "research_start",
        content: `**Research:** ${task}\n\nNo tmux session detected. Run this in another terminal:\n\n\`\`\`\n${shellCmd}\n\`\`\`\n\nUse \`/rsh-report\` when done.`,
        display: true,
      });
    }
  };
}

// ── /research-close ─────────────────────────────────────────────────────────

export function createResearchCloseHandler(pi: ExtensionAPI) {
  return async (args: string, ctx: ExtensionCommandContext) => {
    const id = args.trim();

    if (id) {
      // Close a specific session
      const state = getResearchSession(id);
      if (!state) {
        ctx.ui.notify(`No research session found with id "${id}".`, "error");
        return;
      }

      if (state.paneId) {
        try {
          tmuxKillPane(state.paneId);
        } catch {
          // Pane may already be dead
        }
      }

      // Clean up the forked child session file
      if (existsSync(state.sessionFile)) {
        unlinkSync(state.sessionFile);
      }

      removeResearchSession(id);

      pi.sendMessage({
        customType: "research_close",
        content: `Closed research session: ${state.task}`,
        display: true,
      });
    } else {
      // No id — list active sessions
      const sessions = listResearchSessions().filter(
        (s) => s.status === "running",
      );

      if (sessions.length === 0) {
        ctx.ui.notify("No active research sessions.", "info");
        return;
      }

      const list = sessions
        .map((s) => `  ${s.id.slice(0, 8)}  ${s.task}`)
        .join("\n");
      ctx.ui.notify(
        `Active research sessions:\n${list}\n\nUse /rsh-close <id> to close one.`,
        "info",
      );
    }
  };
}

// ── /rsh-report ─────────────────────────────────────────────────────────────

export function createRshReportHandler(_pi: ExtensionAPI, ipc: ResearchIPC) {
  return async (_args: string, ctx: ExtensionCommandContext) => {
    const sessionId = process.env.PI_RSH_SESSION_ID;
    const task = process.env.PI_RSH_TASK;

    if (!sessionId) {
      ctx.ui.notify(
        "/rsh-report: Not in a research session (PI_RSH_SESSION_ID not set).",
        "error",
      );
      return;
    }

    const sessionFile = ctx.sessionManager.getSessionFile();
    if (!sessionFile) {
      ctx.ui.notify("/rsh-report: No session file.", "error");
      return;
    }

    // Extract the last assistant message from the child's session
    let output: string;
    try {
      const manager = SessionManager.open(sessionFile, undefined, ctx.cwd);
      const entries = manager.getEntries();

      let lastAssistant = "";
      for (let i = entries.length - 1; i >= 0; i--) {
        const entry = entries[i] as unknown as
          | Record<string, unknown>
          | undefined;
        if (!entry) {
          continue;
        }
        if (entry.role === "assistant") {
          const content = entry.content;
          if (typeof content === "string") {
            lastAssistant = content;
          } else if (Array.isArray(content)) {
            lastAssistant = content
              .filter((p: Record<string, unknown>) => p.type === "text")
              .map((p: Record<string, unknown>) => String(p.text ?? ""))
              .join("");
          }
          if (lastAssistant) {
            break;
          }
        }
      }
      output = lastAssistant || "(no assistant output found)";
    } catch (err) {
      ctx.ui.notify(
        `Failed to extract report: ${err instanceof Error ? err.message : String(err)}`,
        "error",
      );
      return;
    }

    await ipc.reportBack({
      sessionId,
      task: task || "(unknown task)",
      output,
      completedAt: new Date().toISOString(),
    });

    ctx.ui.notify(
      "Report sent to parent session. You can close this pane with /rsh-close.",
      "info",
    );
  };
}
