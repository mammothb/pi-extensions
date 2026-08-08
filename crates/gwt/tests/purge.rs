//! End-to-end tests for `gwt purge` against real git.

mod common;

use predicates::prelude::*;
use rstest::rstest;
use tempfile::TempDir;

use common::gwt;
use common::{init_repo, run_git};

/// A workspace whose bare repo has one tracked branch config with no ref
/// (`dead`) and one with a live ref but no worktree (`idle`).
fn scaffold_workspace(tmp: &TempDir) -> std::path::PathBuf {
    let src = tmp.path().join("src-repo");
    init_repo(&src);

    gwt()
        .current_dir(tmp.path())
        .args(["init"])
        .arg(src.to_str().unwrap())
        .assert()
        .success();
    let ws = tmp.path().join("src-repo-workspace");
    let bare = ws.join(".bare");

    run_git(&bare, &["config", "branch.dead.remote", "origin"]);
    run_git(&bare, &["config", "branch.dead.merge", "refs/heads/dead"]); // no such ref
    run_git(&bare, &["branch", "idle"]); // live ref, never checked out
    run_git(&bare, &["config", "branch.idle.remote", "origin"]);
    run_git(&bare, &["config", "branch.idle.merge", "refs/heads/idle"]);
    ws
}

fn config_value(ws: &std::path::Path, key: &str) -> Option<String> {
    let out = std::process::Command::new("git")
        .args(["config", "--get", key])
        .current_dir(ws.join(".bare"))
        .output()
        .unwrap();
    (out.status.success()).then(|| String::from_utf8_lossy(&out.stdout).trim().to_owned())
}

#[rstest]
fn purge_removes_config_for_branches_without_refs_only() {
    let tmp = TempDir::new().unwrap();
    let ws = scaffold_workspace(&tmp);

    gwt().current_dir(&ws).arg("purge").assert().success();

    assert_eq!(
        config_value(&ws, "branch.dead.merge"),
        None,
        "dead branch config removed"
    );
    assert_eq!(
        config_value(&ws, "branch.idle.remote").as_deref(),
        Some("origin"),
        "live branch without a worktree keeps its config"
    );
}

#[rstest]
fn purge_dry_run_removes_nothing() {
    let tmp = TempDir::new().unwrap();
    let ws = scaffold_workspace(&tmp);

    gwt()
        .current_dir(&ws)
        .args(["purge", "--dry-run"])
        .assert()
        .success()
        .stderr(predicate::str::contains("Would remove stale config"))
        .stderr(predicate::str::contains("branch.dead"));

    assert!(
        config_value(&ws, "branch.dead.merge").is_some(),
        "dry run must not remove the dead section"
    );
}

#[rstest]
fn purge_outside_a_repo_hints_like_other_commands() {
    let tmp = TempDir::new().unwrap(); // deliberately not a repository

    gwt()
        .current_dir(tmp.path())
        .arg("purge")
        .assert()
        .code(1)
        .stderr(predicate::str::contains("not inside a git worktree"))
        .stderr(predicate::str::contains("Hint:"));
}
