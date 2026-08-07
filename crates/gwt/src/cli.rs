//! Command-line interface (clap derive).

use std::path::PathBuf;

use clap::{Args, Parser, Subcommand, crate_version};

#[derive(Parser)]
#[command(name = "gwt", about = "Git worktree helper")]
#[command(arg_required_else_help = true)]
#[command(version = crate_version!())]
pub struct Cli {
    #[command(subcommand)]
    pub command: Commands,
}

#[derive(Subcommand)]
pub enum Commands {
    /// Add a new worktree
    Add {
        /// Create a worktree at <PATH> (relative paths resolve from the repo root).
        path: PathBuf,
        #[command(flatten)]
        args: AddArgs,
    },
}

#[derive(Args)]
pub struct AddArgs {
    /// Create a new branch named <BRANCH> and check it out in the new worktree.
    #[arg(short = 'b')]
    pub branch: String,
    /// Start at <COMMIT-ISH> instead of HEAD.
    #[arg(value_name = "COMMIT-ISH")]
    pub commit: Option<String>,
}
