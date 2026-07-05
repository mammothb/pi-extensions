use std::path::PathBuf;

use clap::{Args, Parser, Subcommand, crate_version};

#[derive(Parser)]
#[command(about = "Session conversation helper.")]
#[command(arg_required_else_help = true)]
#[command(version = crate_version!())]
pub struct Cli {
    #[command(subcommand)]
    pub command: Commands,
}

#[derive(Subcommand)]
pub enum Commands {
    /// Compile JSONL conversations logs into text files
    Compile(CompileArgs),
    /// Run as a Pi extension backend (reads JSON on stdin, writes summary on
    /// stdout)
    Pi(PiArgs),
}

#[derive(Args)]
pub struct EngineConfig {
    /// Token truncation limit for assistant text
    #[arg(short, long, value_name = "N", default_value_t = 128)]
    pub truncate: u32,
    /// Token truncation limit for user text
    #[arg(short = 'u', long, value_name = "N", default_value_t = 256)]
    pub truncate_user: u32,
    /// Keep last N user turns as tail
    #[arg(long, value_name = "N", default_value_t = 1)]
    pub keep: u32,
    /// Verbose output (-v for info, -vv for debug)
    #[arg(short, long, action = clap::ArgAction::Count)]
    pub verbose: u8,
}

#[derive(Args)]
pub struct CompileArgs {
    #[command(flatten)]
    pub engine: EngineConfig,
    /// JSONL files to compile. Supports blob patterns like **/*.jsonl
    #[arg(required = true, value_name = "INPUT")]
    pub paths: Vec<String>,
    /// Output directory [default: same as input]
    #[arg(short, long, value_name = "DIR")]
    pub output_dir: Option<PathBuf>,
    /// Suppress stats footer in .txt output
    #[arg(long)]
    pub no_stats: bool,
    /// Parse input as Pi-format JSONL [default: Claude format]
    #[arg(long)]
    pub pi: bool,
    /// Output JSON instead of human-readable text
    #[arg(long)]
    pub json: bool,
}

#[derive(Args)]
pub struct PiArgs {
    #[command(flatten)]
    pub engine: EngineConfig,
}
