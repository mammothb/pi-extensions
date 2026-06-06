import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Expand a leading tilde (~ or ~/) in a filepath to the user's home directory.
 * Returns the filepath unchanged if it doesn't start with a tilde.
 */
export function expandTilde(filepath: string): string {
  if (filepath.startsWith("~/") || filepath === "~") {
    return join(homedir(), filepath.slice(1));
  }
  return filepath;
}
