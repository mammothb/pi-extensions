/** A parsed trigger token from the user's input text. */
export interface TriggerToken {
  /** Namespace: "skill" or "prompt". */
  namespace: "skill" | "prompt";
  /** The name after the colon, e.g. "plan" from /prompt:plan. */
  name: string;
  /** Raw matched text, e.g. "/prompt:plan". */
  raw: string;
  /** Start index in the original text. */
  start: number;
  /** End index in the original text (start + raw.length). */
  end: number;
}

/** A loaded and parsed trigger definition (skill or prompt template). */
export interface TriggerDefinition {
  namespace: "skill" | "prompt";
  name: string;
  content: string;
  filePath: string;
  baseDir: string;
}

/** Result of scanning input text for trigger tokens. */
export interface ScanResult {
  tokens: TriggerToken[];
}

/** Content prepared for injection as a custom message. */
export interface ExpansionResult {
  definition: TriggerDefinition;
  /** The content to inject (body only, no frontmatter, with context wrapper). */
  content: string;
  /** The full <skill> or <prompt> XML block. */
  block: string;
}
