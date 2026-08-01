import { randomUUID } from "node:crypto";
import { existsSync, unlinkSync } from "node:fs";
import type {
  ExtensionAPI,
  ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { loadConfig } from "./config.js";
import { getPiInvocation } from "./lib/launch.js";
import {
  buildResearchCommandLine,
  shq,
  writeResearchScript,
} from "./lib/launch-script.js";
import { researchScriptLogPath, researchScriptPath } from "./lib/paths.js";
import type { ResearchReporter } from "./lib/research-ipc.js";
import {
  createResearchSession,
  getResearchSession,
  listResearchSessions,
  type ResearchSessionState,
  removeResearchSession,
} from "./lib/research-state.js";
import {
  extractLastAssistantOutput,
  generateChildSessionFile,
  seedForkSession,
} from "./lib/session.js";
import {
  tmuxActive,
  tmuxGetSessionName,
  tmuxKillPane,
  tmuxPaneAlive,
  tmuxSelectPane,
  tmuxSendKeys,
  tmuxSplitWindow,
} from "./lib/tmux.js";
import type { AgentConfig } from "./lib/types.js";

// ── Command names ───────────────────────────────────────────────────────────

/** Pi command names — single source of truth for the /rsh* command surface. */
export const RSH_COMMANDS = {
  /** Fork an interactive research session into a tmux pane. */
  research: "rsh",
  /** Close a research session pane and clean up its state. */
  close: "rsh-close",
  /** Send research findings back to the parent session. */
  report: "rsh-report",
} as const;

// ── Research fork identity ──────────────────────────────────────────────────

function makeResearchAgent(): AgentConfig {
  return {
    name: "research",
  };
}

// ── Stale session sweep ─────────────────────────────────────────────────────

/** Probe whether a PID is alive by sending signal 0 (same as pi-web). */
function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Sweep research sessions left behind by unclean child exits (crash,
 * SIGKILL, power loss). A session is stale when its pane is gone — or, for
 * the no-tmux fallback, when its child process is dead. Sessions with an
 * unknown liveness (no paneId, no childPid — pre-childPid sessions) are
 * left alone. Run at session start, mirroring pi-web's searxng unclean-
 * shutdown audit. Returns the number of sessions cleaned.
 */
export function sweepStaleResearchSessions(): number {
  let cleaned = 0;
  for (const state of listResearchSessions()) {
    if (state.status !== "running") {
      continue;
    }

    let alive: boolean;
    if (state.paneId) {
      alive = tmuxPaneAlive(state.paneId);
    } else if (state.childPid !== undefined) {
      alive = isProcessAlive(state.childPid);
    } else {
      continue; // unknown liveness — leave it
    }

    if (!alive) {
      closeResearchSessionById(state.id);
      cleaned++;
    }
  }
  return cleaned;
}

// ── Command line construction ───────────────────────────────────────────────

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

// ── /rsh ───────────────────────────────────────────────────────────────

export function createResearchHandler(pi: ExtensionAPI) {
  return async (args: string, ctx: ExtensionCommandContext) => {
    const config = loadConfig(ctx.cwd);
    const task = args.trim();
    if (!task) {
      ctx.ui.notify(`Usage: /${RSH_COMMANDS.research} <task>`, "error");
      return;
    }

    const parentSessionFile = ctx.sessionManager.getSessionFile();
    if (!parentSessionFile) {
      ctx.ui.notify("No active session to fork from.", "error");
      return;
    }

    const cwd = ctx.cwd;
    const sessionId = randomUUID();
    const childSessionFile = generateChildSessionFile(sessionId);
    const researchAgent = makeResearchAgent();

    try {
      seedForkSession(
        parentSessionFile,
        childSessionFile,
        researchAgent,
        cwd,
        sessionId,
      );
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

    const piEnv = collectPiEnv(sessionId, task);

    // Full pi command goes into an executable launch script, so the pane
    // only runs a short `bash <script>` and the exact invocation is kept
    // as a debuggable artifact. Env identity is inlined in the script so
    // the manual (no-tmux) fallback also carries PI_RSH_* vars.
    const { command, args: cmdArgs } = getPiInvocation(piArgs);
    const launchScript = writeResearchScript(
      sessionId,
      task,
      buildResearchCommandLine(piEnv, [command, ...cmdArgs]),
    );
    const runCmd = `bash ${shq(launchScript)}`;

    if (tmuxActive()) {
      const tmuxSession = tmuxGetSessionName();
      // Split first, register state, then start the child — the child must
      // never boot before its state file exists, or its childPid
      // self-registration would no-op (HazAT's split-then-send pattern).
      let paneId: string;
      try {
        paneId = tmuxSplitWindow("h");
      } catch (err) {
        ctx.ui.notify(
          `Failed to create tmux pane: ${err instanceof Error ? err.message : String(err)}`,
          "error",
        );
        return;
      }

      try {
        createResearchSession({
          id: sessionId,
          task,
          sessionFile: childSessionFile,
          paneId,
          tmuxSession,
          status: "running",
        });

        tmuxSendKeys(paneId, runCmd);
      } catch (err) {
        // Roll back: a failed startup must not leave a stale "running"
        // session or an orphaned pane behind. Idempotent whether or not
        // createResearchSession completed (kills the pane first, then
        // removes state + artifacts if registered).
        try {
          tmuxKillPane(paneId);
        } catch {
          // Pane may already be dead
        }
        closeResearchSessionById(sessionId);
        ctx.ui.notify(
          `Failed to start research session: ${err instanceof Error ? err.message : String(err)}`,
          "error",
        );
        return;
      }

      pi.sendMessage({
        customType: "research_start",
        content: `**Research:** ${task}\n\nOpened in tmux pane ${paneId}. When done, type \`/${RSH_COMMANDS.report}\` in the child pane to send findings back here.`,
        display: true,
      });

      // Jump the user into the new research pane so they can steer it
      // (disable via pi-subagents.json: { "focusOnStart": false }).
      if (config.focusOnStart) {
        try {
          tmuxSelectPane(paneId);
        } catch {
          // Focus is best-effort — the pane is up and the child started.
          // Don't fail the whole command over a select-pane hiccup.
        }
      }
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
      ctx.ui.notify(`  ${runCmd}`, "info");

      pi.sendMessage({
        customType: "research_start",
        content: `**Research:** ${task}\n\nNo tmux session detected. Run this in another terminal:\n\n\`\`\`\n${runCmd}\n\`\`\`\n\nUse \`/${RSH_COMMANDS.report}\` when done.`,
        display: true,
      });
    }
  };
}

// ── /rsh-close ──────────────────────────────────────────────────────────────

/**
 * Tear down a research session and its file trail (pane, session file,
 * launch script, stderr log, state). Idempotent — missing state is a no-op.
 * Shared by /rsh-close and the child's self-cleanup on exit.
 */
export function closeResearchSessionById(sessionId: string): void {
  const state = getResearchSession(sessionId);
  if (!state) {
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

  // Clean up the launch script and its stderr log
  const scriptPath = researchScriptPath(sessionId);
  if (existsSync(scriptPath)) {
    unlinkSync(scriptPath);
  }
  const logPath = researchScriptLogPath(sessionId);
  if (existsSync(logPath)) {
    unlinkSync(logPath);
  }

  removeResearchSession(sessionId);
}

/**
 * Resolve a close target by exact id, or by a prefix that uniquely
 * identifies one session (the /rsh listing shows the first 8 chars).
 * Returns "ambiguous" when a prefix matches more than one session,
 * null when nothing matches.
 */
export function resolveResearchSession(
  sessions: ResearchSessionState[],
  id: string,
): ResearchSessionState | "ambiguous" | null {
  const exact = sessions.find((s) => s.id === id) ?? null;
  if (exact) {
    return exact;
  }
  const matches = sessions.filter((s) => s.id.startsWith(id));
  if (matches.length > 1) {
    return "ambiguous";
  }
  const match = matches[0];
  if (match) {
    return match;
  }
  return null;
}

export function createResearchCloseHandler(pi: ExtensionAPI) {
  return async (args: string, ctx: ExtensionCommandContext) => {
    const id = args.trim();

    if (id) {
      // Close a specific session — exact id, or a prefix that uniquely
      // identifies one session (what the listing displays).
      const resolved = resolveResearchSession(listResearchSessions(), id);
      if (resolved === "ambiguous") {
        ctx.ui.notify(
          `Multiple sessions match id prefix "${id}" — use the full id.`,
          "error",
        );
        return;
      }
      if (!resolved) {
        ctx.ui.notify(`No research session found with id "${id}".`, "error");
        return;
      }

      closeResearchSessionById(resolved.id);

      pi.sendMessage({
        customType: "research_close",
        content: `Closed research session: ${resolved.task}`,
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
        `Active research sessions:\n${list}\n\nUse /${RSH_COMMANDS.close} <id> to close one.`,
        "info",
      );
    }
  };
}

// ── /rsh-report ─────────────────────────────────────────────────────────────

export function createResearchReportHandler(ipc: ResearchReporter) {
  return async (_args: string, ctx: ExtensionCommandContext) => {
    const sessionId = process.env.PI_RSH_SESSION_ID;
    const task = process.env.PI_RSH_TASK;

    if (!sessionId) {
      ctx.ui.notify(
        `/${RSH_COMMANDS.report}: Not in a research session (PI_RSH_SESSION_ID not set).`,
        "error",
      );
      return;
    }

    const sessionFile = ctx.sessionManager.getSessionFile();
    if (!sessionFile) {
      ctx.ui.notify(`/${RSH_COMMANDS.report}: No session file.`, "error");
      return;
    }

    // Extract the last assistant message from the child's session
    let output: string;
    try {
      const manager = SessionManager.open(sessionFile, undefined, ctx.cwd);
      output =
        extractLastAssistantOutput(
          manager.getEntries() as unknown as Array<Record<string, unknown>>,
        ) || "(no assistant output found)";
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
      `Report sent to parent session. You can close this pane with /${RSH_COMMANDS.close}.`,
      "info",
    );
  };
}
