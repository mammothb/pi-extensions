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
    /// Add a worktree in the feat folder on a new branch
    AddFeat(AddArgs),
    /// Add a worktree in the fix folder on a new branch
    AddFix(AddArgs),
    /// Add a worktree in the pr folder on a new branch
    AddPr(AddArgs),
    /// Initialize a new workspace
    Init(InitArgs),
    /// Remove config sections for branches whose branch no longer exists
    Purge(PurgeArgs),
}

#[derive(Args)]
pub struct AddArgs {
    /// Create a new branch named <BRANCH> and check it out in the new worktree.
    #[arg(short, long)]
    pub branch: String,
    /// Start at <COMMIT-ISH> instead of HEAD.
    #[arg(value_name = "COMMIT-ISH")]
    pub commit: Option<String>,
}

#[derive(Args)]
pub struct InitArgs {
    /// The repository to clone, and to grow worktrees from.
    pub url: String,
    /// Name the workspace directory (defaults to "<repo>-workspace").
    #[arg(short, long)]
    pub name: Option<String>,
}

#[derive(Args)]
pub struct PurgeArgs {
    /// Report what would be removed without removing anything.
    #[arg(short, long)]
    pub dry_run: bool,
}
