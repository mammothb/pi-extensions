use regex::Regex;
use std::sync::LazyLock;

use crate::types::NormalizedBlock;

static XML_WRAPPER_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r"<(?:system-reminder|ide_opened_file|command-message|context-window-usage)[^>]*>[\s\S]*?</(?:system-reminder|ide_opened_file|command-message|context-window-usage)>",
    )
    .unwrap()
});

const NOISE_TOOLS: &[&str] = &[
    "TodoWrite",
    "TodoRead",
    "ToolSearch",
    "WebSearch",
    "AskUserQuestion",
    "ExitSpecMode",
    "GenerateDroid",
];

const NOISE_STRINGS: &[&str] = &[
    "Continue from where you left off.",
    "No response requested.",
    "IMPORTANT: TodoWrite was not called yet.",
];

pub fn filter_noise(blocks: Vec<NormalizedBlock>) -> Vec<NormalizedBlock> {
    blocks.into_iter().filter_map(filter_one).collect()
}

fn filter_one(block: NormalizedBlock) -> Option<NormalizedBlock> {
    match block {
        NormalizedBlock::User { text, source_index } => {
            if is_noise_user_block(&text) {
                return None;
            }
            let cleaned = clean_user_text(&text);
            if cleaned.is_empty() {
                return None;
            }
            Some(NormalizedBlock::User {
                text: cleaned,
                source_index,
            })
        }
        NormalizedBlock::Assistant { text, source_index } => {
            let cleaned = strip_xml(&text);
            if is_noise_string(&cleaned) {
                return None;
            }
            Some(NormalizedBlock::Assistant {
                text: cleaned,
                source_index,
            })
        }
        NormalizedBlock::ToolCall { ref name, .. }
        | NormalizedBlock::ToolResult { ref name, .. } => {
            if NOISE_TOOLS.contains(&name.as_str()) {
                return None;
            }
            Some(block)
        }
        NormalizedBlock::Bash { .. } => Some(block),
    }
}

/// check noise substrings BEFORE stripping XML, then also check if stripping
/// XML leaves nothing.
fn is_noise_user_block(text: &str) -> bool {
    is_noise_string(text) || strip_xml(text).trim().is_empty()
}

/// Check if text contains any noise substring.
fn is_noise_string(text: &str) -> bool {
    let trimmed = text.trim();
    trimmed.is_empty() || NOISE_STRINGS.iter().any(|s| trimmed.contains(s))
}

fn strip_xml(text: &str) -> String {
    XML_WRAPPER_RE.replace_all(text, "").into_owned()
}

