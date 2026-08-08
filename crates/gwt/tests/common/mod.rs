//! Shared helpers for integration tests (real git).

use std::path::Path;

use assert_cmd::Command;

/// Build a `gwt` command instance from the binary under test.
pub fn gwt() -> Command {
    Command::cargo_bin("gwt").unwrap()
}

/// Run git in `dir`, panicking on failure.
pub fn run_git(dir: &Path, args: &[&str]) {
    let status = std::process::Command::new("git")
        .args(args)
        .current_dir(dir)
        .status()
        .expect("git runs");
    assert!(status.success(), "git {args:?} failed in {}", dir.display());
}

/// Initialize a repository with one commit and a local identity.
pub fn init_repo(dir: &Path) {
    fs_err::create_dir_all(dir).unwrap();
    run_git(dir, &["init", "-q", "-b", "main"]);
    run_git(dir, &["config", "user.email", "tester@example.com"]);
    run_git(dir, &["config", "user.name", "Tester"]);
    run_git(dir, &["commit", "-qm", "init", "--allow-empty"]);
}
