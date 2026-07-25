/**
 * Wrap a command in a bubblewrap sandbox for process-level isolation.
 *
 * When `agent.sandbox` is true, the child `pi -p` process runs inside a
 * Linux namespace sandbox managed by `bw` (the bubblewrap CLI from
 * @mammothb/bw). This provides filesystem isolation, optional network
 * isolation, and defense-in-depth beyond tool-level permission gating.
 */
export function wrapWithBubblewrap(
  command: string,
  args: string[],
): { command: string; args: string[] } {
  return {
    command: "bw",
    args: ["--", command, ...args],
  };
}
