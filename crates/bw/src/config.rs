use std::path::{Path, PathBuf};

use anyhow::{Context, Result};

use crate::defaults::default_config;
use crate::types::{
    BindKind, BwBinds, BwOptions, BwRawConfig, BwResolvedConfig, DockerConfig, ResolvedBinds,
    ResolvedOptions, ResolvedWsl2Binds, ValidationError,
};

/// Load, merge, expand, and validate config: default → global → workspace.
pub fn load_config(cwd: &Path) -> Result<BwResolvedConfig> {
    let global_path = global_config_path();
    let workspace_path = cwd.join(".pi").join("bw.json");
    load_and_resolve(&global_path, &workspace_path, cwd)
}

/// Full pipeline (merge + expand + validate) with explicit paths for testing.
fn load_and_resolve(
    global_path: &Path,
    workspace_path: &Path,
    cwd: &Path,
) -> Result<BwResolvedConfig> {
    let raw = load_config_from(global_path, workspace_path)?;
    let mut resolved = raw_to_resolved(raw);
    expand_paths(&mut resolved, cwd)?;
    validate(&resolved)?;
    crate::wsl2::apply_wsl2(&mut resolved);
    Ok(resolved)
}

/// Load and merge from explicit file paths (testable without env vars).
/// Returns the merged but unexpanded config.
pub(crate) fn load_config_from(global_path: &Path, workspace_path: &Path) -> Result<BwRawConfig> {
    let mut acc = default_config();

    if let Some(global) = load_layer(global_path)? {
        apply_layer(&mut acc, &global);
    }
    if let Some(workspace) = load_layer(workspace_path)? {
        apply_layer(&mut acc, &workspace);
    }

    Ok(acc)
}

/// Read and deserialize a JSON config file. Returns `Ok(None)` if the file
/// does not exist.
fn load_layer(path: &Path) -> Result<Option<BwRawConfig>> {
    if !path.exists() {
        return Ok(None);
    }
    let text = fs_err::read_to_string(path)
        .with_context(|| format!("failed to read config: {}", path.display()))?;
    let cfg: BwRawConfig = serde_json::from_str(&text)
        .with_context(|| format!("invalid config: {}", path.display()))?;
    Ok(Some(cfg))
}

/// Compute the global config path: `$XDG_CONFIG_HOME/bw/config.json` or
/// `$HOME/.config/bw/config.json`.
fn global_config_path() -> PathBuf {
    if let Ok(base) = std::env::var("XDG_CONFIG_HOME") {
        PathBuf::from(base).join("bw").join("config.json")
    } else {
        let home = std::env::var("HOME").unwrap_or_default();
        PathBuf::from(home)
            .join(".config")
            .join("bw")
            .join("config.json")
    }
}

/// Apply a single config layer on top of the accumulator.
///
/// `binds` fully replaces accumulated binds. `binds_extra` merges on top.
/// `options` shallow-merges (with `env` merged key-by-key).
fn apply_layer(acc: &mut BwRawConfig, layer: &BwRawConfig) {
    // binds: full replace
    if let Some(ref binds) = layer.binds {
        acc.binds = Some(binds.clone());
    }
    // binds_extra: merge on top
    if let Some(ref binds_extra) = layer.binds_extra {
        let acc_binds = acc.binds.get_or_insert_with(BwBinds::default);
        merge_binds_into(acc_binds, binds_extra);
    }
    // options: shallow merge
    if let Some(ref opts) = layer.options {
        let acc_opts = acc.options.get_or_insert_with(BwOptions::default);
        merge_options_into(acc_opts, opts);
    }
}

/// Merge source binds into target (concatenate arrays, replace docker,
/// merge wsl2).
fn merge_binds_into(target: &mut BwBinds, source: &BwBinds) {
    target.ro.extend(source.ro.iter().cloned());
    target.ro_try.extend(source.ro_try.iter().cloned());
    target.rw.extend(source.rw.iter().cloned());

    if source.docker.is_some() {
        target.docker = source.docker.clone();
    }

    target.wsl2.ro.extend(source.wsl2.ro.iter().cloned());
    target
        .wsl2
        .ro_try
        .extend(source.wsl2.ro_try.iter().cloned());
}

