import type { ExpansionResult, TriggerDefinition } from "./types.js";

/**
 * Build a <skill> XML block from a skill definition.
 * Follows the same format as Pi core's _expandSkillCommand().
 */
export function expandSkill(skill: TriggerDefinition): ExpansionResult {
  const content = `References are relative to ${skill.baseDir}.\n\n${skill.content}`;
  const block = `<skill name="${skill.name}" location="${skill.filePath}">\n${content}\n</skill>`;

  return {
    definition: skill,
    content,
    block,
  };
}

/**
 * Build a <prompt> XML block from a prompt template definition.
 * Applies argument substitution if args are provided.
 */
export function expandPrompt(
  prompt: TriggerDefinition,
  args?: string,
): ExpansionResult {
  const content = substituteArgs(prompt.content, args ?? "");

  const block = `<prompt name="${prompt.name}" location="${prompt.filePath}">\n${content}\n</prompt>`;

  return {
    definition: prompt,
    content,
    block,
  };
}

/**
 * Substitute positional argument placeholders in template content.
 * Ported from Pi core's prompt-templates.ts substituteArgs().
 * Supports $1, $2, ..., $@, $ARGUMENTS, ${N:-default}, ${@:N}, ${@:N:L}
 */
function substituteArgs(content: string, argsString: string): string {
  const args = parseArgs(argsString);
  const allArgs = args.join(" ");

  return content.replace(
    /\$\{(\d+):-([^}]*)\}|\$\{@:(\d+)(?::(\d+))?\}|\$(ARGUMENTS|@|\d+)/g,
    (_match, defaultNum, defaultValue, sliceStart, sliceLength, simple) => {
      if (defaultNum) {
        const index = parseInt(defaultNum, 10) - 1;
        const value = args[index];
        return value ? value : defaultValue;
      }
      if (sliceStart) {
        let start = parseInt(sliceStart, 10) - 1;
        if (start < 0) {
          start = 0;
        }
        if (sliceLength) {
          const length = parseInt(sliceLength, 10);
          return args.slice(start, start + length).join(" ");
        }
        return args.slice(start).join(" ");
      }
      if (simple === "ARGUMENTS" || simple === "@") {
        return allArgs;
      }
      const index = parseInt(simple, 10) - 1;
      return args[index] ?? "";
    },
  );
}

/** Parse space-delimited args, respecting quoted strings. */
function parseArgs(argsString: string): string[] {
  const args: string[] = [];
  let current = "";
  let inQuote: string | null = null;

  for (const char of argsString) {
    if (inQuote) {
      if (char === inQuote) {
        inQuote = null;
      } else {
        current += char;
      }
    } else if (char === '"' || char === "'") {
      inQuote = char;
    } else if (/\s/.test(char)) {
      if (current) {
        args.push(current);
        current = "";
      }
    } else {
      current += char;
    }
  }

  if (current) {
    args.push(current);
  }
  return args;
}
