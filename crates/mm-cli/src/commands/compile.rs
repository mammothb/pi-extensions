use std::path::{Path, PathBuf};

use anyhow::{Result, anyhow};
use log::{error, warn};

use crate::claude;
use crate::commands::ExitStatus;
use crate::lex::lex;
use crate::paths::{create_output_dir, expand_paths};
use crate::pi;
use crate::pipeline::brief::compile_brief;
use crate::pipeline::noise::filter_noise;
use crate::pipeline::normalize::normalize;

pub fn execute(inputs: Vec<String>, output_dir: Option<PathBuf>, pi: bool) -> Result<ExitStatus> {
    let paths = expand_paths(&inputs);
    let (valid, invalid): (Vec<_>, Vec<_>) = paths.iter().partition(|p| p.is_file());
    for path in &invalid {
        warn!("skipping {path:?}: not a regular file");
    }

    if valid.is_empty() {
        error!("no valid input files");
        return Ok(ExitStatus::Error);
    }

    for path in valid {
        compile_one(path, output_dir.as_deref(), pi)?;
    }

    Ok(ExitStatus::Success)
}

fn compile_one(path: &Path, output_dir: Option<&Path>, pi: bool) -> Result<()> {
    let _output_dir = create_output_dir(path, output_dir)?;
    let stem = path
        .file_stem()
        .and_then(|s| s.to_str())
        .ok_or_else(|| anyhow!("{path:?}: not a regular file"))?;

    let records = lex(path)?;
    let messages = if pi {
        pi::parse::parse(&records)
    } else {
        claude::parse::parse(records)
    };

    let blocks = normalize(&messages);
    let blocks = filter_noise(blocks);
    let brief = compile_brief(&blocks);

    println!("{stem}: {blocks:?}");
    println!("--- brief ---");
    println!("{brief}");

    Ok(())
}
