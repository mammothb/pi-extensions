use crate::types::BwRawConfig;

/// Default config compiled into the binary. Reproduces the bind list from the
/// original bash `bw` script.
pub const DEFAULT_CONFIG_JSON: &str = r#"{
  "binds": {
    "ro": [
      "/bin",
      "/etc",
      "/sbin",
      "/usr"
    ],
    "ro_try": [
      "/lib",
      "/lib64",
      "~/.cargo",
      "~/.config",
      "~/.local/bin",
      "~/.local/share",
      "~/.nvm",
      "~/.pyenv",
      "~/.rustup",
      "~/.ssh"
    ],
    "rw": [
      "~/.cache",
      "~/.local/packages",
      "~/.npm",
      "~/.pi"
    ],
    "docker": "/var/run/docker.sock",
    "wsl2": {
      "ro": [],
      "ro_try": []
    }
  },
  "options": {
    "clearenv": true,
    "env": {},
    "path": ["~/.cargo/bin"],
    "unshare_net": false
  }
}"#;

/// Deserialize the compiled-in default.
///
/// # Panics
///
/// Panics if the embedded JSON is malformed — this is a compile-time invariant.
pub fn default_config() -> BwRawConfig {
    serde_json::from_str(DEFAULT_CONFIG_JSON)
        .expect("DEFAULT_CONFIG_JSON is malformed — this is a bug")
}

#[cfg(test)]
mod tests {
    use super::*;
    use rstest::rstest;

    #[rstest]
    fn default_config_deserializes() {
        // Must not panic.
        let cfg = default_config();
        // Spot-check a few values to confirm the JSON is what we expect.
        let binds = cfg.binds.expect("default config must have binds");
        assert!(!binds.ro.is_empty(), "ro binds must not be empty");
        assert!(!binds.ro_try.is_empty(), "roTry binds must not be empty");
        assert!(!binds.rw.is_empty(), "rw binds must not be empty");
    }

    #[rstest]
    fn default_config_docker_is_set() {
        let cfg = default_config();
        let binds = cfg.binds.unwrap();
        assert!(binds.docker.is_some(), "docker must be set by default");
        assert!(
            matches!(binds.docker, Some(crate::types::DockerConfig::Enabled(_))),
            "default docker must be Enabled, not Disabled"
        );
    }

    #[rstest]
    fn default_config_system_paths_are_absolute() {
        let cfg = default_config();
        let binds = cfg.binds.unwrap();
        for p in &binds.ro {
            assert!(p.starts_with('/'), "system ro bind must be absolute: {p}");
        }
    }

    #[rstest]
    fn default_config_user_paths_use_tilde() {
        let cfg = default_config();
        let binds = cfg.binds.unwrap();
        for p in &binds.ro_try {
            if !p.starts_with('/') {
                assert!(
                    p.starts_with("~/"),
                    "user roTry path must use tilde or be absolute: {p}"
                );
            }
        }
        for p in &binds.rw {
            if !p.starts_with('/') {
                assert!(
                    p.starts_with("~/"),
                    "user rw path must use tilde or be absolute: {p}"
                );
            }
        }
    }

    #[rstest]
    fn default_config_options_clearenv_true() {
        let cfg = default_config();
        let opts = cfg.options.expect("default config must have options");
        assert!(opts.clearenv);
    }
}
