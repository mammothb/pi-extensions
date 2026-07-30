import { randomUUID } from "node:crypto";
import { existsSync, unlinkSync } from "node:fs";
import type {
  ExtensionAPI,
  ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import { getPiInvocation } from "./lib/launch.js";
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

/** Collect PI_* env vars to pass to the child pane. */
function collectPiEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (k.startsWith("PI_") && v) {
      env[k] = v;
    }
  }
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

    const { command, args: cmdArgs } = getPiInvocation(piArgs);
    const shellCmd = [command, ...cmdArgs].map(shq).join(" ");
    const piEnv = collectPiEnv();

    const sessionId = randomUUID();

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
        content: `**Research:** ${task}\n\nOpened in tmux pane ${paneId}. When done, type \`/report-back\` in the child pane to send findings back here.`,
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
        content: `**Research:** ${task}\n\nNo tmux session detected. Run this in another terminal:\n\n\`\`\`\n${shellCmd}\n\`\`\`\n\nUse \`/report-back\` when done.`,
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
        `Active research sessions:\n${list}\n\nUse /research-close <id> to close one.`,
        "info",
      );
    }
  };
}
