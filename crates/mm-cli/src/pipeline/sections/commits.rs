use std::{collections::HashSet, sync::LazyLock};

use regex::Regex;

use crate::types::NormalizedBlock;

// ============
// Public types
// ============

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CommitInfo {
    pub hash: Option<String>,
    pub message: String,
}

// ==============
// Regex patterns
// ==============

/// Matches `git commit -m "..."` or `git commit -m '...'` with escaped quotes.
static COMMIT_MSG_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r"git\s+commit[^\n]*?-m\s+(?:\x22((?:[^\x22\\]|\\.)*)\x22|'((?:[^'\\]|\\.)*)'|\$?'((?:[^'\\]|\\.)*)')",
    )
    .unwrap()
});

/// Bare 7–12 hex chars (git short hash).
static HASH_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\b([0-9a-fA-F]{7,12})\b").unwrap());

/// `[branch <hash>]` in typical git commit output.
static BRACKET_HASH_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\[\S+\s+([0-9a-fA-F]{7,12})\]").unwrap());

/// `<hash>..<hash>` range (e.g. in `git push` output).
static RANGE_HASH_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\b([0-9a-fA-F]{7,12})\.\.([0-9a-fA-F]{7,12})\b").unwrap());

// ==========
// Public API
// ==========

/// Extract git commits from bash commands in normalized blocks.
///
/// Handles both formats:
/// - **Pi:** `Bash` blocks with `command` and `output` inline.
/// - **Claude Code:** `ToolCall` (name `"Bash"`/`"bash"`) followed by
///   `ToolResult` within 3 blocks.
///
/// Duplicates are removed (by `{hash}::{message}` key). Results are
/// returned in encounter order (most recent last).
pub fn extract_commits(blocks: &[NormalizedBlock]) -> Vec<CommitInfo> {
    let mut commits: Vec<CommitInfo> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();

    for i in 0..blocks.len() {
        match &blocks[i] {
            // ── Claude Code format: ToolCall + look-ahead ToolResult ──
            NormalizedBlock::ToolCall { name, args, .. } if name == "Bash" || name == "bash" => {
                let cmd = args.get("command").and_then(|v| v.as_str()).unwrap_or("");
                let message = match extract_commit_message(cmd) {
                    Some(m) => m,
                    None => continue,
                };
                let hash = look_ahead_for_hash(blocks, i);
                let key = format!("{}::{}", hash.as_deref().unwrap_or(""), message);
                if seen.insert(key) {
                    commits.push(CommitInfo { hash, message });
                }
            }

            // ── Pi format: Bash block has command + output inline ──
            NormalizedBlock::Bash {
                command,
                output,
                source_index: _,
                exit_code: _,
            } => {
                let message = match extract_commit_message(command) {
                    Some(m) => m,
                    None => continue,
                };
                let hash = extract_hash_from_text(output);
                let key = format!("{}::{}", hash.as_deref().unwrap_or(""), message);
                if seen.insert(key) {
                    commits.push(CommitInfo { hash, message });
                }
            }

            _ => continue,
        }
    }

    commits
}

/// Format commits as `"hash: message"` lines, keeping the last `limit` entries.
pub fn format_commits(commits: &[CommitInfo], limit: usize) -> Vec<String> {
    let items = if commits.len() > limit {
        &commits[commits.len() - limit..]
    } else {
        commits
    };

    items
        .iter()
        .map(|c| match &c.hash {
            Some(h) => format!("{}: {}", h, c.message),
            None => c.message.clone(),
        })
        .collect()
}

// ===============
// Private helpers
// ===============

/// Extract commit message from a `git commit -m "..."` command line.
fn extract_commit_message(command: &str) -> Option<String> {
    let caps = COMMIT_MSG_RE.captures(command)?;
    let raw = caps
        .get(1)
        .or_else(|| caps.get(2))
        .or_else(|| caps.get(3))?;
    let cleaned = clean_message(raw.as_str());
    let msg = first_line_of(&cleaned);
    if msg.is_empty() {
        None
    } else {
        Some(msg.to_string())
    }
}

/// Un-escape `\"` → `"` and `\'` → `'` in commit messages.
fn clean_message(msg: &str) -> String {
    msg.replace("\\\"", "\"")
        .replace("\\'", "'")
        .trim()
        .to_string()
}

/// Take the first line of text, stripping trailing carriage returns.
fn first_line_of(text: &str) -> &str {
    text.split('\n').next().unwrap_or("").trim()
}

/// Look ahead up to 3 blocks after `idx` for a `ToolResult` belonging
/// to the same bash tool call, and extract a commit hash from its text.
fn look_ahead_for_hash(blocks: &[NormalizedBlock], idx: usize) -> Option<String> {
    let end = (idx + 4).min(blocks.len());
    for b in &blocks[idx + 1..end] {
        if let NormalizedBlock::ToolResult { name, text, .. } = b
            && (name == "Bash" || name == "bash")
            && let Some(h) = extract_hash_from_text(text)
        {
            return Some(h);
        }
    }
    None
}

