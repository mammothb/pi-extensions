//! `gwt` binary entry point.
//!
//! Thin shell over the library: initialize logging, parse the CLI, run the
//! version guard, dispatch, and render any failure with its hints. clap
//! handles its own parse errors / help / version (stdout, exit 0; usage
//! errors exit 2) before dispatch; everything after dispatch funnels through
//! [`CommandError::render`].

use std::io::Write;
use std::process::ExitCode;

use clap::Parser;
use env_logger::Env;

use gwt_helper::cli::{Cli, Commands};
use gwt_helper::commands;
use gwt_helper::error::{CommandError, internal_error};
use gwt_helper::external::Git;

fn main() -> ExitCode {
    let env = Env::default()
        .filter_or("GWT_LOG_LEVEL", "info")
        .write_style_or("GWT_LOG_STYLE", "never");
    env_logger::Builder::from_env(env)
        .format(|buf, record| writeln!(buf, "{}: {}", record.level(), record.args()))
        .init();

    let cli = Cli::parse();
    let git = Git::new();

    match run(&git, cli) {
        Ok(()) => ExitCode::SUCCESS,
        Err(err) => ExitCode::from(err.render()),
    }
}

fn run(git: &Git, cli: Cli) -> Result<(), CommandError> {
    git.check_version().map_err(|err| {
        internal_error(err).hinted("upgrade git, or point GWT_GIT at a newer binary")
    })?;

    match cli.command {
        Commands::Add { path, args } => {
            commands::add::execute(git, &path, &args.branch, args.commit.as_deref())
        }
        Commands::Init(args) => commands::init::execute(git, &args.url, args.name.as_deref()),
        Commands::Purge(args) => commands::purge::execute(git, args.dry_run),
    }
}
