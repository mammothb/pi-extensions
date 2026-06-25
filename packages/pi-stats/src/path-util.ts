import * as fs from "node:fs";
import * as path from "node:path";

const GENERIC_ENTRY_DIRS = new Set([
  "src",
  "dist",
  "lib",
  "build",
  "out",
  "source",
]);

export function getExtNameFromPath(extPath: string): string | undefined {
  // node_modules package: take @scope/name or name
  const nodeModule = extPath.split(/[\\/]node_modules[\\/]/).pop();
  if (nodeModule && nodeModule !== extPath) {
    const parts = nodeModule.split(/[\\/]/);
    if (parts[0]?.startsWith("@") && parts[1]) {
      return `${parts[0]}/${parts[1]}`;
    }
    if (parts[0]) {
      return parts[0];
    }
  }
  // local extension file or dir: ~/.pi/agent/extensions/<name>(.ts|/index.ts)
  const match = extPath.match(
    /extensions[\\/]([^\\/]+?)(?:\.[tj]s)?(?:[\\/]index\.[tj]s)?$/,
  );
  if (match) {
    return match[1];
  }

  const base = path
    .basename(extPath)
    .replace(/\.[tj]s$/, "")
    .replace(/\.md$/, "");
  if (
    base === "index" ||
    base === "SKILL" ||
    GENERIC_ENTRY_DIRS.has(path.basename(path.dirname(extPath)))
  ) {
    return (
      getLocalEntryExtensionName(extPath) ??
      path.basename(path.dirname(extPath))
    );
  }
  return base;
}

export function getLocalEntryExtensionName(
  extPath: string,
): string | undefined {
  let dir = path.dirname(extPath);
  const pkgName = packageNameNear(dir);
  if (pkgName) {
    return pkgName;
  }

  while (true) {
    const base = path.basename(dir);
    if (base && base !== "." && !GENERIC_ENTRY_DIRS.has(base)) {
      return base;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      return undefined;
    }
    dir = parent;
  }
}

export function packageNameNear(startDir: string): string | undefined {
  let dir = path.resolve(startDir);
  while (true) {
    try {
      const pkg = JSON.parse(
        fs.readFileSync(path.join(dir, "package.json"), "utf8"),
      ) as { name?: unknown };
      if (typeof pkg.name === "string" && pkg.name.trim()) {
        return pkg.name.trim();
      }
    } catch {
      /* no readable package.json here */
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      return undefined;
    }
    dir = parent;
  }
}