fn clean_user_text(text: &str) -> String {
    strip_xml(text).trim().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use rstest::rstest;
    use serde_json::json;

    fn user_block(text: &str) -> NormalizedBlock {
        NormalizedBlock::User {
            text: text.into(),
            source_index: 0,
        }
    }

    fn assistant_block(text: &str) -> NormalizedBlock {
        NormalizedBlock::Assistant {
            text: text.into(),
            source_index: 0,
        }
    }

    fn tool_call(name: &str) -> NormalizedBlock {
        NormalizedBlock::ToolCall {
            name: name.into(),
            args: json!({}),
            source_index: 0,
        }
    }

    fn tool_result(name: &str, text: &str) -> NormalizedBlock {
        NormalizedBlock::ToolResult {
            name: name.into(),
            text: text.into(),
            source_index: 0,
        }
    }

    fn bash_block() -> NormalizedBlock {
        NormalizedBlock::Bash {
            command: "ls".into(),
            output: "file.txt".into(),
            exit_code: Some(0),
            source_index: 0,
        }
    }

    // =====================
    // XML wrapper stripping
    // =====================

    #[rstest]
    fn strip_xml_wrapper_preserves_surrounding_text() {
        let blocks = vec![user_block(
            "before <system-reminder>noise</system-reminder> after",
        )];
        let result = filter_noise(blocks);
        assert_eq!(result.len(), 1);
        assert!(
            matches!(&result[0], NormalizedBlock::User { text, .. } if text == "before  after")
        );
    }

    #[rstest]
    fn strip_xml_wrapper_multiline() {
        let blocks = vec![user_block(
            "start\n<system-reminder>\ncompaction soon\n</system-reminder>\nend",
        )];
        let result = filter_noise(blocks);
        assert_eq!(result.len(), 1);
        assert!(matches!(&result[0], NormalizedBlock::User { text, .. } if text == "start\n\nend"));
    }

    #[rstest]
    fn strip_xml_wrapper_only_block_dropped() {
        let blocks = vec![user_block(
            "<system-reminder>compaction soon</system-reminder>",
        )];
        let result = filter_noise(blocks);
        assert!(result.is_empty());
    }

    #[rstest]
    fn strip_xml_multiple_wrappers_in_one_block() {
        let blocks = vec![user_block(
            "text <system-reminder>a</system-reminder> middle <ide_opened_file>b</ide_opened_file> end",
        )];
        let result = filter_noise(blocks);
        assert_eq!(result.len(), 1);
        assert!(
            matches!(&result[0], NormalizedBlock::User { text, .. } if text == "text  middle  end")
        );
    }

    #[rstest]
    fn strip_xml_all_four_wrapper_types() {
        let blocks = vec![user_block(
            "<system-reminder>a</system-reminder><ide_opened_file>b</ide_opened_file><command-message>c</command-message><context-window-usage>d</context-window-usage>",
        )];
        let result = filter_noise(blocks);
        assert!(result.is_empty());
    }

    #[rstest]
    fn strip_xml_unknown_wrapper_passthrough() {
        let blocks = vec![user_block("<unknown-tag>keep me</unknown-tag>")];
        let result = filter_noise(blocks);
        assert_eq!(result.len(), 1);
        assert!(
            matches!(&result[0], NormalizedBlock::User { text, .. } if text == "<unknown-tag>keep me</unknown-tag>")
        );
    }

    #[rstest]
    fn strip_xml_in_assistant_text() {
        let blocks = vec![assistant_block(
            "code review <system-reminder>noise</system-reminder> done",
        )];
        let result = filter_noise(blocks);
        assert_eq!(result.len(), 1);
        assert!(
            matches!(&result[0], NormalizedBlock::Assistant { text, .. } if text == "code review  done")
        );
    }

    #[rstest]
    fn strip_xml_with_attributes() {
        let blocks = vec![user_block(
            r#"<system-reminder type="compact" priority="high">noise</system-reminder>"#,
        )];
        let result = filter_noise(blocks);
        assert!(result.is_empty());
    }

    // ===========
    // Noise tools
    // ===========

    #[rstest]
    fn filter_tool_call_by_noise_name() {
        let blocks = vec![
            tool_call("TodoWrite"),
            tool_call("Read"),
            tool_call("TodoRead"),
            tool_call("Edit"),
        ];
        let result = filter_noise(blocks);
        assert_eq!(result.len(), 2);
        assert!(matches!(&result[0], NormalizedBlock::ToolCall { name, .. } if name == "Read"));
        assert!(matches!(&result[1], NormalizedBlock::ToolCall { name, .. } if name == "Edit"));
    }

    #[rstest]
    fn filter_tool_result_by_noise_name() {
        let blocks = vec![
            tool_result("TodoWrite", "task list"),
            tool_result("Read", "file contents"),
        ];
        let result = filter_noise(blocks);
        assert_eq!(result.len(), 1);
        assert!(matches!(&result[0], NormalizedBlock::ToolResult { name, .. } if name == "Read"));
    }

    #[rstest]
    fn filter_all_noise_tools_by_name() {
        for name in NOISE_TOOLS {
            let blocks = vec![tool_call(name)];
            assert!(
                filter_noise(blocks).is_empty(),
                "expected {name} to be filtered"
            );
        }
    }

    #[rstest]
    fn noise_tool_name_case_sensitive() {
        let blocks = vec![tool_call("todowrite")];
        assert_eq!(filter_noise(blocks).len(), 1);
    }

    #[rstest]
    fn non_noise_tools_kept() {
        for name in [
            "Read", "Edit", "Write", "Bash", "Grep", "Glob", "Agent", "Skill",
        ] {
            let blocks = vec![tool_call(name)];
            assert_eq!(filter_noise(blocks).len(), 1, "expected {name} to be kept");
        }
    }

    // =============
    // Noise strings
    // =============

    #[rstest]
    fn filter_exact_noise_string_in_user_block() {
        let blocks = vec![user_block("Continue from where you left off.")];
        assert!(filter_noise(blocks).is_empty());
    }

    #[rstest]
    fn filter_noise_substring_in_user_block() {
        let blocks = vec![user_block(
            "Continue from where you left off. Please fix the issue.",
        )];
        assert!(filter_noise(blocks).is_empty());
    }

    #[rstest]
    fn filter_noise_string_in_assistant_block() {
        let blocks = vec![assistant_block("No response requested.")];
        assert!(filter_noise(blocks).is_empty());
    }

    #[rstest]
    fn noise_string_case_sensitive() {
        let blocks = vec![user_block("continue from where you left off.")];
        assert_eq!(filter_noise(blocks).len(), 1);
    }

    #[rstest]
    fn all_noise_strings_filtered() {
        for s in NOISE_STRINGS {
            let blocks = vec![user_block(s)];
            assert!(
                filter_noise(blocks).is_empty(),
                "expected '{s}' to be filtered"
            );
        }
    }

    // ==================
    // Empty / whitespace
    // ==================

    #[rstest]
    fn drop_whitespace_only_user_block() {
        let blocks = vec![user_block("   \n  ")];
        assert!(filter_noise(blocks).is_empty());
    }

    #[rstest]
    fn drop_user_block_empty_after_xml_strip() {
        let blocks = vec![user_block("<system-reminder>noise</system-reminder>")];
        assert!(filter_noise(blocks).is_empty());
    }

    // ================
    // Bash passthrough
    // ================

    #[rstest]
    fn bash_passes_through() {
        let blocks = vec![bash_block()];
        let result = filter_noise(blocks);
        assert_eq!(result.len(), 1);
        assert!(matches!(result[0], NormalizedBlock::Bash { .. }));
    }

    // ===========
    // Integration
    // ===========

    #[rstest]
    fn mixed_noise_and_valid_keeps_order() {
        let blocks = vec![
            user_block("real question"),
            tool_call("TodoWrite"),
            assistant_block("thinking..."),
            tool_result("Read", "file"),
            tool_call("Read"),
            user_block("Continue from where you left off."),
            assistant_block("final answer"),
        ];
        let result = filter_noise(blocks);
        assert_eq!(result.len(), 5);
        assert!(matches!(&result[0], NormalizedBlock::User { .. }));
        assert!(matches!(&result[1], NormalizedBlock::Assistant { .. }));
        assert!(matches!(&result[2], NormalizedBlock::ToolResult { .. }));
        assert!(matches!(&result[3], NormalizedBlock::ToolCall { .. }));
        assert!(matches!(&result[4], NormalizedBlock::Assistant { .. }));
    }

    #[rstest]
    fn empty_input() {
        assert!(filter_noise(vec![]).is_empty());
    }

    #[rstest]
    fn all_noise_input() {
        let blocks = vec![
            tool_call("TodoWrite"),
            user_block("Continue from where you left off."),
            user_block("<system-reminder>x</system-reminder>"),
            tool_result("ToolSearch", "results"),
        ];
        assert!(filter_noise(blocks).is_empty());
    }
}
