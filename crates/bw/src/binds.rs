use std::collections::HashMap;
use std::path::Path;

use crate::types::BwResolvedConfig;

/// Build the full bwrap argument array from a resolved config.
pub fn build_bwrap_args(config: &BwResolvedConfig, cwd: &Path, command: &[String]) -> Vec<String> {
    let mut args = vec!["bwrap".to_string()];

    // Hardcoded namespace / sandbox flags
    args.extend_from_slice(&[
        "--unshare-cgroup".to_string(),
        "--unshare-ipc".to_string(),
        "--unshare-pid".to_string(),
        "--unshare-user".to_string(),
        "--unshare-uts".to_string(),
        "--die-with-parent".to_string(),
        "--dev".to_string(),
        "/dev".to_string(),
        "--proc".to_string(),
        "/proc".to_string(),
        "--tmpfs".to_string(),
        "/tmp".to_string(),
    ]);

    // Optional network isolation
    if config.options.unshare_net {
        args.push("--unshare-net".to_string());
    }

    // ro binds
    push_binds(&mut args, "--ro-bind", &config.binds.ro);
    // ro_try binds (only if path exists)
    for p in &config.binds.ro_try {
        if p.exists() {
            push_bind(&mut args, "--ro-bind-try", p);
        }
    }
    // rw binds
    push_binds(&mut args, "--bind", &config.binds.rw);
    // docker socket
    if let Some(ref p) = config.binds.docker {
        push_bind(&mut args, "--bind", p);
    }
    // wsl2 binds
    push_binds(&mut args, "--ro-bind", &config.binds.wsl2.ro);
    for p in &config.binds.wsl2.ro_try {
        if p.exists() {
            push_bind(&mut args, "--ro-bind-try", p);
        }
    }

    // Workspace (always rw)
    let cwd_str = cwd.to_string_lossy().into_owned();
    args.push("--bind".to_string());
    args.push(cwd_str.clone());
    args.push(cwd_str.clone());
    args.push("--chdir".to_string());
    args.push(cwd_str);

    // Environment
    if config.options.clearenv {
        args.push("--clearenv".to_string());
    }

    let mut env: HashMap<String, String> = HashMap::new();

    // Essential vars
    if let Ok(home) = std::env::var("HOME") {
        env.insert("HOME".into(), home);
    }
    env.insert(
        "TERM".into(),
        std::env::var("TERM").unwrap_or_else(|_| "screen-256color".into()),
    );
    if let Ok(user) = std::env::var("USER") {
        env.insert("USER".into(), user);
    }

    // PATH
    env.insert("PATH".into(), build_path(&config.options.path));

    // User env overrides (may override essential vars)
    for (k, v) in &config.options.env {
        env.insert(k.clone(), v.clone());
    }

    // Emit --setenv for each, resolving $VAR references
    for (k, v) in &env {
        let resolved = resolve_env_vars(v);
        args.push("--setenv".to_string());
        args.push(k.clone());
        args.push(resolved);
    }

    // Command
    args.push("--".to_string());
    args.extend_from_slice(command);

    args
}

fn push_binds(args: &mut Vec<String>, flag: &str, paths: &[std::path::PathBuf]) {
    for p in paths {
        push_bind(args, flag, p);
    }
}

fn push_bind(args: &mut Vec<String>, flag: &str, path: &Path) {
    let s = path.to_string_lossy().into_owned();
    args.push(flag.to_string());
    args.push(s.clone());
    args.push(s);
}

/// Build PATH from config extras + standard system dirs.
fn build_path(extras: &[std::path::PathBuf]) -> String {
    let mut parts: Vec<String> = Vec::new();

    for p in extras {
        parts.push(p.to_string_lossy().into_owned());
    }
    if let Ok(home) = std::env::var("HOME") {
        parts.push(format!("{home}/.local/bin"));
    }
    if let Some(node_dir) = find_node_dir() {
        parts.push(node_dir);
    }
    parts.extend_from_slice(&[
        "/usr/local/sbin".into(),
        "/usr/local/bin".into(),
        "/usr/sbin".into(),
        "/usr/bin".into(),
        "/sbin".into(),
        "/bin".into(),
    ]);

    parts.join(":")
}

/// Find a directory on host PATH that contains `node`.
fn find_node_dir() -> Option<String> {
    let path = std::env::var("PATH").unwrap_or_default();
    for dir in path.split(':') {
        let node_path = Path::new(dir).join("node");
        if node_path.exists() {
            return Some(dir.to_string());
        }
    }
    None
}

