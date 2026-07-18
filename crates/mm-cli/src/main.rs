use std::io::Write;
use std::process::ExitCode;

use clap::Parser;
use env_logger::Env;
use log::error;

use mm_cli::cli::{Cli, Commands};
use mm_cli::commands::{self, ExitStatus};

fn main() -> ExitCode {
    let env = Env::default()
        .filter_or("MM_LOG_LEVEL", "warn")
        .write_style_or("MM_LOG_STYLE", "never");
    env_logger::Builder::from_env(env)
        .format(|buf, record| writeln!(buf, "{}: {}", record.level(), record.args()))
        .init();

    let cli = Cli::parse();

    let result = match cli.command {
        Commands::Compile(args) => commands::compile::execute(
            args.paths,
            args.output_dir,
            args.pi,
            args.json,
            args.no_stats,
            args.engine.keep,
            args.brief,
        ),
        Commands::Search(args) => {
            commands::search::execute(args.paths, args.query, args.page, args.json, args.pi)
        }
        Commands::Pi(_args) => commands::pi::execute(),
    };
    match result {
        Ok(code) => code.into(),
        Err(err) => {
            error!("{err}");
            ExitStatus::Error.into()
        }
    }
}
