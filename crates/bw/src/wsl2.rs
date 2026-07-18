use std::path::{Path, PathBuf};

use crate::types::BwResolvedConfig;

/// Auto-add WSL2 binds and env vars. No-op on non-WSL2 systems or when the
/// user has already configured WSL2 binds.
pub fn apply_wsl2(config: &mut BwResolvedConfig) {
    if !is_wsl2() {
        return;
    }
    apply_wsl2_config(config, |k| std::env::var(k).ok());
}

/// Check whether we're running under WSL2.
fn is_wsl2() -> bool {
    Path::new("/init").exists()
        && Path::new("/run/WSL").exists()
        && fs_err::read_dir("/run/WSL").is_ok_and(|mut d| d.next().is_some())
        && Path::new("/proc/sys/fs/binfmt_misc/WSLInterop").exists()
}

/// Pure logic — testable without being on WSL2.
fn apply_wsl2_config(config: &mut BwResolvedConfig, env_lookup: impl Fn(&str) -> Option<String>) {
    let wsl2 = &config.binds.wsl2;
    let has_custom = !wsl2.ro.is_empty() || !wsl2.ro_try.is_empty();
    if has_custom {
        return;
    }

    config.binds.wsl2.ro.push(PathBuf::from("/init"));
    config.binds.wsl2.ro.push(PathBuf::from("/run/WSL"));
    config.binds.wsl2.ro_try.push(PathBuf::from("/mnt/c"));
    config.binds.wsl2.ro_try.push(PathBuf::from("/mnt/wsl"));

    for key in ["WSL_INTEROP", "WSL_DISTRO_NAME", "WSLENV"] {
        if let Some(val) = env_lookup(key) {
            config.options.env.entry(key.to_string()).or_insert(val);
        }
    }
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use super::*;
    use crate::types::{ResolvedBinds, ResolvedOptions, ResolvedWsl2Binds};
    use rstest::rstest;

    fn empty_config() -> BwResolvedConfig {
        BwResolvedConfig {
            binds: ResolvedBinds {
                ro: vec![],
                ro_try: vec![],
                rw: vec![],
                docker: None,
                wsl2: ResolvedWsl2Binds::default(),
            },
            options: ResolvedOptions {
                clearenv: true,
                env: HashMap::new(),
                path: vec![],
                unshare_net: false,
            },
        }
    }

    // =================
    // apply_wsl2_config
    // =================

    #[rstest]
    fn apply_wsl2_adds_binds_when_empty() {
        let mut config = empty_config();

        apply_wsl2_config(&mut config, |_| None);

        assert_eq!(
            config.binds.wsl2.ro,
            vec![PathBuf::from("/init"), PathBuf::from("/run/WSL")]
        );
        assert_eq!(
            config.binds.wsl2.ro_try,
            vec![PathBuf::from("/mnt/c"), PathBuf::from("/mnt/wsl")]
        );
    }

    #[rstest]
    #[case::ro_custom("ro", "/custom")]
    #[case::ro_try_custom("ro_try", "/custom-try")]
    fn apply_wsl2_skips_when_user_configured(#[case] field: &str, #[case] path: &str) {
        let mut config = empty_config();
        match field {
            "ro" => config.binds.wsl2.ro = vec![PathBuf::from(path)],
            _ => config.binds.wsl2.ro_try = vec![PathBuf::from(path)],
        }

        apply_wsl2_config(&mut config, |_| None);

        if field == "ro" {
            // User's value preserved, no auto-add
            assert_eq!(config.binds.wsl2.ro, vec![PathBuf::from(path)]);
            assert!(config.binds.wsl2.ro_try.is_empty());
        } else {
            assert!(config.binds.wsl2.ro.is_empty());
            assert_eq!(config.binds.wsl2.ro_try, vec![PathBuf::from(path)]);
        }
    }

    #[rstest]
    fn apply_wsl2_adds_env_vars() {
        let mut config = empty_config();

        apply_wsl2_config(&mut config, |k| match k {
            "WSL_INTEROP" => Some("interop-val".into()),
            "WSL_DISTRO_NAME" => Some("distro".into()),
            _ => None,
        });

        assert_eq!(
            config.options.env.get("WSL_INTEROP").map(String::as_str),
            Some("interop-val")
        );
        assert_eq!(
            config
                .options
                .env
                .get("WSL_DISTRO_NAME")
                .map(String::as_str),
            Some("distro")
        );
        // WSLENV not provided by our mock
        assert!(!config.options.env.contains_key("WSLENV"));
    }

    #[rstest]
    fn apply_wsl2_env_does_not_override_user() {
        let mut config = empty_config();
        config
            .options
            .env
            .insert("WSL_INTEROP".into(), "user-val".into());

        apply_wsl2_config(&mut config, |k| {
            if k == "WSL_INTEROP" {
                Some("host-val".into())
            } else {
                None
            }
        });

        // User value preserved — host value ignored
        assert_eq!(
            config.options.env.get("WSL_INTEROP").map(String::as_str),
            Some("user-val")
        );
    }
}
