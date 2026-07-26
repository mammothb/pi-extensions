/**
 * Wrap a command in a bubblewrap sandbox for process-level isolation.
 *
 * When `agent.sandbox` is true, the child `pi -p` process runs inside a
 * Linux namespace sandbox managed by `bw` (the bubblewrap CLI from
 * @mammothb/bw). This provides filesystem isolation, optional network
 * isolation, and defense-in-depth beyond tool-level permission gating.
 *
 * Security: `bw` (crates/bw) is the sandbox implementation — it builds
 * the full bwrap argument list with `--unshare-*` namespace flags, bind
 * mounts, `--clearenv`, and optional `--unshare-net`. This function is a
 * thin dispatch shim; all sandbox policy lives in the Rust binary.
 * NOSONAR — S6432 (false positive: sandbox flags are in crates/bw/src/binds.rs)
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
