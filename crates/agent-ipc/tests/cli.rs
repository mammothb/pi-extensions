use std::env;
use std::path::PathBuf;

use agent_ipc::cli::Cli;
use clap::Parser;
use rstest::rstest;

fn cli_with_socket(socket_path: &str) -> Cli {
    Cli::parse_from(["aipcd", "--socket-path", socket_path])
}

// =======================
// custom_socket_path_flag
// =======================

#[rstest]
fn custom_socket_path_flag() {
    let resolved = cli_with_socket("/tmp/test.sock")
        .resolve_socket_path()
        .unwrap();
    assert_eq!(resolved, PathBuf::from("/tmp/test.sock"));
}

// =================
// shellexpand_tilde
// =================

#[rstest]
fn shellexpand_tilde() {
    let home = env::var("HOME").unwrap();
    let resolved = cli_with_socket("~/foo.sock").resolve_socket_path().unwrap();
    assert_eq!(resolved, PathBuf::from(home).join("foo.sock"));
}
