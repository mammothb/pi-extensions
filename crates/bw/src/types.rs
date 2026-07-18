use std::collections::HashMap;
use std::fmt;
use std::path::PathBuf;

use serde::Deserialize;
use serde::de::{self, Deserializer};

/// Shape of a user-authored config file (global or workspace).
#[derive(Debug, Clone, Deserialize, PartialEq)]
pub struct BwRawConfig {
    #[serde(default)]
    pub binds: Option<BwBinds>,
    #[serde(default)]
    pub binds_extra: Option<BwBinds>,
    #[serde(default)]
    pub options: Option<BwOptions>,
}

/// Sub-structure for bind-mount configuration.
#[derive(Debug, Clone, Default, Deserialize, PartialEq)]
pub struct BwBinds {
    #[serde(default)]
    pub ro: Vec<String>,
    #[serde(default)]
    pub ro_try: Vec<String>,
    #[serde(default)]
    pub rw: Vec<String>,
    /// Socket path: absent (None), explicitly null (Disabled), or a path string.
    #[serde(default, deserialize_with = "deserialize_docker")]
    pub docker: Option<DockerConfig>,
    #[serde(default)]
    pub wsl2: Wsl2Binds,
}

/// Three-state docker configuration.
///
/// Serialized as `null` or a path string. Wrapped in `Option` at the field
/// level to distinguish "not present" from "present but null".
#[derive(Debug, Clone, PartialEq)]
pub enum DockerConfig {
    /// JSON `null` — disable docker bind entirely.
    Disabled,
    /// JSON string — custom socket path.
    Enabled(String),
}

fn deserialize_docker<'de, D: Deserializer<'de>>(d: D) -> Result<Option<DockerConfig>, D::Error> {
    struct DockerVisitor;
    impl<'de> de::Visitor<'de> for DockerVisitor {
        type Value = Option<DockerConfig>;

        fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
            f.write_str("a string or null")
        }

        fn visit_str<E: de::Error>(self, v: &str) -> Result<Self::Value, E> {
            Ok(Some(DockerConfig::Enabled(v.to_owned())))
        }

        fn visit_unit<E: de::Error>(self) -> Result<Self::Value, E> {
            Ok(Some(DockerConfig::Disabled))
        }
    }
    d.deserialize_any(DockerVisitor)
}

/// WSL2-specific bind overrides.
#[derive(Debug, Clone, Default, Deserialize, PartialEq)]
pub struct Wsl2Binds {
    #[serde(default)]
    pub ro: Vec<String>,
    #[serde(default)]
    pub ro_try: Vec<String>,
}

/// bwrap option knobs.
#[derive(Debug, Clone, Deserialize, PartialEq)]
pub struct BwOptions {
    #[serde(default = "default_true")]
    pub clearenv: bool,
    #[serde(default)]
    pub env: HashMap<String, String>,
    #[serde(default)]
    pub path: Vec<String>,
    #[serde(default)]
    pub unshare_net: bool,
}

impl Default for BwOptions {
    fn default() -> Self {
        Self {
            clearenv: true,
            env: HashMap::new(),
            path: Vec::new(),
            unshare_net: false,
        }
    }
}

fn default_true() -> bool {
    true
}

