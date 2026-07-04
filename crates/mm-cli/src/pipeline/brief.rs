use std::collections::HashSet;
use std::sync::LazyLock;

use regex::Regex;
use serde_json::Value;
use unicode_segmentation::UnicodeSegmentation;

use crate::types::NormalizedBlock;

// =========
// Constants
// =========

static LETTER_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"[\p{L}\p{N}]").unwrap());

static STOP_WORDS: LazyLock<HashSet<&str>> = LazyLock::new(|| {
    HashSet::from([
        "a", "an", "the", "is", "are", "was", "were", "be", "been", "being", "have", "has", "had",
        "do", "does", "did", "will", "would", "could", "should", "may", "might", "shall", "can",
        "need", "must", "to", "of", "in", "for", "on", "with", "at", "by", "from", "as", "into",
        "through", "during", "before", "after", "above", "below", "between", "under", "over",
        "and", "but", "or", "nor", "not", "so", "yet", "both", "either", "neither", "each",
        "every", "all", "any", "few", "more", "most", "other", "some", "such", "no", "that",
        "this", "these", "those", "it", "its", "i", "me", "my", "we", "our", "you", "your", "he",
        "him", "his", "she", "her", "they", "them", "their", "who", "which", "what", "if", "then",
        "than", "when", "where", "how", "just", "also",
    ])
});

static SELF_TALK_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^\s*(?i:hmm|wait|actually|oh|okay|ok|well|so)[,.!\s-]+").unwrap()
});

static PIPE_TAIL_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r"\s*\|\s*(?:head|tail|sort|wc|column|tr|cut|awk|uniq|python3|node|bun)(?:\s[^|]*)?$",
    )
    .unwrap()
});

static CD_PREFIX_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^cd\s+\S+\s*&&\s*").unwrap());

static SKILL_BLOCK_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#"<skill\s+name="([^"]+)"[^>]*>[\s\S]*?(?:</skill>|$)"#).unwrap());

const TOOL_SUMMARY_FIELDS: &[(&str, &str)] = &[
    ("Read", "file_path"),
    ("read", "file_path"),
    ("Edit", "file_path"),
    ("edit", "file_path"),
    ("Write", "file_path"),
    ("write", "file_path"),
    ("Glob", "pattern"),
    ("Grep", "pattern"),
];

const BASH_CAP: usize = 120;
const TRUNCATE_USER: usize = 256;
const TRUNCATE_ASSISTANT: usize = 200;
const TOOL_CALLS_PER_TURN: usize = 8;

// ==========
// Public API
// ==========

/// Convenience: build + collapse + cap + stringify in one call.
/// Returns empty string for no blocks. Uses default limits (256 / 200).
pub fn compile_brief(blocks: &[NormalizedBlock]) -> String {
    compile_brief_with_limits(blocks, TRUNCATE_USER, TRUNCATE_ASSISTANT)
}

/// Full control over truncation limits.
pub fn compile_brief_with_limits(
    blocks: &[NormalizedBlock],
    truncate_user: usize,
    truncate_assistant: usize,
) -> String {
    let mut sections = build_brief_sections(blocks, truncate_user, truncate_assistant);
    collapse_tool_lines(&mut sections);
    cap_tool_calls_per_turn(&mut sections);
    stringify_brief(&sections)
}

// =======
// Helpers
// =======

/// Check if a segment is a word
fn is_word(segment: &str) -> bool {
    LETTER_RE.is_match(segment)
}

/// Unicode-aware word segmentation with stop-word filtering.
fn truncate_tokens(text: &str, limit: usize) -> String {
    // Collapse whitespace runs -> single space
    let words: Vec<&str> = text.split_whitespace().collect();
    let flat = words.join(" ");
    if flat.is_empty() {
        return flat;
    }

    let mut count = 0;
    let mut last_end = 0;

    for seg in flat.split_word_bounds() {
        if is_word(seg) && !STOP_WORDS.contains(&seg.to_lowercase().as_str()) {
            count += 1;
            if count > limit {
                let truncated = flat[..last_end].trim_end().to_string();
                return if truncated.is_empty() {
                    String::new()
                } else {
                    format!("{truncated}...(truncated)")
                };
            }
        }
        last_end += seg.len();
    }

    flat
}

