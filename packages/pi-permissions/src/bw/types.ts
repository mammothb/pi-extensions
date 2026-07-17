/** Sub-structure for bind-mount configuration. */
export interface BwBinds {
  ro?: string[];
  roTry?: string[];
  rw?: string[];
  /** Socket path, or null to disable. */
  docker?: string | null;
  wsl2?: {
    ro?: string[];
    roTry?: string[];
  };
}

/** bwrap option knobs. */
export interface BwOptions {
  clearenv?: boolean;
  env?: Record<string, string>;
  path?: string[];
  tmpfsSize?: string;
  unshareNet?: boolean;
  seccomp?: string;
}

/** Shape of a user-authored config file (global or workspace). */
export interface BwRawConfig {
  binds?: BwBinds;
  binds_extra?: BwBinds;
  options?: BwOptions;
}

/** Fully resolved, validated, path-expanded config — ready to turn into bwrap args. */
export interface BwResolvedConfig {
  binds: {
    ro: string[];
    roTry: string[];
    rw: string[];
    docker: string | null;
    wsl2: {
      ro: string[];
      roTry: string[];
    };
  };
  options: Required<Omit<BwOptions, "seccomp" | "env" | "path">> & {
    seccomp?: string;
    env: Record<string, string>;
    path: string[];
  };
}
