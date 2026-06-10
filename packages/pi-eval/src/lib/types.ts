export class EvalToolError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = "EvalToolError";
  }
}

export class EvalTimeoutError extends EvalToolError {
  constructor() {
    super("Evaluation cancelled or timed out after 30 seconds", "TIMEOUT");
  }
}

export class EvalCancelledError extends EvalToolError {
  constructor() {
    super("Evaluation cancelled", "CANCELLED");
  }
}

export class EvalBinaryNotFoundError extends EvalToolError {
  constructor(binary: string) {
    super(
      `Python binary not found or not executable: ${binary}`,
      "BINARY_NOT_FOUND",
    );
  }
}

export class EvalSpawnError extends EvalToolError {
  constructor(file: string, cause: string) {
    super(`Failed to spawn ${file}: ${cause}`, "SPAWN_FAILED");
  }
}

export class EvalUnsupportedLanguageError extends EvalToolError {
  constructor(language: string) {
    super(
      `Unsupported language: "${language}". Use "javascript" or "python".`,
      "UNSUPPORTED_LANGUAGE",
    );
  }
}

export class EvalCwdNotFoundError extends EvalToolError {
  constructor(cwd: string, reason?: string) {
    const detail = reason ? `: ${reason}` : "";
    super(
      `cwd does not exist or is not a directory: ${cwd}${detail}`,
      "CWD_NOT_FOUND",
    );
  }
}

export interface SubprocessResult {
  stdout: string;
  stderr: string;
  /** null when the process was killed by a signal rather than exiting normally */
  exitCode: number | null;
  exitSignal: string | null;
  truncated: boolean;
}

export interface EvalDetails {
  language: string;
  exitCode: number | null;
  exitSignal: string | null;
}
