/**
 * Atomic file writes for crash safety.
 *
 * Writes to a temp file in the same directory, then atomically renames
 * over the target. Resolves symlink chains so the real target file is
 * updated (symlink preserved). Preserves file permissions.
 */

import { randomBytes } from "node:crypto";
import {
  chmod,
  mkdir,
  realpath,
  rename,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, resolve } from "node:path";

/**
 * Write content to `targetPath` atomically.
 *
 * 1. Resolve symlink chain → canonical target
 * 2. Write to `<target>.pi-tmp-<random>` in same directory
 * 3. Preserve original permissions (or default 0o644)
 * 4. `rename(tmp, target)` — atomic on same filesystem
 */
export async function writeFileAtomically(
  targetPath: string,
  content: string,
): Promise<void> {
  // Resolve symlinks to the real target.
  const realTarget = await resolveRealPath(targetPath);

  // Ensure parent directory exists.
  await mkdir(dirname(realTarget), { recursive: true });

  // Generate unique temp path in same directory.
  const tmpPath = `${realTarget}.pi-tmp-${randomBytes(4).toString("hex")}`;

  // Capture original permissions if the file already exists.
  let mode = 0o644;
  try {
    const st = await stat(realTarget);
    mode = st.mode & 0o777;
  } catch {
    // File doesn't exist yet — use default.
  }

  // Write to temp file.
  await writeFile(tmpPath, content, "utf-8");

  // Match permissions.
  await chmod(tmpPath, mode);

  // Atomic rename.
  await rename(tmpPath, realTarget);
}

/**
 * Resolve the real path of a file, following symlinks.
 * Returns the absolute canonical path (no symlinks).
 */
async function resolveRealPath(filePath: string): Promise<string> {
  const absolute = resolve(filePath);
  try {
    return await realpath(absolute);
  } catch {
    // File doesn't exist or can't be resolved — use the absolute path.
    // Parent directory must exist for the write to succeed later.
    return absolute;
  }
}