/// Fully resolved config — all layers merged, paths expanded, ready for bwrap.
#[derive(Debug, Clone, PartialEq)]
pub struct BwResolvedConfig {
    pub binds: ResolvedBinds,
    pub options: ResolvedOptions,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ResolvedBinds {
    pub ro: Vec<PathBuf>,
    pub ro_try: Vec<PathBuf>,
    pub rw: Vec<PathBuf>,
    /// `None` means docker bind disabled.
    pub docker: Option<PathBuf>,
    pub wsl2: ResolvedWsl2Binds,
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct ResolvedWsl2Binds {
    pub ro: Vec<PathBuf>,
    pub ro_try: Vec<PathBuf>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ResolvedOptions {
    pub clearenv: bool,
    pub env: HashMap<String, String>,
    pub path: Vec<PathBuf>,
    pub unshare_net: bool,
}

// =====
// Tests
// =====

#[cfg(test)]
mod tests {
    use super::*;
    use rstest::rstest;

    // ===========
    // BwRawConfig
    // ===========

    #[rstest]
    fn empty_json_all_none() {
        let cfg: BwRawConfig = serde_json::from_str("{}").unwrap();
        assert_eq!(cfg.binds, None);
        assert_eq!(cfg.binds_extra, None);
        assert_eq!(cfg.options, None);
    }

    #[rstest]
    fn binds_and_binds_extra_both_optional() {
        let cfg: BwRawConfig =
            serde_json::from_str(r#"{"binds": {"ro": ["/a"]}, "binds_extra": {"rw": ["/b"]}}"#)
                .unwrap();
        assert_eq!(cfg.binds.unwrap().ro, vec!["/a".to_string()]);
        assert_eq!(cfg.binds_extra.unwrap().rw, vec!["/b".to_string()]);
    }

    // =======
    // BwBinds
    // =======

    #[rstest]
    fn binds_defaults() {
        let binds: BwBinds = serde_json::from_str("{}").unwrap();
        assert!(binds.ro.is_empty());
        assert!(binds.ro_try.is_empty());
        assert!(binds.rw.is_empty());
        assert_eq!(binds.docker, None);
        assert_eq!(binds.wsl2.ro, Vec::<String>::new());
        assert_eq!(binds.wsl2.ro_try, Vec::<String>::new());
    }

    #[rstest]
    fn binds_ro_populated() {
        let binds: BwBinds = serde_json::from_str(r#"{"ro": ["/bin", "/usr"]}"#).unwrap();
        assert_eq!(binds.ro, vec!["/bin", "/usr"]);
        assert!(binds.ro_try.is_empty());
    }

    #[rstest]
    fn binds_ro_try_populated() {
        let binds: BwBinds = serde_json::from_str(r#"{"ro_try": ["/lib", "/lib64"]}"#).unwrap();
        assert_eq!(binds.ro_try, vec!["/lib", "/lib64"]);
        assert!(binds.ro.is_empty());
    }

    // ============
    // DockerConfig
    // ============

    #[rstest]
    fn docker_absent_is_none() {
        let binds: BwBinds = serde_json::from_str("{}").unwrap();
        assert_eq!(binds.docker, None);
    }

    #[rstest]
    fn docker_null_is_disabled() {
        let binds: BwBinds = serde_json::from_str(r#"{"docker": null}"#).unwrap();
        assert_eq!(binds.docker, Some(DockerConfig::Disabled));
    }

    #[rstest]
    fn docker_string_is_enabled() {
        let binds: BwBinds = serde_json::from_str(r#"{"docker": "/var/run/docker.sock"}"#).unwrap();
        assert_eq!(
            binds.docker,
            Some(DockerConfig::Enabled("/var/run/docker.sock".into()))
        );
    }

    #[rstest]
    fn docker_custom_path_is_enabled() {
        let binds: BwBinds = serde_json::from_str(r#"{"docker": "/custom/sock"}"#).unwrap();
        assert_eq!(
            binds.docker,
            Some(DockerConfig::Enabled("/custom/sock".into()))
        );
    }

    // =========
    // Wsl2Binds
    // =========

    #[rstest]
    fn wsl2_defaults_empty() {
        let w: Wsl2Binds = serde_json::from_str("{}").unwrap();
        assert!(w.ro.is_empty());
        assert!(w.ro_try.is_empty());
    }

    #[rstest]
    fn wsl2_partial_override() {
        let w: Wsl2Binds = serde_json::from_str(r#"{"ro": ["/init"]}"#).unwrap();
        assert_eq!(w.ro, vec!["/init"]);
        assert!(w.ro_try.is_empty());
    }

    // =========
    // BwOptions
    // =========

    #[rstest]
    fn options_defaults() {
        let opts: BwOptions = serde_json::from_str("{}").unwrap();
        assert!(opts.clearenv);
        assert!(opts.env.is_empty());
        assert!(opts.path.is_empty());
        assert!(!opts.unshare_net);
    }

    #[rstest]
    fn clearenv_false() {
        let opts: BwOptions = serde_json::from_str(r#"{"clearenv": false}"#).unwrap();
        assert!(!opts.clearenv);
    }

    #[rstest]
    fn clearenv_defaults_true() {
        let opts: BwOptions = serde_json::from_str("{}").unwrap();
        assert!(opts.clearenv);
    }

    #[rstest]
    fn options_env_populated() {
        let opts: BwOptions =
            serde_json::from_str(r#"{"env": {"FOO": "bar", "BAZ": "qux"}}"#).unwrap();
        assert_eq!(opts.env.get("FOO").map(String::as_str), Some("bar"));
        assert_eq!(opts.env.get("BAZ").map(String::as_str), Some("qux"));
    }

    #[rstest]
    fn options_path_populated() {
        let opts: BwOptions = serde_json::from_str(r#"{"path": ["/a", "/b"]}"#).unwrap();
        assert_eq!(opts.path, vec!["/a", "/b"]);
    }

    #[rstest]
    fn options_unshare_net_true() {
        let opts: BwOptions = serde_json::from_str(r#"{"unshare_net": true}"#).unwrap();
        assert!(opts.unshare_net);
    }

    #[rstest]
    fn options_unshare_net_defaults_false() {
        let opts: BwOptions = serde_json::from_str("{}").unwrap();
        assert!(!opts.unshare_net);
    }
}