/// Try to find a short hash in git output text.
fn extract_hash_from_text(text: &str) -> Option<String> {
    // Bracket: `[main a1b2c3d]`
    if let Some(caps) = BRACKET_HASH_RE.captures(text) {
        return Some(caps.get(1).unwrap().as_str().to_string());
    }
    // Range: `a1b2c3d..d4e5f6a` → take second
    if let Some(caps) = RANGE_HASH_RE.captures(text) {
        return Some(caps.get(2).unwrap().as_str().to_string());
    }
    // Bare hash
    HASH_RE
        .captures(text)
        .map(|c| c.get(1).unwrap().as_str().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use rstest::rstest;
    use serde_json::json;

    fn tool_call_bash(command: &str, idx: usize) -> NormalizedBlock {
        NormalizedBlock::ToolCall {
            name: "Bash".into(),
            args: json!({"command": command}),
            source_index: idx,
        }
    }

    fn tool_call_bash_lowercase(command: &str, idx: usize) -> NormalizedBlock {
        NormalizedBlock::ToolCall {
            name: "bash".into(),
            args: json!({"command": command}),
            source_index: idx,
        }
    }

    fn tool_result_bash(text: &str, idx: usize) -> NormalizedBlock {
        NormalizedBlock::ToolResult {
            name: "Bash".into(),
            text: text.into(),
            source_index: idx,
        }
    }

    fn bash_block(command: &str, output: &str, idx: usize) -> NormalizedBlock {
        NormalizedBlock::Bash {
            command: command.into(),
            output: output.into(),
            exit_code: Some(0),
            source_index: idx,
        }
    }

    // ======================
    // extract_commit_message
    // ======================

    #[rstest]
    #[case::double_quotes(r#"git commit -m "fix bug""#, Some("fix bug"))]
    #[case::single_quotes("git commit -m 'add feature'", Some("add feature"))]
    #[case::escaped_quotes(r#"git commit -m "fix \"bug\" escape""#, Some("fix \"bug\" escape"))]
    #[case::multi_word_flags("git commit --amend -m \"update stuff\"", Some("update stuff"))]
    #[case::no_commit_message("git status", None)]
    #[case::multiline_message_takes_first_line(
        "git commit -m \"line one\nline two\"",
        Some("line one")
    )]
    fn commit_message_extraction(#[case] command: &str, #[case] expected: Option<&str>) {
        assert_eq!(extract_commit_message(command).as_deref(), expected);
    }

    // ======================
    // extract_hash_from_text
    // ======================

    #[rstest]
    fn hash_from_bracket_pattern() {
        let output = "[main a1b2c3d] fix bug";
        assert_eq!(extract_hash_from_text(output).as_deref(), Some("a1b2c3d"));
    }

    #[rstest]
    fn hash_from_range_pattern_takes_second() {
        let output = "d1e2f3a..a1b2c3d  main -> main";
        assert_eq!(extract_hash_from_text(output).as_deref(), Some("a1b2c3d"));
    }

    #[rstest]
    fn hash_from_bare_hex() {
        let output = "commit a1b2c3d";
        assert_eq!(extract_hash_from_text(output).as_deref(), Some("a1b2c3d"));
    }

    #[rstest]
    fn hash_no_match_returns_none() {
        assert_eq!(extract_hash_from_text("nothing here"), None);
    }

    // ===============
    // extract_commits
    // ===============

    #[rstest]
    fn claude_format_tool_call_with_result() {
        let blocks = [
            tool_call_bash(r#"git commit -m "fix bug""#, 0),
            tool_result_bash("[main a1b2c3d] fix bug\n1 file changed", 1),
        ];
        let commits = extract_commits(&blocks);
        assert_eq!(commits.len(), 1);
        assert_eq!(commits[0].hash.as_deref(), Some("a1b2c3d"));
        assert_eq!(commits[0].message, "fix bug");
    }

    #[rstest]
    fn claude_format_hash_from_range() {
        let blocks = [
            tool_call_bash(r#"git commit -m "add feature""#, 0),
            tool_result_bash("d1e2f3a..a1b2c3d  main -> main", 1),
        ];
        let commits = extract_commits(&blocks);
        assert_eq!(commits.len(), 1);
        assert_eq!(commits[0].hash.as_deref(), Some("a1b2c3d"));
        assert_eq!(commits[0].message, "add feature");
    }

    #[rstest]
    fn claude_format_tool_call_lowercase_bash() {
        let blocks = [
            tool_call_bash_lowercase(r#"git commit -m "fix bug""#, 0),
            tool_result_bash("[main a1b2c3d] fix bug", 1),
        ];
        let commits = extract_commits(&blocks);
        assert_eq!(commits.len(), 1);
        assert_eq!(commits[0].message, "fix bug");
    }

    #[rstest]
    fn claude_format_no_git_commit_ignored() {
        let blocks = [tool_call_bash("ls -la", 0), tool_result_bash("total 0", 1)];
        let commits = extract_commits(&blocks);
        assert!(commits.is_empty());
    }

    #[rstest]
    fn claude_format_hash_not_in_next_3_blocks() {
        let blocks = [
            tool_call_bash(r#"git commit -m "fix bug""#, 0),
            tool_result_bash("some output", 1), // wrong tool result name
            NormalizedBlock::User {
                text: "thanks".into(),
                source_index: 2,
            },
            NormalizedBlock::User {
                text: "more".into(),
                source_index: 3,
            },
            tool_result_bash("[main a1b2c3d] fix bug", 4), // too far (idx 4 > i+3)
        ];
        let commits = extract_commits(&blocks);
        assert_eq!(commits.len(), 1);
        assert_eq!(commits[0].hash, None); // hash not found in look-ahead
        assert_eq!(commits[0].message, "fix bug");
    }

    #[rstest]
    fn claude_format_dedup_by_hash_and_message() {
        let blocks = [
            tool_call_bash(r#"git commit -m "fix bug""#, 0),
            tool_result_bash("[main a1b2c3d] fix bug", 1),
            tool_call_bash(r#"git commit -m "fix bug""#, 2),
            tool_result_bash("[main a1b2c3d] fix bug", 3),
        ];
        let commits = extract_commits(&blocks);
        assert_eq!(commits.len(), 1);
    }

    #[rstest]
    fn pi_format_bash_block() {
        let blocks = [bash_block(
            r#"git commit -m "fix bug""#,
            "[main a1b2c3d] fix bug\n1 file changed",
            0,
        )];
        let commits = extract_commits(&blocks);
        assert_eq!(commits.len(), 1);
        assert_eq!(commits[0].hash.as_deref(), Some("a1b2c3d"));
        assert_eq!(commits[0].message, "fix bug");
    }

    #[rstest]
    fn pi_format_bash_single_quotes() {
        let blocks = [bash_block(
            "git commit -m 'add feature'",
            "a1b2c3d..d4e5f6a",
            0,
        )];
        let commits = extract_commits(&blocks);
        assert_eq!(commits.len(), 1);
        assert_eq!(commits[0].message, "add feature");
    }

    #[rstest]
    fn pi_format_no_commit_ignored() {
        let blocks = [bash_block("ls -la", "total 0", 0)];
        let commits = extract_commits(&blocks);
        assert!(commits.is_empty());
    }

    #[rstest]
    fn mixed_pi_and_claude_format() {
        let blocks = [
            // Pi format
            bash_block(r#"git commit -m "pi commit""#, "[main pi001] pi commit", 0),
            // Claude format
            tool_call_bash(r#"git commit -m "claude commit""#, 1),
            tool_result_bash("[main cc002] claude commit", 2),
        ];
        let commits = extract_commits(&blocks);
        assert_eq!(commits.len(), 2);
    }

    #[rstest]
    fn empty_blocks_returns_empty() {
        assert!(extract_commits(&[]).is_empty());
    }

    // ==============
    // format_commits
    // ==============

    #[rstest]
    fn format_commits_with_hash() {
        let commits = vec![CommitInfo {
            hash: Some("a1b2c3d".into()),
            message: "fix bug".into(),
        }];
        assert_eq!(format_commits(&commits, 8), vec!["a1b2c3d: fix bug"]);
    }

    #[rstest]
    fn format_commits_without_hash() {
        let commits = vec![CommitInfo {
            hash: None,
            message: "fix bug".into(),
        }];
        assert_eq!(format_commits(&commits, 8), vec!["fix bug"]);
    }

    #[rstest]
    fn format_commits_limit_keeps_last() {
        let commits: Vec<CommitInfo> = (0..5)
            .map(|i| CommitInfo {
                hash: Some(format!("hash{i}")),
                message: format!("msg {i}"),
            })
            .collect();
        let result = format_commits(&commits, 2);
        assert_eq!(result.len(), 2);
        assert_eq!(result[0], "hash3: msg 3");
        assert_eq!(result[1], "hash4: msg 4");
    }

    #[rstest]
    fn format_commits_limit_larger_than_input() {
        let commits = vec![CommitInfo {
            hash: Some("a1b2c3d".into()),
            message: "fix bug".into(),
        }];
        let result = format_commits(&commits, 8);
        assert_eq!(result.len(), 1);
    }

    #[rstest]
    fn format_commits_empty() {
        assert!(format_commits(&[], 8).is_empty());
    }
}