/// Strip self-reflective assistant prefixes. Two passes
fn strip_self_talk(text: &str) -> String {
    let mut result = text.to_string();
    for _ in 0..2 {
        let stripped = SELF_TALK_RE.replace(&result, "");
        if stripped == result {
            break;
        }
        result = stripped.into_owned();
    }
    result
}

/// Compress a bash command for brief display.
fn compress_bash(raw: &str) -> String {
    // Take first meaningful line
    let cmd = raw
        .lines()
        .map(|l| l.trim())
        .find(|l| !l.is_empty())
        .unwrap_or(raw);

    // Strip cd <path> && prefix
    let mut cmd = CD_PREFIX_RE.replace(cmd, "").into_owned();

    // Strip pipe tail formatting (up to 3 passes)
    for _ in 0..3 {
        let stripped = PIPE_TAIL_RE.replace(&cmd, "");
        if stripped == cmd {
            break;
        }
        cmd = stripped.into_owned();
    }

    // Cap length
    if cmd.len() > BASH_CAP {
        format!("{}...", &cmd[..BASH_CAP - 3])
    } else {
        cmd
    }
}

/// Build a one-line tool call summary: `* Name "arg"`.
fn tool_one_liner(name: &str, args: &Value) -> String {
    // Standard TOOL_SUMMARY_FIELDS
    for (tool, field) in TOOL_SUMMARY_FIELDS {
        if name == *tool
            && let Some(val) = args.get(field).and_then(Value::as_str)
        {
            return format!("* {name} \"{val}\"");
        }
    }

    // fallback: path, file_path, filePath, file
    for path_key in ["path", "file_path", "filePath", "file"] {
        if let Some(val) = args.get(path_key).and_then(Value::as_str) {
            return format!("* {name} \"{val}\"");
        }
    }

    // Bash: command or description
    if name == "bash" || name == "Bash" {
        let raw = args
            .get("command")
            .or_else(|| args.get("description"))
            .and_then(Value::as_str)
            .unwrap_or("");
        let cmd = compress_bash(raw);
        if cmd.is_empty() {
            return format!("* {name}");
        }
        return format!("* {name} \"{cmd}\"");
    }

    // query fallback (clip at 60 chars)
    if let Some(query) = args.get("query").and_then(Value::as_str) {
        let clipped = if query.len() > 60 {
            format!("{}...", &query[..57])
        } else {
            query.to_string()
        };
        return format!("* {name} \"{clipped}\"");
    }

    format!("* {name}")
}

/// Collapse skill tags: `<skill name="X">...</skill>` -> `[skill: X]`.
fn collapse_skill_text(text: &str) -> String {
    SKILL_BLOCK_RE
        .replace_all(text, |caps: &regex::Captures| {
            format!("[skill: {}]", &caps[1])
        })
        .into_owned()
}

// =============
// Section types
// =============

struct BriefSection {
    header: &'static str,
    lines: Vec<String>,
}

// ================
// Section building
// ================

