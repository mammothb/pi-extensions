import type { AutocompleteProviderFactory } from "@earendil-works/pi-coding-agent";
import type {
  AutocompleteItem,
  AutocompleteProvider,
} from "@earendil-works/pi-tui";
import { fuzzyFilter } from "@earendil-works/pi-tui";
import type { TriggerDefinition } from "./types.js";

/** Matches #skill: or #prompt: with optional partial name at end of text-before-cursor. */
const TOKEN_RE = /#(skill|prompt):([A-Za-z0-9._-]*)$/;

interface TriggerStore {
  skills: Map<string, TriggerDefinition>;
  prompts: Map<string, TriggerDefinition>;
}

function extractDescription(content: string): string {
  const firstLine =
    content
      .split("\n")[0]
      ?.replace(/^#+\s*/, "")
      .trim() ?? "";
  return firstLine.length > 80 ? `${firstLine.slice(0, 77)}...` : firstLine;
}

function toAutocompleteItems(
  prefixChar: string,
  namespace: "skill" | "prompt",
  defs: Map<string, TriggerDefinition>,
): AutocompleteItem[] {
  return [...defs.values()].map((def) => ({
    value: `${prefixChar}${namespace}:${def.name}`,
    label: def.name,
    description: extractDescription(def.content) || undefined,
  }));
}

/**
 * Create an AutocompleteProviderFactory that adds mid-text /skill:name
 * and /prompt:name completion. Tokens at the start of input (or after
 * only whitespace) are delegated to pi core's slash-command handler.
 */
export function createAutocompleteProviderFactory(
  store: TriggerStore,
): AutocompleteProviderFactory {
  return (current: AutocompleteProvider): AutocompleteProvider => ({
    triggerCharacters: current.triggerCharacters,

    async getSuggestions(lines, cursorLine, cursorCol, options) {
      const textBeforeCursor = (lines[cursorLine] ?? "").slice(0, cursorCol);
      const match = TOKEN_RE.exec(textBeforeCursor);

      if (!match) {
        return current.getSuggestions(lines, cursorLine, cursorCol, options);
      }

      const prefixChar = "#";
      const namespace = match[1] as "skill" | "prompt";
      const partial = match[2] ?? "";
      const map = namespace === "skill" ? store.skills : store.prompts;

      if (map.size === 0) {
        return null;
      }

      const items = toAutocompleteItems(prefixChar, namespace, map);
      const filtered = fuzzyFilter(items, partial, (item) => item.label);

      if (filtered.length === 0) {
        return null;
      }

      return { items: filtered, prefix: match[0] };
    },

    applyCompletion(lines, cursorLine, cursorCol, item, prefix) {
      // Only intercept trigger-token completions (/skill:name, /prompt:name).
      // Delegate everything else (slash commands, file paths, etc.) to the
      // wrapped provider — it handles slash-command "/" insertion correctly.
      if (!/^#(?:skill|prompt):/.test(prefix)) {
        return current.applyCompletion(
          lines,
          cursorLine,
          cursorCol,
          item,
          prefix,
        );
      }

      const currentLine = lines[cursorLine] ?? "";
      const prefixStart = cursorCol - prefix.length;
      const beforePrefix = currentLine.slice(0, prefixStart);
      const afterCursor = currentLine.slice(cursorCol);

      const newLine = `${beforePrefix}${item.value} ${afterCursor}`;
      const newLines = [...lines];
      newLines[cursorLine] = newLine;

      return {
        lines: newLines,
        cursorLine,
        cursorCol: prefixStart + item.value.length + 1, // +1 for trailing space
      };
    },

    shouldTriggerFileCompletion: current.shouldTriggerFileCompletion
      ? current.shouldTriggerFileCompletion.bind(current)
      : undefined,
  });
}
