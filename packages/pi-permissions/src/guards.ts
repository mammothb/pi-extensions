import type {
  BashToolCallEvent,
  EditToolCallEvent,
  ExtensionAPI,
  ReadToolCallEvent,
  ToolCallEvent,
  ToolCallEventResult,
  WriteToolCallEvent,
} from "@earendil-works/pi-coding-agent";
import type { PermissionPromptPayload } from "@mammothb/pi-shared";
import { checkBash, checkPath, checkTool } from "./engine.js";
import type { ApprovalCache } from "./lib/approval-cache.js";
import {
  type ConfirmFn,
  type DialogDetails,
  promptPermission,
} from "./lib/dialog.js";
import type { ResolvedConfig } from "./lib/types.js";

/**
 * Extract the file path from a path-bearing tool call event.
 * Returns undefined for non-path-bearing tools or tools without a path.
 */
function extractPath(event: ToolCallEvent): string | undefined {
  switch (event.toolName) {
    case "read":
      return (event as ReadToolCallEvent).input.path;
    case "write":
      return (event as WriteToolCallEvent).input.path;
    case "edit":
      return (event as EditToolCallEvent).input.path;
    default:
      return undefined;
  }
}

/**
 * Build a session store key for deduplication.
 */
function makeSessionKey(toolName: string, details?: string): string {
  return details ? `${toolName}:${details}` : toolName;
}

/**
 * Handle an "ask" result: check session store, prompt user if needed,
 * and return the block decision.
 */
async function handleAsk(
  confirm: ConfirmFn,
  store: ApprovalCache,
  storeKey: string,
  details: DialogDetails,
  pi: ExtensionAPI,
  hasUI: boolean,
): Promise<ToolCallEventResult | undefined> {
  // Check session store first
  const stored = store.get(storeKey);
  if (stored === "deny") {
    return { block: true, reason: "Permission denied (cached)" };
  }
  if (stored === "allow") {
    return; // proceed
  }

  // Emit before showing the permission dialog (only when UI is available)
  if (hasUI) {
    const payload: PermissionPromptPayload = {
      toolName: details.toolName,
      category: details.category,
      summary: details.summary,
      reason: details.reason,
    };
    pi.events.emit(`${details.toolName}_permission:prompt`, payload);
  }

  // Prompt the user via the shared dialog module
  const decision = await promptPermission(confirm, details);
  store.set(storeKey, decision);

  if (decision === "deny") {
    return { block: true, reason: "Permission denied by user" };
  }
  // allowed — proceed
}

function makeConfirmFn(ctx: {
  hasUI: boolean;
  ui: { confirm(title: string, message: string): Promise<boolean | null> };
}): ConfirmFn {
  return async (message) => {
    if (!ctx.hasUI) {
      return false;
    }
    return (await ctx.ui.confirm("Permission Required", message)) ?? false;
  };
}

function deny(reason: string): ToolCallEventResult {
  return { block: true, reason: `Permission denied: ${reason}` };
}

/**
 * Run a single guard check result through the deny-or-ask flow.
 * Returns a block result if denied, undefined if allowed.
 */
async function runGuard(
  result: { action: string; reason?: string },
  details: DialogDetails,
  sessionKey: string,
  confirm: ConfirmFn,
  store: ApprovalCache,
  pi: ExtensionAPI,
  hasUI: boolean,
): Promise<ToolCallEventResult | undefined> {
  if (result.action === "deny") {
    return deny(result.reason ?? "unknown");
  }
  if (result.action === "ask") {
    return handleAsk(confirm, store, sessionKey, details, pi, hasUI);
  }
}

