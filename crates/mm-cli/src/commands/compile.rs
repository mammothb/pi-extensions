use std::path::{Path, PathBuf};

use anyhow::{Result, anyhow};
use log::{error, warn};

use crate::claude;
use crate::commands::ExitStatus;
use crate::lex::lex;
use crate::paths::{create_output_dir, expand_paths};
use crate::pi;
use crate::pipeline::format::{build_section_data, compile_full, format_sections_json};
use crate::pipeline::noise::filter_noise;
use crate::pipeline::normalize::normalize;
use crate::types::Message;

pub fn execute(
    inputs: Vec<String>,
    output_dir: Option<PathBuf>,
    pi: bool,
    json: bool,
    no_stats: bool,
    keep: u32,
    brief: bool,
) -> Result<ExitStatus> {
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
        compile_one(path, output_dir.as_deref(), pi, json, no_stats, keep, brief)?;
    }

    Ok(ExitStatus::Success)
}

/// Find user-turn boundary indices: each is the position of a user message.
/// Returns indices in the message slice where each user turn starts.
fn user_turn_indices(messages: &[Message]) -> Vec<usize> {
    messages
        .iter()
        .enumerate()
        .filter(|(_, m)| m.role == "user")
        .map(|(i, _)| i)
        .collect()
}

/// Split messages at the Nth-from-last user turn.
/// Returns (to_summarize, to_keep). If keep >= user turns or keep == 0,
/// returns (messages, empty).
fn split_at_keep(messages: &[Message], keep: u32) -> (&[Message], &[Message]) {
    if keep == 0 {
        return (messages, &[]);
    }
    let indices = user_turn_indices(messages);
    let n = keep as usize;
    if indices.len() <= n {
        return (messages, &[]);
    }
    let split_at = indices[indices.len() - n];
    (&messages[..split_at], &messages[split_at..])
}

const KEPT_TAIL_HEADER: &str = "══════════════════════════════════════════════════════════════════════════\n\
     [tail — kept verbatim]\n\
     ══════════════════════════════════════════════════════════════════════════";

fn compile_one(
    path: &Path,
    output_dir: Option<&Path>,
    pi: bool,
    json: bool,
    no_stats: bool,
    keep: u32,
    brief: bool,
) -> Result<()> {
    let _output_dir = create_output_dir(path, output_dir)?;
    let stem = path
        .file_stem()
        .and_then(|s| s.to_str())
        .ok_or_else(|| anyhow!("{path:?}: not a regular file"))?;

    let records = lex(path)?;
    let all_messages = if pi {
        pi::parse::parse(&records)
    } else {
        claude::parse::parse(records)
    };

    let (to_summarize, to_keep) = split_at_keep(&all_messages, keep);

    if json {
        let blocks = filter_noise(normalize(to_summarize));
        let data = build_section_data(&blocks);
        let json = serde_json::to_string_pretty(&format_sections_json(&data))?;
        println!("{stem}: {json}");
        return Ok(());
    }

    let mut output = String::new();

    // Summarize portion
    if !to_summarize.is_empty() {
        let blocks = filter_noise(normalize(to_summarize));
        if brief || pi {
            output.push_str(&compile_full(&blocks));
        } else {
            output.push_str(&claude::ir::emit_full(to_summarize, no_stats));
        }
    }

    // Append kept tail verbatim
    if !to_keep.is_empty() {
        if !output.is_empty() {
            output.push_str("\n\n");
        }
        output.push_str(KEPT_TAIL_HEADER);
        output.push_str("\n\n");
        // Always render kept tail as full transcript (not section-based)
        output.push_str(&claude::ir::emit_full(to_keep, true));
    }

    println!("{stem}:");
    println!("{output}");

    Ok(())
}
