/**
 * Permission confirmation dialog.
 *
 * Builds human-readable summaries for tool/bash/path permission requests
 * and prompts the user for an allow/deny decision via a provided confirm
 * function (abstracted from the TUI for testability).
 */

/** Details about the permission request to present to the user. */
export interface DialogDetails {
  toolName: string;
  category: "tool" | "bash" | "path";
  summary: string; // human-readable description of what's being requested
  reason?: string; // from arbiter stderr or matched rule
}

/** A confirm function — resolves true for allow, false for deny. */
export type ConfirmFn = (message: string) => Promise<boolean>;

/**
 * Build a human-readable message for the permission prompt.
 */
function buildMessage(details: DialogDetails): string {
  const lines: string[] = [];

  switch (details.category) {
    case "bash":
      lines.push(`Agent wants to run: ${details.summary}`);
      break;
    case "path":
      lines.push(
        `Agent wants to use ${details.toolName} on: ${details.summary}`,
      );
      break;
    case "tool":
      lines.push(`Agent wants to call: ${details.toolName}`);
      break;
  }

  if (details.reason) {
    lines.push(`Reason: ${details.reason}`);
  }

  lines.push("Allow this call?");
  return lines.join("\n");
}

/**
 * Prompt the user for permission.
 *
 * @param confirm - A function that shows a confirmation dialog and returns
 *   true for allow, false for deny.
 * @param details - What the agent wants to do.
 * @returns "allow" if the user confirmed, "deny" otherwise.
 */
export async function promptPermission(
  confirm: ConfirmFn,
  details: DialogDetails,
): Promise<"allow" | "deny"> {
  const message = buildMessage(details);
  const allowed = await confirm(message);
  return allowed ? "allow" : "deny";
}
