use std::path::PathBuf;

use anyhow::Result;
use clap::Parser;

use crate::binds::build_bwrap_args;
use crate::config::load_config;

/// bwrap sandbox for pi
#[derive(Parser)]
#[command(name = "bw", version)]
pub struct Cli {
    /// Workspace root (default: current directory)
    #[arg(long, value_name = "PATH")]
    config: Option<PathBuf>,

    /// Validate config only, exit 0 if valid
    #[arg(long, conflicts_with = "print_args")]
    validate: bool,

    /// Print bwrap args that would run, don't spawn
    #[arg(long, conflicts_with = "validate")]
    print_args: bool,

    /// Command to run inside the sandbox (default: $SHELL)
    #[arg(trailing_var_arg = true, allow_hyphen_values = true)]
    command: Vec<String>,
}

impl Cli {
    pub fn execute(self) -> Result<()> {
        let cwd = self
            .config
            .unwrap_or_else(|| std::env::current_dir().expect("cwd"));

        let config = load_config(&cwd)?;

        let command = if self.command.is_empty() {
            vec![std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".into())]
        } else {
            self.command
        };

        let args = build_bwrap_args(&config, &cwd, &command);

        if self.validate {
            return Ok(());
        }

        if self.print_args {
            print_args(&args);
            return Ok(());
        }

        exec_bwrap(&args);
    }
}

fn print_args(args: &[String]) {
    let mut i = 0;
    while i < args.len() {
        let arg = &args[i];

        if i == 0 {
            // "bwrap"
            println!("{arg}");
        } else if i == args.len() - 1 {
            // Last arg — no continuation
            println!("  {arg}");
        } else if arg == "--" {
            println!("  --");
        } else if arg.starts_with("--") {
            // Flag + all following values on one line
            let mut line = format!("  {arg}");
            while i + 1 < args.len() && !args[i + 1].starts_with("--") {
                i += 1;
                line.push_str(&format!(" {}", args[i]));
            }
            if i < args.len() - 1 {
                line.push_str(" \\");
            }
            println!("{line}");
        } else {
            println!("  {arg} \\");
        }
        i += 1;
    }
}

#[cfg(unix)]
fn exec_bwrap(args: &[String]) -> ! {
    use std::os::unix::process::CommandExt;

    let err = std::process::Command::new("bwrap").args(&args[1..]).exec();
    // exec only returns on error
    eprintln!("bw: failed to exec bwrap: {err}");
    std::process::exit(1);
}

#[cfg(not(unix))]
fn exec_bwrap(_args: &[String]) -> ! {
    eprintln!("bw: bwrap requires Linux");
    std::process::exit(1);
}