/// Replace `$VAR`, `${VAR}`, and `$$` in a string using host environment
/// variables.
fn resolve_env_vars(raw: &str) -> String {
    let mut result = String::with_capacity(raw.len());
    let mut chars = raw.chars().peekable();

    while let Some(ch) = chars.next() {
        if ch == '$' {
            match chars.peek() {
                Some('$') => {
                    chars.next();
                    result.push('$');
                }
                Some('{') => {
                    chars.next();
                    let mut name = String::new();
                    for c in chars.by_ref() {
                        if c == '}' {
                            break;
                        }
                        name.push(c);
                    }
                    result.push_str(&std::env::var(&name).unwrap_or_default());
                }
                Some(&c) if c.is_ascii_alphabetic() || c == '_' => {
                    let mut name = String::new();
                    while let Some(&c) = chars.peek() {
                        if c.is_ascii_alphanumeric() || c == '_' {
                            name.push(c);
                            chars.next();
                        } else {
                            break;
                        }
                    }
                    result.push_str(&std::env::var(&name).unwrap_or_default());
                }
                _ => {
                    result.push('$');
                }
            }
        } else {
            result.push(ch);
        }
    }

    result
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use super::*;
    use crate::types::{ResolvedBinds, ResolvedOptions, ResolvedWsl2Binds};
    use rstest::{fixture, rstest};
    use tempfile::{TempDir, tempdir};

    #[fixture]
    fn dir() -> TempDir {
        tempdir().unwrap()
    }

    fn config_with(ro: &[&str], rw: &[&str]) -> BwResolvedConfig {
        BwResolvedConfig {
            binds: ResolvedBinds {
                ro: ro.iter().map(PathBuf::from).collect(),
                ro_try: vec![],
                rw: rw.iter().map(PathBuf::from).collect(),
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

    // ================
    // resolve_env_vars
    // ================

    #[rstest]
    fn dollar_dollar_is_literal() {
        assert_eq!(resolve_env_vars("$$"), "$");
        assert_eq!(resolve_env_vars("a$$b"), "a$b");
        assert_eq!(resolve_env_vars("$$$"), "$$");
    }

    #[rstest]
    fn dollar_var_resolved_from_host() {
        let home = std::env::var("HOME").unwrap();
        assert_eq!(resolve_env_vars("$HOME"), home);
        assert_eq!(resolve_env_vars("${HOME}"), home);
        assert_eq!(
            resolve_env_vars("path/$HOME/end"),
            format!("path/{home}/end")
        );
    }

    #[rstest]
    fn unresolved_var_becomes_empty() {
        assert_eq!(resolve_env_vars("$NO_SUCH_VAR_12345"), "");
        assert_eq!(resolve_env_vars("${NO_SUCH_VAR_12345}"), "");
    }

    #[rstest]
    fn non_identifier_stops_var_name() {
        // $ followed by non-alpha/non-underscore should be literal $
        assert_eq!(resolve_env_vars("$42"), "$42");
    }

    // ================
    // build_bwrap_args
    // ================

    #[rstest]
    fn hardcoded_flags_always_present(dir: TempDir) {
        let config = config_with(&["/ro"], &["/rw"]);
        let args = build_bwrap_args(&config, dir.path(), &["pi".into()]);

        assert!(args.contains(&"--unshare-cgroup".into()));
        assert!(args.contains(&"--unshare-ipc".into()));
        assert!(args.contains(&"--unshare-pid".into()));
        assert!(args.contains(&"--unshare-user".into()));
        assert!(args.contains(&"--unshare-uts".into()));
        assert!(args.contains(&"--die-with-parent".into()));
        assert!(args.contains(&"--dev".into()));
        assert!(args.contains(&"/dev".into()));
        assert!(args.contains(&"--proc".into()));
        assert!(args.contains(&"/proc".into()));
        assert!(args.contains(&"--tmpfs".into()));
        assert!(args.contains(&"/tmp".into()));
    }

    #[rstest]
    fn ro_binds_become_ro_bind_flags(dir: TempDir) {
        let ro = dir.path().join("ro_dir");
        fs_err::create_dir_all(&ro).unwrap();

        let config = config_with(&[&ro.to_string_lossy()], &[]);
        let args = build_bwrap_args(&config, dir.path(), &["pi".into()]);

        let pos = args.iter().position(|a| a == "--ro-bind").unwrap();
        assert_eq!(args[pos + 1], ro.to_string_lossy());
        assert_eq!(args[pos + 2], ro.to_string_lossy());
    }

    #[rstest]
    fn ro_try_existing_becomes_ro_bind_try(dir: TempDir) {
        let existing = dir.path().join("exists");
        fs_err::create_dir_all(&existing).unwrap();

        let mut config = config_with(&[], &[]);
        config.binds.ro_try = vec![existing.clone()];

        let args = build_bwrap_args(&config, dir.path(), &["pi".into()]);

        let pos = args.iter().position(|a| a == "--ro-bind-try").unwrap();
        assert_eq!(args[pos + 1], existing.to_string_lossy());
        assert_eq!(args[pos + 2], existing.to_string_lossy());
    }

    #[rstest]
    fn ro_try_missing_is_skipped(dir: TempDir) {
        let missing = dir.path().join("does-not-exist");

        let mut config = config_with(&[], &[]);
        config.binds.ro_try = vec![missing];

        let args = build_bwrap_args(&config, dir.path(), &["pi".into()]);

        assert!(!args.contains(&"--ro-bind-try".into()));
    }

    #[rstest]
    fn rw_binds_become_bind_flags(dir: TempDir) {
        let rw = dir.path().join("rw_dir");
        fs_err::create_dir_all(&rw).unwrap();

        let config = config_with(&[], &[&rw.to_string_lossy()]);
        let args = build_bwrap_args(&config, dir.path(), &["pi".into()]);

        // The rw path should appear as a --bind target
        let rw_str = rw.to_string_lossy();
        assert!(
            args.windows(3)
                .any(|w| w[0] == "--bind" && w[1] == rw_str && w[2] == rw_str),
            "rw path {rw_str} not found as --bind target"
        );
    }

    #[rstest]
    fn docker_set_becomes_bind(dir: TempDir) {
        let sock = dir.path().join("docker.sock");
        fs_err::write(&sock, "").unwrap();

        let mut config = config_with(&[], &[]);
        config.binds.docker = Some(sock.clone());

        let args = build_bwrap_args(&config, dir.path(), &["pi".into()]);

        // Find the docker bind: it's a --bind whose next arg is the sock path
        let pos = args
            .windows(3)
            .position(|w| w[0] == "--bind" && w[1] == sock.to_string_lossy())
            .unwrap();
        assert_eq!(args[pos + 1], sock.to_string_lossy());
        assert_eq!(args[pos + 2], sock.to_string_lossy());
    }

    #[rstest]
    fn docker_null_absent_from_args(dir: TempDir) {
        let config = config_with(&[], &[]); // docker: None
        let args = build_bwrap_args(&config, dir.path(), &["pi".into()]);

        // No docker bind — only workspace bind + wsl binds if present
        // Just check no /var/run/docker.sock in args
        assert!(!args.contains(&"/var/run/docker.sock".into()));
    }

    #[rstest]
    fn workspace_bound_and_chdir(dir: TempDir) {
        let config = config_with(&[], &[]);
        let args = build_bwrap_args(&config, dir.path(), &["pi".into()]);

        let cwd_str = dir.path().to_string_lossy();
        // Workspace bound rw
        let pos = args.iter().position(|a| a == "--chdir").unwrap();
        assert_eq!(args[pos + 1], cwd_str);
    }

    #[rstest]
    fn unshare_net_when_enabled(dir: TempDir) {
        let mut config = config_with(&[], &[]);
        config.options.unshare_net = true;

        let args = build_bwrap_args(&config, dir.path(), &["pi".into()]);

        assert!(args.contains(&"--unshare-net".into()));
    }

    #[rstest]
    fn unshare_net_absent_when_disabled(dir: TempDir) {
        let config = config_with(&[], &[]); // unshare_net: false by default
        let args = build_bwrap_args(&config, dir.path(), &["pi".into()]);

        assert!(!args.contains(&"--unshare-net".into()));
    }

    #[rstest]
    fn clearenv_when_true(dir: TempDir) {
        let config = config_with(&[], &[]); // clearenv: true
        let args = build_bwrap_args(&config, dir.path(), &["pi".into()]);

        assert!(args.contains(&"--clearenv".into()));
    }

    #[rstest]
    fn clearenv_absent_when_false(dir: TempDir) {
        let mut config = config_with(&[], &[]);
        config.options.clearenv = false;

        let args = build_bwrap_args(&config, dir.path(), &["pi".into()]);

        assert!(!args.contains(&"--clearenv".into()));
    }

    #[rstest]
    fn essential_env_vars_set(dir: TempDir) {
        let config = config_with(&[], &[]);
        let args = build_bwrap_args(&config, dir.path(), &["pi".into()]);

        // HOME, TERM, USER, PATH should all have --setenv entries
        for key in ["HOME", "TERM", "USER", "PATH"] {
            let found = args.windows(2).any(|w| w[0] == "--setenv" && w[1] == key);
            assert!(found, "missing --setenv for {key}");
        }
    }

    #[rstest]
    fn user_env_appended(dir: TempDir) {
        let mut config = config_with(&[], &[]);
        config.options.env.insert("FOO".into(), "bar".into());

        let args = build_bwrap_args(&config, dir.path(), &["pi".into()]);

        // Find --setenv FOO bar
        let pos = args
            .windows(3)
            .position(|w| w[0] == "--setenv" && w[1] == "FOO" && w[2] == "bar")
            .unwrap();
        assert!(pos > 0);
    }

    #[rstest]
    fn command_appended_after_dashdash(dir: TempDir) {
        let config = config_with(&[], &[]);
        let args = build_bwrap_args(&config, dir.path(), &["echo".into(), "hello".into()]);

        let pos = args.iter().position(|a| a == "--").unwrap();
        assert_eq!(args[pos + 1], "echo");
        assert_eq!(args[pos + 2], "hello");
    }

    #[rstest]
    fn default_command_is_shell(dir: TempDir) {
        let config = config_with(&[], &[]);
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".into());
        let args = build_bwrap_args(&config, dir.path(), std::slice::from_ref(&shell));

        let pos = args.iter().position(|a| a == "--").unwrap();
        assert_eq!(args[pos + 1], shell);
    }

    #[rstest]
    fn wsl2_binds_included(dir: TempDir) {
        let mut config = config_with(&[], &[]);
        config.binds.wsl2.ro = vec![PathBuf::from("/wsl/ro")];
        config.binds.wsl2.ro_try = vec![PathBuf::from("/wsl/ro_try")];

        let args = build_bwrap_args(&config, dir.path(), &["pi".into()]);

        // wsl2.ro should be in --ro-bind
        assert!(args.contains(&"--ro-bind".into()));
        // wsl2.ro_try doesn't exist → skipped
        assert!(!args.contains(&"--ro-bind-try".into()));
    }

    #[rstest]
    fn wsl2_binds_try_when_exists(dir: TempDir) {
        let existing = dir.path().join("wsl_exists");
        fs_err::create_dir_all(&existing).unwrap();

        let mut config = config_with(&[], &[]);
        config.binds.wsl2.ro_try = vec![existing.clone()];

        let args = build_bwrap_args(&config, dir.path(), &["pi".into()]);

        let pos = args.iter().position(|a| a == "--ro-bind-try").unwrap();
        assert_eq!(args[pos + 1], existing.to_string_lossy());
    }

    #[rstest]
    fn path_dirs_prepended(dir: TempDir) {
        let mut config = config_with(&[], &[]);
        config.options.path = vec![PathBuf::from("/extra/a"), PathBuf::from("/extra/b")];

        let args = build_bwrap_args(&config, dir.path(), &["pi".into()]);

        // Find the PATH --setenv value
        let pos = args
            .windows(2)
            .position(|w| w[0] == "--setenv" && w[1] == "PATH")
            .unwrap();
        let path_val = &args[pos + 2];
        assert!(path_val.starts_with("/extra/a:/extra/b:"));
    }

    #[rstest]
    fn snapshot_default_config(dir: TempDir) {
        // Full default config → full args. Catches regressions in arg structure.
        let config = BwResolvedConfig {
            binds: ResolvedBinds {
                ro: vec![
                    PathBuf::from("/bin"),
                    PathBuf::from("/etc"),
                    PathBuf::from("/sbin"),
                    PathBuf::from("/usr"),
                ],
                ro_try: vec![PathBuf::from("/lib"), PathBuf::from("/lib64")],
                rw: vec![PathBuf::from("/tmp/cache")],
                docker: Some(PathBuf::from("/var/run/docker.sock")),
                wsl2: ResolvedWsl2Binds::default(),
            },
            options: ResolvedOptions {
                clearenv: true,
                env: HashMap::from([("GITHUB_TOKEN".into(), "ghp_test".into())]),
                path: vec![PathBuf::from("/extra/bin")],
                unshare_net: false,
            },
        };

        let args = build_bwrap_args(&config, dir.path(), &["pi".into()]);

        // Structural checks
        assert_eq!(args[0], "bwrap");
        // Hardcoded flags at the start
        assert!(args[1..].starts_with(&[
            "--unshare-cgroup".into(),
            "--unshare-ipc".into(),
            "--unshare-pid".into(),
            "--unshare-user".into(),
            "--unshare-uts".into(),
            "--die-with-parent".into(),
            "--dev".into(),
            "/dev".into(),
            "--proc".into(),
            "/proc".into(),
            "--tmpfs".into(),
            "/tmp".into(),
        ]));
        // Must contain --setenv GITHUB_TOKEN ghp_test
        assert!(
            args.windows(3)
                .any(|w| w[0] == "--setenv" && w[1] == "GITHUB_TOKEN" && w[2] == "ghp_test")
        );
        // Must end with -- pi
        let n = args.len();
        assert_eq!(args[n - 2], "--");
        assert_eq!(args[n - 1], "pi");
    }
}
