use std::path::{Path, PathBuf};

use anyhow::{Context, Result};

use crate::defaults::default_config;
use crate::types::{BwBinds, BwOptions, BwRawConfig};

/// Load and merge bw config: default → global → workspace.
///
/// Returns the merged config with string paths (unexpanded — expansion is
/// Phase 3). Paths use `/` as separator on all platforms (Linux-only tool).
pub fn load_config(cwd: &Path) -> Result<BwRawConfig> {
    let global_path = global_config_path();
    let workspace_path = cwd.join(".pi").join("bw.json");
    load_config_from(&global_path, &workspace_path)
}

/// Load and merge from explicit file paths (testable without env vars).
fn load_config_from(global_path: &Path, workspace_path: &Path) -> Result<BwRawConfig> {
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
    fn missing_global_file_is_ok(dir: TempDir) {
        let workspace = write_config(
            &dir,
            "workspace.json",
            r#"{"binds_extra": {"ro": ["/from-workspace"]}}"#,
        );

        let cfg = load_config_from(&dir.path().join("no-global.json"), &workspace).unwrap();
        let binds = cfg.binds.unwrap();

        // Defaults still present + workspace merged
        assert!(binds.ro.contains(&"/bin".to_string()));
        assert!(binds.ro.contains(&"/from-workspace".to_string()));
    }

    #[rstest]
    fn missing_workspace_file_is_ok(dir: TempDir) {
        let global = write_config(
            &dir,
            "global.json",
            r#"{"binds_extra": {"ro": ["/from-global"]}}"#,
        );

        let cfg = load_config_from(&global, &dir.path().join("no-workspace.json")).unwrap();
        let binds = cfg.binds.unwrap();

        // Defaults still present + global merged
        assert!(binds.ro.contains(&"/bin".to_string()));
        assert!(binds.ro.contains(&"/from-global".to_string()));
    }

    // ================
    // merge: malformed
    // ================

    #[rstest]
    fn malformed_global_is_error(dir: TempDir) {
        let global = write_config(&dir, "global.json", "not json");
        let result = load_config_from(&global, &dir.path().join("no-workspace.json"));
        assert!(result.is_err());
    }

    #[rstest]
    fn malformed_workspace_is_error(dir: TempDir) {
        let workspace = write_config(&dir, "workspace.json", "not json");
        let result = load_config_from(&dir.path().join("no-global.json"), &workspace);
        assert!(result.is_err());
    }
}