async function runPathBearingChecks(
  targetPath: string,
  toolName: string,
  cwd: string,
  config: ResolvedConfig,
  confirm: ConfirmFn,
  store: ApprovalCache,
  pi: ExtensionAPI,
  hasUI: boolean,
): Promise<ToolCallEventResult | undefined> {
  const pathResult = checkPath(targetPath, cwd, config);
  const toolResult = checkTool(toolName, config);

  // Deny from either check short-circuits — no dialog shown
  if (pathResult.action === "deny") {
    return deny(pathResult.reason);
  }
  if (toolResult.action === "deny") {
    return deny(toolResult.reason);
  }

  // Ask: at most one dialog. Prefer the path prompt — it already
  // names the tool and is more specific than a bare tool name.
  if (pathResult.action === "ask") {
    return runGuard(
      pathResult,
      {
        toolName,
        category: "path",
        summary: targetPath,
        reason: pathResult.matchedRule
          ? `matched rule "${pathResult.matchedRule}"`
          : undefined,
      },
      makeSessionKey(toolName, targetPath),
      confirm,
      store,
      pi,
      hasUI,
    );
  }
  if (toolResult.action === "ask") {
    return runGuard(
      toolResult,
      {
        toolName,
        category: "tool",
        summary: "",
        reason: toolResult.matchedRule
          ? `matched rule "${toolResult.matchedRule}"`
          : undefined,
      },
      makeSessionKey(toolName, targetPath),
      confirm,
      store,
      pi,
      hasUI,
    );
  }
}

async function runToolOnlyCheck(
  toolName: string,
  config: ResolvedConfig,
  confirm: ConfirmFn,
  store: ApprovalCache,
  pi: ExtensionAPI,
  hasUI: boolean,
): Promise<ToolCallEventResult | undefined> {
  const toolResult = checkTool(toolName, config);
  return runGuard(
    toolResult,
    {
      toolName,
      category: "tool",
      summary: "",
      reason: toolResult.matchedRule
        ? `matched rule "${toolResult.matchedRule}"`
        : toolResult.reason,
    },
    makeSessionKey(toolName),
    confirm,
    store,
    pi,
    hasUI,
  );
}

async function runBashCheck(
  command: string,
  config: ResolvedConfig,
  confirm: ConfirmFn,
  store: ApprovalCache,
  pi: ExtensionAPI,
  hasUI: boolean,
): Promise<ToolCallEventResult | undefined> {
  const bashResult = await checkBash(command, config);
  return runGuard(
    bashResult,
    {
      toolName: "bash",
      category: "bash",
      summary: command,
      reason: bashResult.reason || undefined,
    },
    makeSessionKey("bash", command),
    confirm,
    store,
    pi,
    hasUI,
  );
}

/**
 * Register all permission guards on the pi extension API.
 *
 * For path-bearing tools (read, write, edit), the path and tool checks are
 * merged into a single decision point — both deny rules still apply, but at
 * most one confirmation dialog is shown (the path prompt already names the
 * tool, making a separate tool prompt redundant).
 *
 * For non-path-bearing tools, only the tool guard applies.
 *
 * The bash guard runs after, and only for the bash tool.
 */
export function registerGuards(
  pi: ExtensionAPI,
  config: ResolvedConfig,
  store: ApprovalCache,
): void {
  pi.on("tool_call", async (event, ctx) => {
    const confirm = makeConfirmFn(ctx);
    const toolName = event.toolName;

    const targetPath = extractPath(event);
    let block: ToolCallEventResult | undefined;

    if (targetPath !== undefined) {
      block = await runPathBearingChecks(
        targetPath,
        toolName,
        ctx.cwd,
        config,
        confirm,
        store,
        pi,
        ctx.hasUI,
      );
    } else {
      block = await runToolOnlyCheck(
        toolName,
        config,
        confirm,
        store,
        pi,
        ctx.hasUI,
      );
    }
    if (block) {
      return block;
    }

    if (toolName === "bash") {
      const bashEvent = event as BashToolCallEvent;
      block = await runBashCheck(
        bashEvent.input.command,
        config,
        confirm,
        store,
        pi,
        ctx.hasUI,
      );
      if (block) {
        return block;
      }
    }
  });
}