/// Build BriefLine sections from NormalizedBlocks.
fn build_brief_sections(
    blocks: &[NormalizedBlock],
    truncate_user: usize,
    truncate_assistant: usize,
) -> Vec<BriefSection> {
    let mut sections: Vec<BriefSection> = vec![];
    let mut last_header: Option<&'static str> = None;

    for b in blocks {
        match b {
            NormalizedBlock::User { text, source_index } => {
                if text.trim().is_empty() {
                    last_header = Some("[user]");
                    continue;
                }
                let collapsed = collapse_skill_text(text);
                let truncated = truncate_tokens(&collapsed, truncate_user);
                if truncated.is_empty() {
                    last_header = Some("[user]");
                    continue;
                }
                let ref_str = format!(" (#{source_index})");
                push_section(
                    &mut sections,
                    &mut last_header,
                    "[user]",
                    &format!("{truncated}{ref_str}"),
                );
            }
            NormalizedBlock::Bash {
                command,
                source_index,
                ..
            } => {
                let cmd = compress_bash(command);
                if cmd.is_empty() {
                    last_header = Some("[user]");
                    continue;
                }
                let ref_str = format!(" (#{source_index})");
                push_section(
                    &mut sections,
                    &mut last_header,
                    "[user]",
                    &format!("$ {cmd}{ref_str}"),
                );
            }
            NormalizedBlock::Assistant { text, source_index } => {
                let stripped = strip_self_talk(text);
                let truncated = truncate_tokens(&stripped, truncate_assistant);
                if truncated.is_empty() {
                    continue;
                }
                let ref_str = format!(" (#{source_index})");
                push_section(
                    &mut sections,
                    &mut last_header,
                    "[assistant]",
                    &format!("{truncated}{ref_str}"),
                );
            }
            NormalizedBlock::ToolCall {
                name,
                args,
                source_index,
            } => {
                let name = name.trim();
                if name.is_empty() {
                    continue;
                }
                let summary = tool_one_liner(name, args);
                let ref_str = format!(" (#{source_index})");
                push_section(
                    &mut sections,
                    &mut last_header,
                    "[assistant]",
                    &format!("{summary}{ref_str}"),
                );
            }
            NormalizedBlock::ToolResult { .. } => {
                // Tool results are omitted from brief output
            }
        }
    }

    sections
}

fn push_section(
    sections: &mut Vec<BriefSection>,
    last_header: &mut Option<&'static str>,
    header: &'static str,
    line: &str,
) {
    if *last_header == Some(header)
        && let Some(sec) = sections.last_mut()
    {
        sec.lines.push(line.to_string());
        return;
    }
    sections.push(BriefSection {
        header,
        lines: vec![line.to_string()],
    });
    *last_header = Some(header);
}

// ===============
// Tool call dedup
// ===============

/// Collapse consecutive identical tool lines.
fn collapse_tool_lines(sections: &mut [BriefSection]) {
    for sec in sections.iter_mut() {
        if sec.header != "[assistant]" {
            continue;
        }
        let mut out: Vec<String> = Vec::new();

        for line in &sec.lines {
            if !line.starts_with("* ") {
                out.push(line.clone());
                continue;
            }

            // Extract (#ref) suffix and base text
            let (base, ref_num) = strip_ref_suffix(line);

            if let Some(last) = out.last() {
                // State 1: already merged — `base (#1, #2) x2`
                if let Some((m_base, m_refs, m_count)) = parse_merged_tool(last)
                    && m_base == base
                {
                    let new_refs = format!("{m_refs}, #{ref_num}");
                    let new_count = m_count + 1;
                    let idx = out.len() - 1;
                    out[idx] = format!("{base} ({new_refs}) x{new_count}");
                    continue;
                }
                // State 2: single ref — `base (#12)`
                if let Some((single_base, single_ref)) = parse_single_ref(last)
                    && single_base == base
                {
                    let idx = out.len() - 1;
                    out[idx] = format!("{base} (#{single_ref}, #{ref_num}) x2");
                    continue;
                }
            }
            // State 3: no match or non-tool previous
            out.push(line.clone());
        }

        sec.lines = out;
    }
}

/// Strip a `(#N)` suffix from a tool line. Returns (base, ref_number).
fn strip_ref_suffix(line: &str) -> (&str, &str) {
    if let Some(open) = line.rfind(" (#")
        && line.ends_with(')')
    {
        let base = &line[..open];
        let ref_num = &line[open + 3..line.len() - 1];
        return (base, ref_num);
    }
    (line, "")
}