/// Shallow-merge source options into target. `env` is merged key-by-key;
/// other fields are overridden if present in source.
fn merge_options_into(target: &mut BwOptions, source: &BwOptions) {
    target.clearenv = source.clearenv;
    for (k, v) in &source.env {
        target.env.insert(k.clone(), v.clone());
    }
    if !source.path.is_empty() {
        target.path.clone_from(&source.path);
    }
    target.unshare_net = source.unshare_net;
}

// ============================
// Path resolution & validation
// ============================

/// Convert merged raw config into resolved form (string paths → PathBuf).
fn raw_to_resolved(raw: BwRawConfig) -> BwResolvedConfig {
    let binds_raw = raw.binds.unwrap_or_default();
    let opts_raw = raw.options.unwrap_or_default();

    let docker = binds_raw.docker.map(|d| match d {
        DockerConfig::Disabled => None,
        DockerConfig::Enabled(p) => Some(PathBuf::from(p)),
    });
    // docker: None (not configured) → None (disabled).
    // If the user used `binds` (full replace) and omitted docker, it's disabled.
    let docker = docker.unwrap_or(None);

    BwResolvedConfig {
        binds: ResolvedBinds {
            ro: binds_raw.ro.into_iter().map(PathBuf::from).collect(),
            ro_try: binds_raw.ro_try.into_iter().map(PathBuf::from).collect(),
            rw: binds_raw.rw.into_iter().map(PathBuf::from).collect(),
            docker,
            wsl2: ResolvedWsl2Binds {
                ro: binds_raw.wsl2.ro.into_iter().map(PathBuf::from).collect(),
                ro_try: binds_raw
                    .wsl2
                    .ro_try
                    .into_iter()
                    .map(PathBuf::from)
                    .collect(),
            },
        },
        options: ResolvedOptions {
            clearenv: opts_raw.clearenv,
            env: opts_raw.env,
            path: opts_raw.path.into_iter().map(PathBuf::from).collect(),
            unshare_net: opts_raw.unshare_net,
        },
    }
}

/// Expand `~` and resolve relative paths in place.
fn expand_paths(config: &mut BwResolvedConfig, cwd: &Path) -> Result<()> {
    for p in &mut config.binds.ro {
        *p = resolve_path(p, cwd)?;
    }
    for p in &mut config.binds.ro_try {
        *p = resolve_path(p, cwd)?;
    }
    for p in &mut config.binds.rw {
        *p = resolve_path(p, cwd)?;
    }
    if let Some(ref p) = config.binds.docker {
        config.binds.docker = Some(resolve_path(p, cwd)?);
    }
    for p in &mut config.binds.wsl2.ro {
        *p = resolve_path(p, cwd)?;
    }
    for p in &mut config.binds.wsl2.ro_try {
        *p = resolve_path(p, cwd)?;
    }
    for p in &mut config.options.path {
        *p = resolve_path(p, cwd)?;
    }
    Ok(())
}

/// Expand `~` and resolve relative paths against `cwd`.
fn resolve_path(raw: &Path, cwd: &Path) -> Result<PathBuf> {
    let raw_str = raw.to_string_lossy();
    let expanded = shellexpand::full(&raw_str)
        .with_context(|| format!("failed to expand path: {}", raw.display()))?;
    let path = Path::new(expanded.as_ref());
    if path.is_absolute() {
        Ok(path.to_path_buf())
    } else {
        Ok(cwd.join(path))
    }
}

