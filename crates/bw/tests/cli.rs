use assert_cmd::Command;
use predicates::prelude::*;
use rstest::rstest;
use std::io::Write;
use tempfile::TempDir;

fn write_config(dir: &TempDir, json: &str) {
    let pi_dir = dir.path().join(".pi");
    fs_err::create_dir_all(&pi_dir).unwrap();
    let mut f = fs_err::File::create(pi_dir.join("bw.json")).unwrap();
    f.write_all(json.as_bytes()).unwrap();
}

fn bw() -> Command {
    Command::cargo_bin("bw").unwrap()
}

// ==========
// help_flag
// ==========

#[rstest]
fn help_flag() {
    bw().arg("--help")
        .assert()
        .success()
        .stdout(predicate::str::contains("bwrap sandbox for pi"));
}

// =============
// version_flag
// =============

#[rstest]
fn version_flag() {
    bw().arg("--version")
        .assert()
        .success()
        .stdout(predicate::str::contains(env!("CARGO_PKG_VERSION")));
}

// =====================
// validate_valid_config
// =====================

#[rstest]
fn validate_valid_config() {
    let dir = TempDir::new().unwrap();

    // Create a directory that the config binds to
    let sub = dir.path().join("sub");
    fs_err::create_dir_all(&sub).unwrap();

    write_config(
        &dir,
        &format!(
            r#"{{"binds": {{"ro": ["{sub}"], "rw": []}}}}"#,
            sub = sub.display(),
        ),
    );

    bw().arg("--config")
        .arg(dir.path())
        .arg("--validate")
        .assert()
        .success()
        .stderr(predicate::str::is_empty());
}

// =======================
// validate_invalid_config
// =======================

#[rstest]
fn validate_invalid_config() {
    let dir = TempDir::new().unwrap();
    let missing = dir.path().join("does-not-exist");

    write_config(
        &dir,
        &format!(
            r#"{{"binds": {{"ro": ["{missing}"]}}}}"#,
            missing = missing.display(),
        ),
    );

    bw().arg("--config")
        .arg(dir.path())
        .arg("--validate")
        .assert()
        .failure()
        .stderr(predicate::str::contains("path(s) not found"));
}

// ===========================================
// validate_mutually_exclusive_with_print_args
// ===========================================

#[rstest]
fn validate_mutually_exclusive_with_print_args() {
    bw().arg("--validate")
        .arg("--print-args")
        .assert()
        .failure();
}

// ========================
// print_args_output_format
// ========================

#[rstest]
fn print_args_output_format() {
    let dir = TempDir::new().unwrap();
    let sub = dir.path().join("sub");
    fs_err::create_dir_all(&sub).unwrap();

    write_config(
        &dir,
        &format!(
            r#"{{"binds": {{"ro": ["{sub}"], "rw": []}}}}"#,
            sub = sub.display(),
        ),
    );

    bw().arg("--config")
        .arg(dir.path())
        .arg("--print-args")
        .arg("--")
        .arg("echo")
        .arg("hello")
        .assert()
        .success()
        .stdout(predicate::str::starts_with("bwrap\n"))
        .stdout(predicate::str::contains("--unshare-cgroup"))
        .stdout(predicate::str::contains("  echo\n"));
}

// =============================
// config_flag_changes_workspace
// =============================

#[rstest]
fn config_flag_changes_workspace() {
    let dir = TempDir::new().unwrap();
    let sub = dir.path().join("sub");
    fs_err::create_dir_all(&sub).unwrap();

    write_config(
        &dir,
        &format!(
            r#"{{"binds": {{"ro": ["{sub}"], "rw": []}}}}"#,
            sub = sub.display(),
        ),
    );

    // Run from a different CWD — --config should make it load from dir
    let tmp = TempDir::new().unwrap();
    bw().current_dir(tmp.path())
        .arg("--config")
        .arg(dir.path())
        .arg("--validate")
        .assert()
        .success();
}

// ============================
// no_command_defaults_to_shell
// ============================

#[rstest]
fn no_command_defaults_to_shell() {
    let dir = TempDir::new().unwrap();
    let sub = dir.path().join("sub");
    fs_err::create_dir_all(&sub).unwrap();

    write_config(
        &dir,
        &format!(
            r#"{{"binds": {{"ro": ["{sub}"], "rw": []}}}}"#,
            sub = sub.display(),
        ),
    );

    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".into());

    bw().arg("--config")
        .arg(dir.path())
        .arg("--print-args")
        .assert()
        .success()
        .stdout(predicate::str::contains(format!("  {shell}\n")));
}

// =========================
// bw_binary_exists_and_runs
// =========================

#[rstest]
fn bw_binary_exists_and_runs() {
    bw().arg("--help").assert().success();
}

// ============================
// bw_validate_on_sample_config
// ============================

#[rstest]
fn bw_validate_on_sample_config() {
    // Same as validate_valid_config — verify through the full binary path.
    // (assert_cmd::Command::cargo_bin ensures we test the compiled binary.)
    let dir = TempDir::new().unwrap();
    let sub = dir.path().join("sub");
    fs_err::create_dir_all(&sub).unwrap();

    write_config(
        &dir,
        &format!(
            r#"{{"binds": {{"ro": ["{sub}"], "rw": []}}}}"#,
            sub = sub.display(),
        ),
    );

    bw().arg("--config")
        .arg(dir.path())
        .arg("--validate")
        .assert()
        .success();
}