/// Parse an already-merged tool line: `base (#1, #2) x3`.
fn parse_merged_tool(line: &str) -> Option<(&str, &str, usize)> {
    let re = Regex::new(r"^(.*) \((#[\d, #]+)\) x(\d+)$").unwrap();
    let caps = re.captures(line)?;
    let base = caps.get(1)?.as_str();
    let refs = caps.get(2)?.as_str();
    let count: usize = caps.get(3)?.as_str().parse().ok()?;
    Some((base, refs, count))
}

/// Parse a single-ref tool line: `base (#12)`.
fn parse_single_ref(line: &str) -> Option<(&str, &str)> {
    let re = Regex::new(r"^(.*) \(#(\d+)\)$").unwrap();
    let caps = re.captures(line)?;
    let base = caps.get(1)?.as_str();
    let ref_num = caps.get(2)?.as_str();
    Some((base, ref_num))
}

// =================
// Tool call capping
// =================

/// Cap tool calls per [assistant] turn at TOOL_CALLS_PER_TURN.
/// Keep tail, note omitted count.
fn cap_tool_calls_per_turn(sections: &mut [BriefSection]) {
    for sec in sections.iter_mut() {
        if sec.header != "[assistant]" {
            continue;
        }
        let tool_idxs: Vec<usize> = sec
            .lines
            .iter()
            .enumerate()
            .filter(|(_, l)| l.starts_with("* "))
            .map(|(i, _)| i)
            .collect();

        if tool_idxs.len() <= TOOL_CALLS_PER_TURN {
            continue;
        }

        let drop_count = tool_idxs.len() - TOOL_CALLS_PER_TURN;
        let drop_set: HashSet<usize> = tool_idxs.iter().take(drop_count).copied().collect();
        let first_kept_tool_idx = tool_idxs[drop_count];

        let mut next: Vec<String> = Vec::new();
        let mut inserted = false;
        for (i, line) in sec.lines.iter().enumerate() {
            if drop_set.contains(&i) {
                continue;
            }
            if !inserted && i == first_kept_tool_idx {
                next.push(format!(
                    "* ({drop_count} earlier tool-call entries omitted)"
                ));
                inserted = true;
            }
            next.push(line.clone());
        }
        sec.lines = next;
    }
}

// =========
// Stringify
// =========