/// Check that required bind paths exist. `ro_try` paths are intentionally
/// not validated — they may legitimately be absent.
fn validate(config: &BwResolvedConfig) -> Result<()> {
    let mut errors: Vec<ValidationError> = Vec::new();

    for (i, p) in config.binds.ro.iter().enumerate() {
        if !p.exists() {
            errors.push(ValidationError {
                path: p.clone(),
                kind: BindKind::Ro,
                index: i,
            });
        }
    }
    for (i, p) in config.binds.rw.iter().enumerate() {
        if !p.exists() {
            errors.push(ValidationError {
                path: p.clone(),
                kind: BindKind::Rw,
                index: i,
            });
        }
    }
    if let Some(ref p) = config.binds.docker
        && !p.exists()
    {
        errors.push(ValidationError {
            path: p.clone(),
            kind: BindKind::Rw,
            index: 0,
        });
    }

    if errors.is_empty() {
        return Ok(());
    }

    let mut msg = String::from("path(s) not found:");
    for e in &errors {
        msg.push_str(&format!(
            "\n  {} (binds.{}[{}])",
            e.path.display(),
            e.kind,
            e.index
        ));
    }
    Err(anyhow::anyhow!("{msg}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use rstest::{fixture, rstest};
    use std::io::Write;
    use tempfile::{TempDir, tempdir};

    #[fixture]
    fn dir() -> TempDir {
        tempdir().unwrap()
    }

    /// Write a JSON config file in `dir` and return its path.
    fn write_config(dir: &TempDir, name: &str, json: &str) -> PathBuf {
        let path = dir.path().join(name);
        let mut f = fs_err::File::create(&path).unwrap();
        f.write_all(json.as_bytes()).unwrap();
        path
    }

    // ==========
    // load_layer
    // ==========

    #[rstest]
    fn load_layer_missing_file(dir: TempDir) {
        let path = dir.path().join("nonexistent.json");
        let result = load_layer(&path).unwrap();
        assert!(result.is_none());
    }

    #[rstest]
    fn load_layer_valid_json(dir: TempDir) {
        let path = write_config(&dir, "cfg.json", r#"{"binds": {"ro": ["/a"]}}"#);
        let result = load_layer(&path).unwrap().unwrap();
        assert_eq!(result.binds.unwrap().ro, vec!["/a"]);
    }

    #[rstest]
    fn load_layer_malformed_json_is_error(dir: TempDir) {
        let path = write_config(&dir, "cfg.json", "not json");
        let result = load_layer(&path);
        assert!(result.is_err());
    }

    // ====================
    // merge: defaults only
    // ====================

    #[rstest]
    fn defaults_only(dir: TempDir) {
        let cfg = load_config_from(
            &dir.path().join("nonexistent-global.json"),
            &dir.path().join("nonexistent-workspace.json"),
        )
        .unwrap();

        let binds = cfg.binds.unwrap();
        // System ro paths from the default config
        assert!(binds.ro.contains(&"/bin".to_string()));
        assert!(binds.ro.contains(&"/usr".to_string()));
        // User rw paths
        assert!(binds.rw.contains(&"~/.cache".to_string()));
        // Options
        let opts = cfg.options.unwrap();
        assert!(opts.clearenv);
    }

    // ===========================
    // merge: binds (full replace)
    // ===========================

    #[rstest]
    fn global_binds_replaces_defaults(dir: TempDir) {
        let global = write_config(
            &dir,
            "global.json",
            r#"{"binds": {"ro": ["/custom"], "rw": ["/custom-rw"]}}"#,
        );

        let cfg = load_config_from(&global, &dir.path().join("no-workspace.json")).unwrap();
        let binds = cfg.binds.unwrap();

        // Default ro ("/bin", "/usr", ...) discarded — only "/custom" remains
        assert_eq!(binds.ro, vec!["/custom"]);
        // Default rw ("~/.cache", ...) discarded
        assert_eq!(binds.rw, vec!["/custom-rw"]);
    }

    #[rstest]
    fn workspace_binds_replaces_all(dir: TempDir) {
        let global = write_config(
            &dir,
            "global.json",
            r#"{"binds_extra": {"ro": ["/from-global"]}}"#,
        );
        let workspace = write_config(
            &dir,
            "workspace.json",
            r#"{"binds": {"ro": ["/from-workspace-only"]}}"#,
        );

        let cfg = load_config_from(&global, &workspace).unwrap();
        let binds = cfg.binds.unwrap();

        // Global binds_extra was discarded because workspace used `binds` (full replace)
        assert_eq!(binds.ro, vec!["/from-workspace-only"]);
    }

    // ===========================
    // merge: binds_extra (append)
    // ===========================

    #[rstest]
    fn global_binds_extra_appends(dir: TempDir) {
        let global = write_config(
            &dir,
            "global.json",
            r#"{"binds_extra": {"ro": ["/extra"]}}"#,
        );

        let cfg = load_config_from(&global, &dir.path().join("no-workspace.json")).unwrap();
        let binds = cfg.binds.unwrap();

        // Default ro paths PLUS "/extra"
        assert!(binds.ro.contains(&"/bin".to_string()));
        assert!(binds.ro.contains(&"/usr".to_string()));
        assert!(binds.ro.contains(&"/extra".to_string()));
    }

    #[rstest]
    fn workspace_binds_extra_merges_on_top(dir: TempDir) {
        let global = write_config(
            &dir,
            "global.json",
            r#"{"binds_extra": {"ro": ["/from-global"]}}"#,
        );
        let workspace = write_config(
            &dir,
            "workspace.json",
            r#"{"binds_extra": {"ro": ["/from-workspace"]}}"#,
        );

        let cfg = load_config_from(&global, &workspace).unwrap();
        let binds = cfg.binds.unwrap();

        // All three layers: defaults + global + workspace
        assert!(binds.ro.contains(&"/bin".to_string())); // default
        assert!(binds.ro.contains(&"/from-global".to_string()));
        assert!(binds.ro.contains(&"/from-workspace".to_string()));
        // Order: defaults first, then global, then workspace
        let pos_default = binds.ro.iter().position(|p| p == "/bin").unwrap();
        let pos_global = binds.ro.iter().position(|p| p == "/from-global").unwrap();
        let pos_workspace = binds
            .ro
            .iter()
            .position(|p| p == "/from-workspace")
            .unwrap();
        assert!(pos_default < pos_global);
        assert!(pos_global < pos_workspace);
    }

    // ===========================================
    // merge: binds then binds_extra in same layer
    // ===========================================

    #[rstest]
    fn binds_then_binds_extra_same_layer(dir: TempDir) {
        // Single file with both binds (replace lower) and binds_extra (merge on top)
        let global = write_config(
            &dir,
            "global.json",
            r#"{
                "binds": {"ro": ["/replaced"]},
                "binds_extra": {"ro": ["/merged"]}
            }"#,
        );

        let cfg = load_config_from(&global, &dir.path().join("no-workspace.json")).unwrap();
        let binds = cfg.binds.unwrap();

        // binds replaced defaults → only "/replaced", then binds_extra appended "/merged"
        assert_eq!(binds.ro, vec!["/replaced", "/merged"]);
    }

    // =============
    // merge: docker
    // =============

    #[rstest]
    fn docker_null_disables(dir: TempDir) {
        let global = write_config(&dir, "global.json", r#"{"binds": {"docker": null}}"#);

        let cfg = load_config_from(&global, &dir.path().join("no-workspace.json")).unwrap();
        let binds = cfg.binds.unwrap();

        assert_eq!(binds.docker, Some(crate::types::DockerConfig::Disabled));
    }

    #[rstest]
    fn docker_path_overrides(dir: TempDir) {
        let workspace = write_config(
            &dir,
            "workspace.json",
            r#"{"binds_extra": {"docker": "/custom/sock"}}"#,
        );

        let cfg = load_config_from(&dir.path().join("no-global.json"), &workspace).unwrap();
        let binds = cfg.binds.unwrap();

        assert_eq!(
            binds.docker,
            Some(crate::types::DockerConfig::Enabled("/custom/sock".into()))
        );
    }

    #[rstest]
    fn docker_absent_preserves_default(dir: TempDir) {
        let cfg = load_config_from(
            &dir.path().join("no-global.json"),
            &dir.path().join("no-workspace.json"),
        )
        .unwrap();
        let binds = cfg.binds.unwrap();

        // Default docker is still set (not disabled)
        assert!(binds.docker.is_some());
        assert!(matches!(
            binds.docker,
            Some(crate::types::DockerConfig::Enabled(_))
        ));
    }

    // ===========
    // merge: wsl2
    // ===========

    #[rstest]
    fn wsl2_shallow_merge(dir: TempDir) {
        let global = write_config(
            &dir,
            "global.json",
            r#"{"binds_extra": {"wsl2": {"ro": ["/init"]}}}"#,
        );

        let cfg = load_config_from(&global, &dir.path().join("no-workspace.json")).unwrap();
        let binds = cfg.binds.unwrap();

        assert_eq!(binds.wsl2.ro, vec!["/init"]);
        // ro_try untouched (still default empty)
        assert!(binds.wsl2.ro_try.is_empty());
    }

    // ==============
    // merge: options
    // ==============

    #[rstest]
    fn options_shallow_merge(dir: TempDir) {
        let workspace = write_config(
            &dir,
            "workspace.json",
            r#"{"options": {"clearenv": false}}"#,
        );

        let cfg = load_config_from(&dir.path().join("no-global.json"), &workspace).unwrap();
        let opts = cfg.options.unwrap();

        // Overridden by workspace
        assert!(!opts.clearenv);
        // Still default
        assert!(opts.env.is_empty());
        assert!(opts.path.is_empty());
        assert!(!opts.unshare_net);
    }

    #[rstest]
    fn options_env_merges_key_by_key(dir: TempDir) {
        let global = write_config(&dir, "global.json", r#"{"options": {"env": {"A": "1"}}}"#);
        let workspace = write_config(
            &dir,
            "workspace.json",
            r#"{"options": {"env": {"B": "2"}}}"#,
        );

        let cfg = load_config_from(&global, &workspace).unwrap();
        let opts = cfg.options.unwrap();

        assert_eq!(opts.env.get("A").map(String::as_str), Some("1"));
        assert_eq!(opts.env.get("B").map(String::as_str), Some("2"));
    }

    #[rstest]
    fn options_env_override(dir: TempDir) {
        let global = write_config(&dir, "global.json", r#"{"options": {"env": {"A": "1"}}}"#);
        let workspace = write_config(
            &dir,
            "workspace.json",
            r#"{"options": {"env": {"A": "2"}}}"#,
        );

        let cfg = load_config_from(&global, &workspace).unwrap();
        let opts = cfg.options.unwrap();

        // Workspace overrides global for same key
        assert_eq!(opts.env.get("A").map(String::as_str), Some("2"));
    }

    // ====================
    // merge: missing files
    // ====================

    #[rstest]
    #[case::global_missing("global")]
    #[case::workspace_missing("workspace")]
    fn missing_layer_is_ok(#[case] which: &str, dir: TempDir) {
        let (global_path, workspace_path) = match which {
            "global" => {
                let ws = write_config(
                    &dir,
                    "workspace.json",
                    r#"{"binds_extra": {"ro": ["/from-workspace"]}}"#,
                );
                (dir.path().join("no-global.json"), ws)
            }
            _ => {
                let gl = write_config(
                    &dir,
                    "global.json",
                    r#"{"binds_extra": {"ro": ["/from-global"]}}"#,
                );
                (gl, dir.path().join("no-workspace.json"))
            }
        };

        let cfg = load_config_from(&global_path, &workspace_path).unwrap();
        let binds = cfg.binds.unwrap();
        // Defaults still present
        assert!(binds.ro.contains(&"/bin".to_string()));
        // Layer-specific path present
        let expected = if which == "global" {
            "/from-workspace"
        } else {
            "/from-global"
        };
        assert!(binds.ro.contains(&expected.to_string()));
    }

    // ================
    // merge: malformed
    // ================

    #[rstest]
    #[case::global("global")]
    #[case::workspace("workspace")]
    fn malformed_layer_is_error(#[case] which: &str, dir: TempDir) {
        let (global_path, workspace_path) = match which {
            "global" => (
                write_config(&dir, "global.json", "not json"),
                dir.path().join("no-workspace.json"),
            ),
            _ => (
                dir.path().join("no-global.json"),
                write_config(&dir, "workspace.json", "not json"),
            ),
        };
        let result = load_config_from(&global_path, &workspace_path);
        assert!(result.is_err());
    }

    // ===========
    // path_expand
    // ===========

    #[rstest]
    fn tilde_expands_to_home() {
        // HOME is always set in dev/CI — just verify tilde resolves somewhere.
        let raw = Path::new("~/something");
        let result = resolve_path(raw, Path::new("/cwd")).unwrap();
        let home = std::env::var("HOME").unwrap();
        assert!(result.starts_with(&home));
        assert!(result.ends_with("something"));
    }

    #[rstest]
    fn relative_resolves_to_cwd(dir: TempDir) {
        let sub = dir.path().join("sub");
        fs_err::create_dir_all(&sub).unwrap();

        let global = write_config(&dir, "global.json", r#"{"binds": {"rw": ["./sub"]}}"#);

        let raw = load_config_from(&global, &dir.path().join("no-workspace.json")).unwrap();
        let mut resolved = raw_to_resolved(raw);
        expand_paths(&mut resolved, dir.path()).unwrap();

        assert_eq!(resolved.binds.rw[0], sub);
    }

    #[rstest]
    fn absolute_passes_through(dir: TempDir) {
        let global = write_config(&dir, "global.json", r#"{"binds": {"ro": ["/usr"]}}"#);

        let raw = load_config_from(&global, &dir.path().join("no-workspace.json")).unwrap();
        let mut resolved = raw_to_resolved(raw);
        expand_paths(&mut resolved, dir.path()).unwrap();

        assert_eq!(resolved.binds.ro[0], PathBuf::from("/usr"));
    }

    #[rstest]
    fn expand_paths_touches_all_fields(dir: TempDir) {
        // Create a minimal config with a path in each bind category
        let ro_dir = dir.path().join("ro_dir");
        let ro_try_dir = dir.path().join("ro_try_dir");
        let rw_dir = dir.path().join("rw_dir");
        let wsl2_ro = dir.path().join("wsl2_ro");
        let wsl2_ro_try = dir.path().join("wsl2_ro_try");
        let path_dir = dir.path().join("path_dir");
        fs_err::create_dir_all(&ro_dir).unwrap();
        fs_err::create_dir_all(&ro_try_dir).unwrap();
        fs_err::create_dir_all(&rw_dir).unwrap();
        fs_err::create_dir_all(&wsl2_ro).unwrap();
        fs_err::create_dir_all(&wsl2_ro_try).unwrap();
        fs_err::create_dir_all(&path_dir).unwrap();

        let global = write_config(
            &dir,
            "global.json",
            &format!(
                r#"{{
                    "binds": {{
                        "ro": ["{ro_dir}"],
                        "ro_try": ["{ro_try_dir}"],
                        "rw": ["{rw_dir}"],
                        "wsl2": {{
                            "ro": ["{wsl2_ro}"],
                            "ro_try": ["{wsl2_ro_try}"]
                        }}
                    }},
                    "options": {{"path": ["{path_dir}"]}}
                }}"#,
                ro_dir = ro_dir.display(),
                ro_try_dir = ro_try_dir.display(),
                rw_dir = rw_dir.display(),
                wsl2_ro = wsl2_ro.display(),
                wsl2_ro_try = wsl2_ro_try.display(),
                path_dir = path_dir.display(),
            ),
        );

        let raw = load_config_from(&global, &dir.path().join("no-workspace.json")).unwrap();
        let mut resolved = raw_to_resolved(raw);
        expand_paths(&mut resolved, dir.path()).unwrap();

        assert_eq!(resolved.binds.ro[0], ro_dir);
        assert_eq!(resolved.binds.ro_try[0], ro_try_dir);
        assert_eq!(resolved.binds.rw[0], rw_dir);
        assert_eq!(resolved.binds.wsl2.ro[0], wsl2_ro);
        assert_eq!(resolved.binds.wsl2.ro_try[0], wsl2_ro_try);
        assert_eq!(resolved.options.path[0], path_dir);
    }

    // =============
    // path_validate
    // =============

    #[rstest]
    fn ro_missing_is_error(dir: TempDir) {
        let missing = dir.path().join("does-not-exist");
        let resolved = BwResolvedConfig {
            binds: ResolvedBinds {
                ro: vec![missing.clone()],
                ro_try: vec![],
                rw: vec![],
                docker: None,
                wsl2: ResolvedWsl2Binds::default(),
            },
            options: ResolvedOptions {
                clearenv: true,
                env: Default::default(),
                path: vec![],
                unshare_net: false,
            },
        };

        let result = validate(&resolved);
        assert!(result.is_err());
        let err = result.unwrap_err().to_string();
        assert!(err.contains(&missing.display().to_string()));
        assert!(err.contains("binds.ro[0]"));
    }

    #[rstest]
    fn rw_missing_is_error(dir: TempDir) {
        let missing = dir.path().join("does-not-exist");
        let resolved = BwResolvedConfig {
            binds: ResolvedBinds {
                ro: vec![],
                ro_try: vec![],
                rw: vec![missing.clone()],
                docker: None,
                wsl2: ResolvedWsl2Binds::default(),
            },
            options: ResolvedOptions {
                clearenv: true,
                env: Default::default(),
                path: vec![],
                unshare_net: false,
            },
        };

        let result = validate(&resolved);
        assert!(result.is_err());
        let err = result.unwrap_err().to_string();
        assert!(err.contains(&missing.display().to_string()));
        assert!(err.contains("binds.rw[0]"));
    }

    #[rstest]
    fn ro_try_missing_is_ok(dir: TempDir) {
        let missing = dir.path().join("does-not-exist");
        let resolved = BwResolvedConfig {
            binds: ResolvedBinds {
                ro: vec![],
                ro_try: vec![missing],
                rw: vec![],
                docker: None,
                wsl2: ResolvedWsl2Binds::default(),
            },
            options: ResolvedOptions {
                clearenv: true,
                env: Default::default(),
                path: vec![],
                unshare_net: false,
            },
        };

        // ro_try paths are never validated
        validate(&resolved).unwrap();
    }

    #[rstest]
    fn docker_missing_is_error(dir: TempDir) {
        let missing = dir.path().join("does-not-exist");
        let resolved = BwResolvedConfig {
            binds: ResolvedBinds {
                ro: vec![],
                ro_try: vec![],
                rw: vec![],
                docker: Some(missing.clone()),
                wsl2: ResolvedWsl2Binds::default(),
            },
            options: ResolvedOptions {
                clearenv: true,
                env: Default::default(),
                path: vec![],
                unshare_net: false,
            },
        };

        let result = validate(&resolved);
        assert!(result.is_err());
        let err = result.unwrap_err().to_string();
        assert!(err.contains(&missing.display().to_string()));
    }

    #[rstest]
    fn docker_null_is_ok() {
        let resolved = BwResolvedConfig {
            binds: ResolvedBinds {
                ro: vec![],
                ro_try: vec![],
                rw: vec![],
                docker: None, // disabled — no validation
                wsl2: ResolvedWsl2Binds::default(),
            },
            options: ResolvedOptions {
                clearenv: true,
                env: Default::default(),
                path: vec![],
                unshare_net: false,
            },
        };

        validate(&resolved).unwrap();
    }

    #[rstest]
    fn existing_paths_no_errors(dir: TempDir) {
        let a = dir.path().join("a");
        let b = dir.path().join("b");
        fs_err::create_dir_all(&a).unwrap();
        fs_err::create_dir_all(&b).unwrap();

        let resolved = BwResolvedConfig {
            binds: ResolvedBinds {
                ro: vec![a.clone()],
                ro_try: vec![],
                rw: vec![b.clone()],
                docker: None,
                wsl2: ResolvedWsl2Binds::default(),
            },
            options: ResolvedOptions {
                clearenv: true,
                env: Default::default(),
                path: vec![],
                unshare_net: false,
            },
        };

        validate(&resolved).unwrap();
    }

    // =============
    // full_pipeline
    // =============

    #[rstest]
    fn load_and_resolve_success(dir: TempDir) {
        let sub = dir.path().join("sub");
        fs_err::create_dir_all(&sub).unwrap();

        let global = write_config(
            &dir,
            "global.json",
            &format!(
                r#"{{"binds": {{"ro": ["{sub}"], "rw": []}}}}"#,
                sub = sub.display(),
            ),
        );

        let result = load_and_resolve(&global, &dir.path().join("no-workspace.json"), dir.path());
        assert!(result.is_ok());
        let resolved = result.unwrap();
        assert_eq!(resolved.binds.ro[0], sub);
    }

    #[rstest]
    fn load_and_resolve_missing_path_is_error(dir: TempDir) {
        let missing = dir.path().join("does-not-exist");

        let global = write_config(
            &dir,
            "global.json",
            &format!(
                r#"{{"binds": {{"ro": ["{missing}"]}}}}"#,
                missing = missing.display(),
            ),
        );

        let result = load_and_resolve(&global, &dir.path().join("no-workspace.json"), dir.path());
        assert!(result.is_err());
        assert!(
            result
                .unwrap_err()
                .to_string()
                .contains("path(s) not found")
        );
    }
}
