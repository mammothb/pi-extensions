//! End-to-end tests for `gwt init`.

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
fn init_derives_workspace_name_and_clones_bare_with_fetch_mirror() {
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
    assert!(
        ws.join(".bare").exists(),
        "bare clone at {}",
        ws.join(".bare").display()
    );

    let out = std::process::Command::new("git")
        .args(["config", "--get", "remote.origin.fetch"])
        .current_dir(ws.join(".bare"))
        .output()
        .unwrap();
    let text = String::from_utf8_lossy(&out.stdout);
    assert_eq!(
        text.trim(),
        "+refs/heads/*:refs/remotes/origin/*",
        "fetch refspec mirrors all remote branches"
    );
}

#[rstest]
fn init_with_explicit_name_uses_it_verbatim() {
    let tmp = TempDir::new().unwrap();
    let src = tmp.path().join("src-repo");
    init_repo(&src);

    gwt()
        .current_dir(tmp.path())
        .args(["init", "-n", "myws"])
        .arg(src.to_str().unwrap())
        .assert()
        .success();

    assert!(tmp.path().join("myws").join(".bare").exists());
}

#[rstest]
fn init_refuses_existing_workspace_dir() {
    let tmp = TempDir::new().unwrap();
    let src = tmp.path().join("src-repo");
    init_repo(&src);
    fs_err::create_dir_all(tmp.path().join("existing-ws")).unwrap();

    gwt()
        .current_dir(tmp.path())
        .args(["init", "-n", "existing-ws"])
        .arg(src.to_str().unwrap())
        .assert()
        .code(1)
        .stderr(predicate::str::contains("already exists"));
}

#[rstest]
fn init_rejects_garbage_url() {
    let tmp = TempDir::new().unwrap();

    gwt()
        .current_dir(tmp.path())
        .args(["init", "https://github.com/user/"])
        .assert()
        .code(1)
        .stderr(predicate::str::contains("invalid repository URL"));
}
