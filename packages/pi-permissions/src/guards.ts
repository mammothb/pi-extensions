import type {
  BashToolCallEvent,
  EditToolCallEvent,
  ExtensionAPI,
  ReadToolCallEvent,
  ToolCallEvent,
  ToolCallEventResult,
  WriteToolCallEvent,
} from "@earendil-works/pi-coding-agent";
import {
  promptPermission,
  type ConfirmFn,
  type DialogDetails,
} from "./lib/dialog.js";
import { checkBash, checkPath, checkTool } from "./engine.js";
import type { ApprovalCache } from "./lib/approval-cache.js";
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
): Promise<ToolCallEventResult | undefined> {
  // Check session store first
  const stored = store.get(storeKey);
  if (stored === "deny") {
    return { block: true, reason: "Permission denied (cached)" };
  }
  if (stored === "allow") {
    return; // proceed
  }

  // Prompt the user via the shared dialog module
  const decision = await promptPermission(confirm, details);
  store.set(storeKey, decision);

  if (decision === "deny") {
    return { block: true, reason: "Permission denied by user" };
  }
  // allowed — proceed
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
    // Build a confirm function from the TUI context (null-safe for headless mode)
    const confirm: ConfirmFn = async (message) => {
      if (!ctx.hasUI) {
        return false; // headless mode — deny by default
      }
      return ctx.ui.confirm("Permission Required", message) ?? false;
    };

    const toolName = event.toolName;

    // --- Path-bearing tools (read, write, edit): merge path + tool checks ---
    const targetPath = extractPath(event);
    if (targetPath !== undefined) {
      const pathResult = checkPath(targetPath, ctx.cwd, config);
      const toolResult = checkTool(toolName, config);

      // Deny from either check short-circuits
      if (pathResult.action === "deny") {
        return {
          block: true,
          reason: `Permission denied: ${pathResult.reason}`,
        };
      }
      if (toolResult.action === "deny") {
        return {
          block: true,
          reason: `Permission denied: ${toolResult.reason}`,
        };
      }

      // Ask: at most one dialog. Prefer the path prompt — it already
      // names the tool and is more specific than a bare tool name.
      if (pathResult.action === "ask" || toolResult.action === "ask") {
        const details: DialogDetails =
          pathResult.action === "ask"
            ? {
                toolName,
                category: "path",
                summary: targetPath,
                reason: pathResult.matchedRule
                  ? `matched rule "${pathResult.matchedRule}"`
                  : undefined,
              }
            : {
                toolName,
                category: "tool",
                summary: "",
                reason: toolResult.matchedRule
                  ? `matched rule "${toolResult.matchedRule}"`
                  : undefined,
              };

        const block = await handleAsk(
          confirm,
          store,
          makeSessionKey(toolName, targetPath),
          details,
        );
        if (block) return block;
      }
    } else {
      // --- Non-path-bearing tools: only the tool guard applies ---
      const toolResult = checkTool(toolName, config);
      if (toolResult.action === "deny") {
        return {
          block: true,
          reason: `Permission denied: ${toolResult.reason}`,
        };
      }
      if (toolResult.action === "ask") {
        const details: DialogDetails = {
          toolName,
          category: "tool",
          summary: "",
          reason: toolResult.matchedRule
            ? `matched rule "${toolResult.matchedRule}"`
            : toolResult.reason,
        };

        const block = await handleAsk(
          confirm,
          store,
          makeSessionKey(toolName),
          details,
        );
        if (block) return block;
      }
    }

    // --- Bash guard (for bash tool only) ---
    if (toolName === "bash") {
      const bashEvent = event as BashToolCallEvent;
      const command = bashEvent.input.command;

      const bashResult = await checkBash(command, config);
      if (bashResult.action === "deny") {
        return {
          block: true,
          reason: `Permission denied: ${bashResult.reason}`,
        };
      }
      if (bashResult.action === "ask") {
        const details: DialogDetails = {
          toolName: "bash",
          category: "bash",
          summary: command,
          reason: bashResult.reason || undefined,
        };

        const block = await handleAsk(
          confirm,
          store,
          makeSessionKey("bash", command),
          details,
        );
        if (block) return block;
      }
    }
  });
}
