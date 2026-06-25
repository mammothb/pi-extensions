import type { UsageStats } from "./tracker.js";

export function formatStats(stats: UsageStats): string {
  const entries = Object.entries(stats.extensions).sort((a, b) => b[1] - a[1]);

  if (entries.length === 0) {
    return "_No extension usage yet_";
  }

  return entries.map(([name, count]) => `- \`${name}\`: ${count}`).join("\n");
}