/// Stringify BriefSection sections into text format.
fn stringify_brief(sections: &[BriefSection]) -> String {
    let mut out: Vec<String> = Vec::new();

    for (i, sec) in sections.iter().enumerate() {
        if i > 0 {
            let prev = &sections[i - 1];
            let prev_is_tools =
                prev.header == "[assistant]" && prev.lines.iter().all(|l| l.starts_with("* "));
            let cur_is_tools =
                sec.header == "[assistant]" && sec.lines.iter().all(|l| l.starts_with("* "));

            // Suppress blank lines between consecutive tool-only sections
            if !(prev_is_tools && cur_is_tools) {
                out.push(String::new());
            }
        }
        out.push(sec.header.to_string());
        for line in &sec.lines {
            out.push(line.clone());
        }
    }

    out.join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;
    use rstest::rstest;
    use serde_json::json;

    // ===========
    // Helpers
    // ===========

    fn user_block(text: &str, idx: usize) -> NormalizedBlock {
        NormalizedBlock::User {
            text: text.into(),
            source_index: idx,
        }
    }

    fn assistant_block(text: &str, idx: usize) -> NormalizedBlock {
        NormalizedBlock::Assistant {
            text: text.into(),
            source_index: idx,
        }
    }

    fn tool_call(name: &str, args: Value, idx: usize) -> NormalizedBlock {
        NormalizedBlock::ToolCall {
            name: name.into(),
            args,
            source_index: idx,
        }
    }

    fn bash_block(command: &str, idx: usize) -> NormalizedBlock {
        NormalizedBlock::Bash {
            command: command.into(),
            output: String::new(),
            exit_code: Some(0),
            source_index: idx,
        }
    }

    // ===============
    // truncate_tokens
    // ===============

    #[rstest]
    fn truncate_short_text_passthrough() {
        assert_eq!(truncate_tokens("hello world", 100), "hello world");
    }

    #[rstest]
    fn truncate_long_text_with_limit() {
        let words: Vec<String> = (0..300).map(|i| format!("word{i}")).collect();
        let text = words.join(" ");
        let result = truncate_tokens(&text, 256);
        assert!(result.contains("...(truncated)"));
        assert!(!result.contains("word299"));
    }

    #[rstest]
    fn truncate_stop_words_not_counted() {
        let text = "the quick brown fox jumps over the lazy dog";
        // stop words: the, the -> 2 removed. Content words: quick, brown, fox,
        // jumps, over, lazy, dog -> 7
        let result = truncate_tokens(text, 5);
        // Should truncate after "over" (words: quick=1, brown=2, fox=3,
        // jumps=4, over=5)
        assert!(result.contains("...(truncated)"));
        assert!(result.contains("quick brown fox jumps over"));
        assert!(!result.contains("lazy dog"));
    }

    #[rstest]
    fn truncate_empty_text() {
        assert_eq!(truncate_tokens("", 10), "");
    }

    #[rstest]
    fn truncate_whitespace_collapsed() {
        let result = truncate_tokens("hello\n\nworld", 100);
        assert_eq!(result, "hello world");
    }

    #[rstest]
    fn truncate_all_stop_words() {
        let result = truncate_tokens("the a an is are was were", 5);
        // All stop words -> nothing counted -> full text returned
        assert_eq!(result, "the a an is are was were");
    }

    // ===============
    // strip_self_talk
    // ===============

    #[rstest]
    #[case("Hmm, let me check.", "let me check.")]
    #[case("Okay, I found it.", "I found it.")]
    #[case("Wait, actually, the issue is...", "the issue is...")]
    #[case("oh wait actually the data shows", "actually the data shows")]
    #[case("Actually the data shows", "the data shows")]
    #[case("Let me check the logs.", "Let me check the logs.")]
    fn strip_self_talk_removes_prefix(#[case] input: &str, #[case] expected: &str) {
        assert_eq!(strip_self_talk(input), expected);
    }

    // =======================
    // Bash compression
    // =======================

    #[rstest]
    fn compress_bash_cd_prefix() {
        assert_eq!(compress_bash("cd /project && cargo build"), "cargo build");
    }

    #[rstest]
    fn compress_bash_pipe_tail() {
        assert_eq!(compress_bash("npm test | head -20"), "npm test");
    }

    #[rstest]
    fn compress_bash_multi_pipe() {
        assert_eq!(compress_bash("find . | sort | head"), "find .");
    }

    #[rstest]
    fn compress_bash_long_command_truncated() {
        let long = "a".repeat(150);
        let result = compress_bash(&long);
        assert!(result.ends_with("..."));
        assert!(result.len() <= 120);
    }

    #[rstest]
    fn compress_bash_empty() {
        assert_eq!(compress_bash(""), "");
    }

    #[rstest]
    fn compress_bash_takes_first_line() {
        assert_eq!(compress_bash("line1\nline2\nline3"), "line1");
    }

    // ================
    // tool_one_liner
    // ================

    #[rstest]
    fn tool_one_liner_read() {
        assert_eq!(
            tool_one_liner("Read", &json!({"file_path": "src/main.rs"})),
            "* Read \"src/main.rs\""
        );
    }

    #[rstest]
    fn tool_one_liner_edit_lowercase() {
        assert_eq!(
            tool_one_liner("edit", &json!({"file_path": "lib.rs"})),
            "* edit \"lib.rs\""
        );
    }

    #[rstest]
    fn tool_one_liner_bash_command() {
        assert_eq!(
            tool_one_liner("Bash", &json!({"command": "cargo build"})),
            "* Bash \"cargo build\""
        );
    }

    #[rstest]
    fn tool_one_liner_bash_description() {
        assert_eq!(
            tool_one_liner("Bash", &json!({"description": "build project"})),
            "* Bash \"build project\""
        );
    }

    #[rstest]
    fn tool_one_liner_extract_path_fallback() {
        assert_eq!(
            tool_one_liner("SomeTool", &json!({"path": "x.ts"})),
            "* SomeTool \"x.ts\""
        );
    }

    #[rstest]
    fn tool_one_liner_query_fallback() {
        assert_eq!(
            tool_one_liner("Search", &json!({"query": "auth"})),
            "* Search \"auth\""
        );
    }

    #[rstest]
    fn tool_one_liner_unknown_tool() {
        assert_eq!(
            tool_one_liner("UnknownTool", &json!({"x": 1})),
            "* UnknownTool"
        );
    }

    // ===================
    // collapse_skill_text
    // ===================

    #[rstest]
    fn collapse_single_skill() {
        assert_eq!(
            collapse_skill_text(r#"<skill name="foo">content</skill>"#),
            "[skill: foo]"
        );
    }

    #[rstest]
    fn collapse_multiple_skills() {
        assert_eq!(
            collapse_skill_text(
                r#"text <skill name="a">x</skill> more <skill name="b">y</skill> end"#
            ),
            "text [skill: a] more [skill: b] end"
        );
    }

    #[rstest]
    fn collapse_unterminated_skill() {
        assert_eq!(
            collapse_skill_text(r#"<skill name="foo">content"#),
            "[skill: foo]"
        );
    }

    // ======================
    // compile_brief flow
    // ======================

    #[rstest]
    fn brief_empty_blocks() {
        assert_eq!(compile_brief(&[]), "");
    }

    #[rstest]
    fn brief_user_and_assistant() {
        let blocks = vec![
            user_block("fix auth bug", 0),
            assistant_block("Let me look at the auth module.", 1),
        ];
        let r = compile_brief(&blocks);
        assert!(r.contains("[user]\nfix auth bug (#0)"));
        assert!(r.contains("[assistant]\nLet me look at the auth module. (#1)"));
    }

    #[rstest]
    fn brief_bash_command() {
        let blocks = vec![bash_block("npm test", 2)];
        let r = compile_brief(&blocks);
        assert!(r.contains("[user]\n$ npm test (#2)"));
        assert!(!r.contains("FAIL"));
    }

    #[rstest]
    fn brief_self_talk_stripped() {
        let blocks = vec![
            assistant_block("Okay, I found the root cause.", 0),
            assistant_block("Actually, the issue is in middleware.", 1),
            assistant_block("Let me check the logs.", 2),
        ];
        let r = compile_brief(&blocks);
        assert!(r.contains("I found the root cause."));
        assert!(r.contains("the issue is in middleware."));
        assert!(r.contains("Let me check the logs."));
    }

    #[rstest]
    fn brief_tool_calls_under_assistant() {
        let blocks = vec![
            assistant_block("Let me check.", 0),
            tool_call("Read", json!({"file_path": "auth.ts"}), 1),
            tool_call("Edit", json!({"file_path": "auth.ts"}), 2),
        ];
        let r = compile_brief(&blocks);
        assert!(r.contains("* Read \"auth.ts\""));
        assert!(r.contains("* Edit \"auth.ts\""));
        // Single [assistant] section
        assert_eq!(r.matches("[assistant]").count(), 1);
    }

    #[rstest]
    fn brief_tool_results_omitted() {
        let blocks = vec![NormalizedBlock::ToolResult {
            name: "Read".into(),
            text: "lots of code here...".into(),
            source_index: 0,
        }];
        assert_eq!(compile_brief(&blocks), "");
    }

    #[rstest]
    fn brief_merges_adjacent_assistant() {
        let blocks = vec![
            assistant_block("First part.", 0),
            tool_call("Read", json!({"file_path": "a.ts"}), 1),
            assistant_block("Second part.", 2),
            tool_call("Read", json!({"file_path": "b.ts"}), 3),
        ];
        let r = compile_brief(&blocks);
        assert_eq!(r.matches("[assistant]").count(), 1);
    }

    #[rstest]
    fn brief_no_merge_after_user() {
        let blocks = vec![
            assistant_block("First.", 0),
            user_block("Next task.", 1),
            assistant_block("Second.", 2),
        ];
        let r = compile_brief(&blocks);
        assert_eq!(r.matches("[assistant]").count(), 2);
    }

    #[rstest]
    fn brief_user_truncation() {
        let words: Vec<String> = (0..300).map(|i| format!("word{i}")).collect();
        let text = words.join(" ");
        let blocks = vec![user_block(&text, 0)];
        let r = compile_brief(&blocks);
        assert!(r.contains("...(truncated)"));
        assert!(!r.contains("word299"));
    }

    #[rstest]
    fn brief_assistant_truncation() {
        let words: Vec<String> = (0..300).map(|i| format!("word{i}")).collect();
        let text = words.join(" ");
        let blocks = vec![assistant_block(&text, 0)];
        let r = compile_brief(&blocks);
        assert!(r.contains("...(truncated)"));
        assert!(!r.contains("word299"));
    }

    // ======================
    // Tool call dedup
    // ======================

    #[rstest]
    fn dedup_two_identical_tools() {
        let blocks = vec![
            tool_call("Read", json!({"file_path": "a.ts"}), 1),
            tool_call("Read", json!({"file_path": "a.ts"}), 2),
        ];
        let r = compile_brief(&blocks);
        assert!(r.contains("* Read \"a.ts\" (#1, #2) x2"));
    }

    #[rstest]
    fn dedup_three_identical_tools() {
        let blocks = vec![
            tool_call("Read", json!({"file_path": "a.ts"}), 1),
            tool_call("Read", json!({"file_path": "a.ts"}), 2),
            tool_call("Read", json!({"file_path": "a.ts"}), 3),
        ];
        let r = compile_brief(&blocks);
        assert!(r.contains("* Read \"a.ts\" (#1, #2, #3) x3"));
    }

    #[rstest]
    fn dedup_different_args_not_merged() {
        let blocks = vec![
            tool_call("Read", json!({"file_path": "a.ts"}), 1),
            tool_call("Read", json!({"file_path": "b.ts"}), 2),
        ];
        let r = compile_brief(&blocks);
        assert!(r.contains("* Read \"a.ts\" (#1)"));
        assert!(r.contains("* Read \"b.ts\" (#2)"));
        assert!(!r.contains("x2"));
    }

    // ======================
    // Tool call capping
    // ======================

    #[rstest]
    fn cap_more_than_8_tools_keeps_tail() {
        let mut blocks = vec![assistant_block("Working.", 0)];
        for i in 1..=12 {
            blocks.push(tool_call(
                "bash",
                json!({"command": format!("echo {i}")}),
                i,
            ));
        }
        let r = compile_brief(&blocks);
        assert!(r.contains("(4 earlier tool-call entries omitted)"));
        assert!(!r.contains("echo 1\""));
        assert!(!r.contains("echo 4\""));
        assert!(r.contains("echo 5"));
        assert!(r.contains("echo 12"));
    }

    #[rstest]
    fn cap_exactly_8_no_omission() {
        let mut blocks = vec![assistant_block("ok", 0)];
        for i in 1..=8 {
            blocks.push(tool_call("bash", json!({"command": format!("c{i}")}), i));
        }
        let r = compile_brief(&blocks);
        assert!(!r.contains("entries omitted"));
        assert!(r.contains("c1"));
        assert!(r.contains("c8"));
    }

    // ======================
    // Realistic flow
    // ======================

    #[rstest]
    fn brief_realistic_conversation() {
        let blocks = vec![
            user_block("fix the login bug", 0),
            assistant_block("Let me investigate.", 1),
            tool_call("Read", json!({"file_path": "login.ts"}), 2),
            NormalizedBlock::ToolResult {
                name: "Read".into(),
                text: "export function login() { ... }".into(),
                source_index: 3,
            },
            tool_call("bash", json!({"command": "npm test"}), 4),
            NormalizedBlock::ToolResult {
                name: "bash".into(),
                text: "FAIL: login test\nExpected true, got false".into(),
                source_index: 5,
            },
            assistant_block("The test is failing because...", 6),
            tool_call("Edit", json!({"file_path": "login.ts"}), 7),
            NormalizedBlock::ToolResult {
                name: "Edit".into(),
                text: "File edited successfully".into(),
                source_index: 8,
            },
            user_block("test lại đi", 9),
            assistant_block("Running tests again.", 10),
            tool_call("bash", json!({"command": "npm test"}), 11),
            NormalizedBlock::ToolResult {
                name: "bash".into(),
                text: "All tests passed".into(),
                source_index: 12,
            },
        ];
        let r = compile_brief(&blocks);

        assert!(r.contains("[user]\nfix the login bug (#0)"));
        assert!(r.contains("[assistant]\nLet me investigate. (#1)\n* Read \"login.ts\" (#2)"));
        assert!(r.contains("* bash \"npm test\" (#4)"));
        assert!(r.contains("The test is failing because... (#6)\n* Edit \"login.ts\" (#7)"));
        assert!(r.contains("[user]\ntest lại đi (#9)"));
        assert!(r.contains("[assistant]\nRunning tests again. (#10)\n* bash \"npm test\" (#11)"));
        assert!(!r.contains("export function login"));
        assert!(!r.contains("File edited successfully"));
        assert!(!r.contains("All tests passed"));
    }

    #[rstest]
    fn brief_user_blocks_merge() {
        let blocks = vec![
            user_block("first message", 0),
            user_block("second message", 1),
        ];
        let r = compile_brief(&blocks);
        assert_eq!(r.matches("[user]").count(), 1);
        assert!(r.contains("first message (#0)"));
        assert!(r.contains("second message (#1)"));
    }

    #[rstest]
    fn brief_bash_merges_with_user() {
        let blocks = vec![bash_block("npm test", 0), user_block("also run lint", 1)];
        let r = compile_brief(&blocks);
        assert_eq!(r.matches("[user]").count(), 1);
        assert!(r.contains("$ npm test (#0)"));
        assert!(r.contains("also run lint (#1)"));
    }

    #[rstest]
    fn brief_whitespace_only_user_skipped() {
        let blocks = vec![user_block("  \n  ", 0), assistant_block("real response", 1)];
        let r = compile_brief(&blocks);
        assert!(!r.contains("[user]"));
        assert!(r.contains("[assistant]"));
    }

    #[rstest]
    fn brief_empty_name_tool_skipped() {
        let blocks = vec![
            tool_call("", json!({}), 0),
            tool_call("Read", json!({"file_path": "a.ts"}), 1),
        ];
        let r = compile_brief(&blocks);
        assert_eq!(r.matches("* ").count(), 1);
        assert!(r.contains("* Read \"a.ts\" (#1)"));
    }

    #[rstest]
    fn brief_stringify_no_blank_between_tool_only_sections() {
        // Two assistant sections, each tool-only -> no blank line between
        let blocks = vec![
            tool_call("Read", json!({"file_path": "a.ts"}), 0),
            NormalizedBlock::ToolResult {
                name: "Read".into(),
                text: "...".into(),
                source_index: 1,
            },
            tool_call("Read", json!({"file_path": "b.ts"}), 2),
        ];
        let r = compile_brief(&blocks);
        // Both tool calls should be in the same [assistant] since no user block separates them
        assert_eq!(r.matches("[assistant]").count(), 1);
        assert!(r.contains("* Read \"a.ts\" (#0)"));
        assert!(r.contains("* Read \"b.ts\" (#2)"));
    }
}
