//! End-to-end tests for `gwt add` against real git (assert_cmd + tempfile).

mod common;

use predicates::prelude::*;
use rstest::rstest;
use tempfile::TempDir;

use common::gwt;
use common::init_repo;

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
fn add_from_inside_a_worktree_resolves_relative_to_workspace_root() {
    let tmp = TempDir::new().unwrap();
    let src = tmp.path().join("src-repo");
    init_repo(&src);

    gwt()
        .current_dir(tmp.path())
        .args(["init"])
        .arg(src.to_str().unwrap())
        .assert()
        .success();
    let ws = tmp.path().join("src-repo-workspace");

    // Seed the `feat` slot.
    gwt()
        .current_dir(&ws)
        .args(["add", "-b", "feat/x", "feat"])
        .assert()
        .success();

    // Invoke from INSIDE the feat worktree: `fix/y` must still resolve to
    // ws/fix/y (sibling of .bare), not ws/feat/fix/y.
    gwt()
        .current_dir(ws.join("feat"))
        .args(["add", "-b", "fix/y", "fix"])
        .assert()
        .success();

    let feat = ws.join("feat");
    let fix = ws.join("fix");
    assert!(
        feat.join(".git").exists() && fix.join(".git").exists(),
        "both slots exist at ws/feat and ws/fix"
    );
    assert!(
        !fix.join("feat").join("fix").exists(),
        "`fix` must not land inside the feat worktree"
    );
    let out = std::process::Command::new("git")
        .args(["worktree", "list", "--porcelain"])
        .current_dir(ws.join(".bare"))
        .output()
        .unwrap();
    let text = String::from_utf8_lossy(&out.stdout);
    assert!(
        text.contains("branch refs/heads/fix/y"),
        "fix/y registered in bare repo: {text}"
    );
}

#[rstest]
fn shortcut_commands_fill_the_three_slots() {
    let tmp = TempDir::new().unwrap();
    let src = tmp.path().join("src-repo");
    init_repo(&src);
    gwt()
        .current_dir(tmp.path())
        .args(["init"])
        .arg(src.to_str().unwrap())
        .assert()
        .success();
    let ws = tmp.path().join("src-repo-workspace");

    gwt()
        .current_dir(&ws)
        .args(["add-feat", "-b", "feat/q"])
        .assert()
        .success();
    gwt()
        .current_dir(&ws)
        .args(["add-fix", "-b", "fix/r"])
        .assert()
        .success();
    gwt()
        .current_dir(&ws)
        .args(["add-pr", "-b", "pr/s"])
        .assert()
        .success();

    for folder in ["feat", "fix", "pr"] {
        let slot = ws.join(folder);
        assert!(
            slot.join(".git").exists(),
            "{folder}/ worktree exists at the slot path"
        );
        assert!(
            !slot.join(folder).exists(),
            "{folder} must not nest inside itself"
        );
    }
    let out = std::process::Command::new("git")
        .args(["worktree", "list", "--porcelain"])
        .current_dir(ws.join(".bare"))
        .output()
        .unwrap();
    let text = String::from_utf8_lossy(&out.stdout);
    for branch in ["feat/q", "fix/r", "pr/s"] {
        assert!(
            text.contains(&format!("branch refs/heads/{branch}")),
            "{branch} registered in bare repo: {text}"
        );
    }
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

#[rstest]
fn add_with_absolute_path_uses_it_verbatim() {
    let tmp = TempDir::new().unwrap();
    init_repo(tmp.path());

    let abs = tmp.path().join("absolute-slot");
    gwt()
        .current_dir(tmp.path())
        .arg("add")
        .arg(&abs)
        .args(["-b", "feat/abs"])
        .assert()
        .success();

    assert!(
        abs.join(".git").exists(),
        "absolute path used verbatim as the worktree"
    );
}

#[rstest]
fn add_can_start_from_a_specific_commit() {
    let tmp = TempDir::new().unwrap();
    init_repo(tmp.path());

    gwt()
        .current_dir(tmp.path())
        .args(["add", "feat/pinned", "-b", "feat/pinned", "HEAD"])
        .assert()
        .success();

    let out = std::process::Command::new("git")
        .args(["rev-parse", "refs/heads/feat/pinned"])
        .current_dir(tmp.path())
        .output()
        .unwrap();
    let head = std::process::Command::new("git")
        .args(["rev-parse", "HEAD"])
        .current_dir(tmp.path())
        .output()
        .unwrap();
    let branch = String::from_utf8_lossy(&out.stdout);
    let head = String::from_utf8_lossy(&head.stdout);
    assert_eq!(
        branch.trim(),
        head.trim(),
        "worktree branch starts at the requested commit"
    );
}
