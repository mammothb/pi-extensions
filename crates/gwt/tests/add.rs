//! End-to-end tests for `gwt add` against real git (assert_cmd + tempfile).

use std::path::Path;

use assert_cmd::Command;
use predicates::prelude::*;
use rstest::rstest;
use tempfile::TempDir;

/// Initialize a repository with one commit and a local identity.
fn init_repo(dir: &Path) {
    run_git(dir, &["init", "-q", "-b", "main"]);
    run_git(dir, &["config", "user.email", "tester@example.com"]);
    run_git(dir, &["config", "user.name", "Tester"]);
    run_git(dir, &["commit", "-qm", "init", "--allow-empty"]);
}

fn run_git(dir: &Path, args: &[&str]) {
    let status = std::process::Command::new("git")
        .args(args)
        .current_dir(dir)
        .status()
        .expect("git runs");
    assert!(status.success(), "git {args:?} failed in {}", dir.display());
}

fn gwt() -> Command {
    Command::cargo_bin("gwt").unwrap()
}

#[rstest]
fn add_creates_worktree_on_new_branch() {
    let tmp = TempDir::new().unwrap();
    init_repo(tmp.path());

    gwt()
        .current_dir(tmp.path())
        .args(["add", "feat/slice", "-b", "feat/slice"])
        .assert()
        .success();

    let spec = tmp.path().join("feat").join("slice");
    assert!(
        spec.join(".git").exists(),
        "worktree registered with a gitfile at {}",
        spec.display()
    );

    let out = std::process::Command::new("git")
        .args(["worktree", "list", "--porcelain"])
        .current_dir(tmp.path())
        .output()
        .unwrap();
    let text = String::from_utf8_lossy(&out.stdout);
    assert!(
        text.contains("branch refs/heads/feat/slice"),
        "worktree registered on branch: {text}"
    );
}

#[rstest]
fn add_second_time_reports_conflict_with_hint() {
    let tmp = TempDir::new().unwrap();
    init_repo(tmp.path());

    gwt()
        .current_dir(tmp.path())
        .args(["add", "feat/x", "-b", "feat/x"])
        .assert()
        .success();

    gwt()
        .current_dir(tmp.path())
        .args(["add", "feat/x", "-b", "feat/x"])
        .assert()
        .code(1)
        .stderr(predicate::str::contains("Hint:"))
        .stderr(predicate::str::contains("already exists"));
}

#[rstest]
fn add_outside_a_repo_hints_to_run_inside_worktree() {
    let tmp = TempDir::new().unwrap(); // deliberately not a repository

    gwt()
        .current_dir(tmp.path())
        .args(["add", "feat/x", "-b", "feat/x"])
        .assert()
        .code(1)
        .stderr(predicate::str::contains("not inside a git worktree"))
        .stderr(predicate::str::contains("Hint:"));
}
