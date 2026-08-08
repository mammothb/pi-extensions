//! Shared helpers for integration tests (real git).

use std::path::Path;

use assert_cmd::Command;

/// Build a `gwt` command instance from the binary under test.
pub fn gwt() -> Command {
    Command::cargo_bin("gwt").unwrap()
}

/// Run git in `dir`, isolated from host git configuration, panicking with
/// the captured stderr on failure.
pub fn run_git(dir: &Path, args: &[&str]) {
    let output = std::process::Command::new("git")
        .args(args)
        .current_dir(dir)
        // Never let the developer's global/system config leak into tests:
        // gpg signing, default branch names, pager settings, etc. would make
        // results depend on the host. Repo-local config is unaffected.
        .env("GIT_CONFIG_GLOBAL", "/dev/null")
        .env("GIT_CONFIG_SYSTEM", "/dev/null")
        .output()
        .expect("git runs");
    assert!(
        output.status.success(),
        "git {args:?} failed in {}:\n{}",
        dir.display(),
        String::from_utf8_lossy(&output.stderr)
    );
}

/// Initialize a repository with one commit and a local identity.
pub fn init_repo(dir: &Path) {
    fs_err::create_dir_all(dir).unwrap();
    run_git(dir, &["init", "-q", "-b", "main"]);
    run_git(dir, &["config", "user.email", "tester@example.com"]);
    run_git(dir, &["config", "user.name", "Tester"]);
    run_git(dir, &["commit", "-qm", "init", "--allow-empty"]);
}
