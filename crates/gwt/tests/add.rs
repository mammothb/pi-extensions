//! End-to-end tests for `gwt add` against real git (assert_cmd + tempfile).

mod common;

use assert_cmd::Command;
use predicates::prelude::*;
use rstest::rstest;
use tempfile::TempDir;

use common::init_repo;

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
fn add_from_workspace_root_uses_bare_and_resolves_feat_under_cwd() {
    let tmp = TempDir::new().unwrap();
    let src = tmp.path().join("src-repo");
    init_repo(&src);

    // Scaffold the workspace: bare clone at `.bare`.
    gwt()
        .current_dir(tmp.path())
        .args(["init"])
        .arg(src.to_str().unwrap())
        .assert()
        .success();
    let ws = tmp.path().join("src-repo-workspace");

    // Add from the workspace ROOT (not inside a checkout), so detection must
    // find `.bare` and resolve `feat/q` under the workspace dir.
    gwt()
        .current_dir(&ws)
        .args(["add", "feat/q", "-b", "feat/q"])
        .assert()
        .success();

    assert!(
        ws.join("feat").join("q").join(".git").exists(),
        "worktree checked out at ws/feat/q"
    );
    let out = std::process::Command::new("git")
        .args(["worktree", "list", "--porcelain"])
        .current_dir(ws.join(".bare"))
        .output()
        .unwrap();
    let text = String::from_utf8_lossy(&out.stdout);
    assert!(
        text.contains("branch refs/heads/feat/q"),
        "branch registered in bare repo: {text}"
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
