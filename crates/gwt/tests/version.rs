//! End-to-end tests for the `GWT_GIT` / version guard.

#[allow(dead_code)] // common helpers are shared; this binary uses few
mod common;

use predicates::prelude::*;
use rstest::rstest;
use tempfile::TempDir;

use common::gwt;

#[cfg(unix)]
#[rstest]
fn version_guard_rejects_old_git_with_hint() {
    let tmp = TempDir::new().unwrap();
    let fake = tmp.path().join("fake-git");
    fs_err::write(&fake, "#!/bin/sh\necho 'git version 2.30.0'\n").unwrap();
    // Executable bit directly on the file's permissions (fs_err mirrors
    // std::fs::set_permissions, which the workspace policy disallows).
    use std::os::unix::fs::PermissionsExt;
    let mut perms = fs_err::metadata(&fake).unwrap().permissions();
    perms.set_mode(perms.mode() | 0o111);
    fs_err::set_permissions(&fake, perms).unwrap();

    gwt()
        .env("GWT_GIT", &fake)
        .arg("purge")
        .assert()
        .code(2)
        .stderr(predicate::str::contains("git 2.30.0 is too old"))
        .stderr(predicate::str::contains("requires git >= 2.40.0"))
        .stderr(predicate::str::contains("Hint:"));
}

#[cfg(unix)]
#[rstest]
fn version_guard_reports_unparseable_version_output() {
    // A stub that echoes args instead of a version string: the guard must
    // fail with a repro-able parse error, not a silent crash.
    let tmp = TempDir::new().unwrap();
    let fake = tmp.path().join("fake-git");
    fs_err::write(&fake, "#!/bin/sh\nprintf '%s ' \"$@\"\necho\n").unwrap();
    use std::os::unix::fs::PermissionsExt;
    let mut perms = fs_err::metadata(&fake).unwrap().permissions();
    perms.set_mode(perms.mode() | 0o111);
    fs_err::set_permissions(&fake, perms).unwrap();

    gwt()
        .env("GWT_GIT", &fake)
        .arg("purge")
        .assert()
        .code(2)
        .stderr(predicate::str::contains("unrecognized version string"))
        .stderr(predicate::str::contains("Hint:"));
}
