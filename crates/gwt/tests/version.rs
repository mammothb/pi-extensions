//! End-to-end tests for the `GWT_GIT` / version guard.

#[allow(dead_code)] // common helpers are shared; this binary uses few
mod common;

use predicates::prelude::*;
use rstest::rstest;
use tempfile::TempDir;

use common::gwt;

#[rstest]
fn version_guard_rejects_old_git_with_hint() {
    let tmp = TempDir::new().unwrap();
    let fake = tmp.path().join("fake-git");
    fs_err::write(&fake, "#!/bin/sh\necho 'git version 2.30.0'\n").unwrap();
    let status = std::process::Command::new("chmod")
        .args(["+x", fake.to_str().unwrap()])
        .status()
        .unwrap();
    assert!(status.success(), "chmod made the fake git executable");

    gwt()
        .env("GWT_GIT", &fake)
        .arg("purge")
        .assert()
        .code(2)
        .stderr(predicate::str::contains("git 2.30.0 is too old"))
        .stderr(predicate::str::contains("requires git >= 2.40.0"))
        .stderr(predicate::str::contains("Hint:"));
}

#[rstest]
fn version_guard_reports_unparseable_version_output() {
    // `/bin/echo` echoes its args instead of a version string: the guard
    // must fail with a repro-able parse error, not a silent crash.
    gwt()
        .env("GWT_GIT", "/bin/echo")
        .arg("purge")
        .assert()
        .code(2)
        .stderr(predicate::str::contains("unrecognized version string"))
        .stderr(predicate::str::contains("Hint:"));
}
