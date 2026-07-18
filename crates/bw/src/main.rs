use std::process::ExitCode;

use clap::Parser;

use bw_helper::cli::Cli;

fn main() -> ExitCode {
    let cli = Cli::parse();

    match cli.execute() {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            eprintln!("bw: {e:#}");
            ExitCode::FAILURE
        }
    }
}
