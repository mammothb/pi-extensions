use std::sync::LazyLock;

use regex::Regex;

use crate::types::{ContentBlock, Message, NormalizedBlock};

pub fn normalize(messages: &[Message]) -> Vec<NormalizedBlock> {
    messages
        .iter()
        .enumerate()
        .flat_map(|(i, msg)| normalize_one(msg, i))
        .collect()
}

fn normalize_one(msg: &Message, index: usize) -> Vec<NormalizedBlock> {
    match msg.role.as_str() {
        "user" => msg
            .content
            .iter()
            .filter_map(|b| match b {
                ContentBlock::Text { text } => Some(NormalizedBlock::User {
                    text: sanitize(text),
                    source_index: index,
                }),
                _ => None,
            })
            .collect(),
        "assistant" => msg
            .content
            .iter()
            .filter_map(|b| match b {
                ContentBlock::Text { text } => Some(NormalizedBlock::Assistant {
                    text: sanitize(text),
                    source_index: index,
                }),
                ContentBlock::ToolCall { id: _, name, input } => Some(NormalizedBlock::ToolCall {
                    name: name.clone(),
                    args: input.clone(),
                    source_index: index,
                }),
                // thinking stays in full .txt but is dropped by brief
                _ => None,
            })
            .collect(),
        "tool_result" => {
            // Tool result metadata comes from Message-level fields (pi format)
            // or from ContentBlock::ToolResult (Claude format - unwound by
            // claude::parse).
            let name = msg.tool_name.clone().unwrap_or_else(|| "<unknown>".into());
            let text = msg
                .content
                .iter()
                .filter_map(|b| match b {
                    ContentBlock::Text { text } => Some(text.as_str()),
                    _ => None,
                })
                .collect::<Vec<_>>()
                .join("\n");
            if text.is_empty() {
                vec![]
            } else {
                vec![NormalizedBlock::ToolResult {
                    name,
                    text: sanitize(&text),
                    source_index: index,
                }]
            }
        }
        _ => vec![],
    }
}

static ANSI_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\x1b\[[0-9;]*[A-Za-z]").unwrap());
static CTRL_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"[\x00-\x08\x0b\x0c\x0e-\x1f]").unwrap());

/// Strip `\r`, ANSI escape sequences, and control characters
/// (except `\n`, `\t`).
pub fn sanitize(text: &str) -> String {
    let text = text.replace("\r\n", "\n").replace('\r', "\n");
    let text = ANSI_RE.replace_all(&text, "");
    CTRL_RE.replace_all(&text, "").into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;
    use rstest::rstest;
    use serde_json::json;

    fn msg_user(text: &str) -> Message {
        Message {
            role: "user".into(),
            content: vec![ContentBlock::Text { text: text.into() }],
            tool_call_id: None,
            tool_name: None,
            is_error: false,
        }
    }

    fn msg_assistant(blocks: Vec<ContentBlock>) -> Message {
        Message {
            role: "assistant".into(),
            content: blocks,
            tool_call_id: None,
            tool_name: None,
            is_error: false,
        }
    }

    fn msg_assistant_text(text: &str) -> Message {
        msg_assistant(vec![ContentBlock::Text { text: text.into() }])
    }

    fn msg_tool_result(name: Option<&str>, text: &str) -> Message {
        Message {
            role: "tool_result".into(),
            content: vec![ContentBlock::Text { text: text.into() }],
            tool_call_id: None,
            tool_name: name.map(String::from),
            is_error: false,
        }
    }

    fn msg_system() -> Message {
        Message {
            role: "system".into(),
            content: vec![ContentBlock::Text {
                text: "ignored".into(),
            }],
            tool_call_id: None,
            tool_name: None,
            is_error: false,
        }
    }

    // ==============
    // sanitize tests
    // ==============
    #[rstest]
    #[case::cr_stripped("line1\rline2", "line1\nline2")]
    #[case::crlf("line1\r\nline2", "line1\nline2")]
    #[case::ansi_codes("\x1b[32mgreen\x1b[0m", "green")]
    #[case::control_chars("text\x00\x01end", "textend")]
    #[case::tab_preserved("col1\tcol2", "col1\tcol2")]
    #[case::plain_text_unchanged("hello world", "hello world")]
    fn sanitize_cleans_text(#[case] input: &str, #[case] expected: &str) {
        assert_eq!(sanitize(input), expected);
    }

    // ===========================
    // user messages → User blocks
    // ===========================
    #[rstest]
    fn normalize_user_yields_user_block() {
        let msgs = vec![msg_user("hello")];
        let blocks = normalize(&msgs);
        assert_eq!(blocks.len(), 1);
        assert!(
            matches!(&blocks[0], NormalizedBlock::User { text, source_index: 0 }
            if text == "hello")
        );
    }

    #[rstest]
    fn normalize_user_source_index_matches_position() {
        let msgs = vec![msg_user("first"), msg_user("second")];
        let blocks = normalize(&msgs);
        assert_eq!(blocks.len(), 2);
        assert!(matches!(
            &blocks[0],
            NormalizedBlock::User {
                source_index: 0,
                ..
            }
        ));
        assert!(matches!(
            &blocks[1],
            NormalizedBlock::User {
                source_index: 1,
                ..
            }
        ));
    }

    // =========================================
    // assistant messages → Assistant + ToolCall
    // =========================================
    #[rstest]
    fn normalize_assistant_text_yields_assistant_block() {
        let msgs = vec![msg_assistant_text("ok")];
        let blocks = normalize(&msgs);
        assert_eq!(blocks.len(), 1);
        assert!(
            matches!(&blocks[0], NormalizedBlock::Assistant { text, source_index: 0 }
            if text == "ok")
        );
    }

    #[rstest]
    fn normalize_assistant_tool_call_yields_tool_call_block() {
        let msgs = vec![msg_assistant(vec![ContentBlock::ToolCall {
            id: "t1".into(),
            name: "Read".into(),
            input: json!({"file_path": "src/main.rs"}),
        }])];
        let blocks = normalize(&msgs);
        assert_eq!(blocks.len(), 1);
        assert!(
            matches!(&blocks[0], NormalizedBlock::ToolCall { name, args, source_index: 0 }
            if name == "Read" && args["file_path"] == "src/main.rs")
        );
    }

    #[rstest]
    fn normalize_assistant_mixed_text_and_tool_call() {
        let msgs = vec![msg_assistant(vec![
            ContentBlock::Text {
                text: "found it".into(),
            },
            ContentBlock::ToolCall {
                id: "t1".into(),
                name: "Edit".into(),
                input: json!({}),
            },
        ])];
        let blocks = normalize(&msgs);
        assert_eq!(blocks.len(), 2);
        assert!(matches!(&blocks[0], NormalizedBlock::Assistant { .. }));
        assert!(matches!(&blocks[1], NormalizedBlock::ToolCall { .. }));
    }

    #[rstest]
    fn normalize_assistant_thinking_dropped() {
        let msgs = vec![msg_assistant(vec![ContentBlock::Thinking {
            thinking: "hmm".into(),
            redacted: false,
        }])];
        let blocks = normalize(&msgs);
        assert!(blocks.is_empty());
    }

    // ========================
    // tool_result → ToolResult
    // ========================
    #[rstest]
    fn normalize_tool_result_yields_tool_result_block() {
        let msgs = vec![msg_tool_result(Some("Read"), "output")];
        let blocks = normalize(&msgs);
        assert_eq!(blocks.len(), 1);
        assert!(
            matches!(&blocks[0], NormalizedBlock::ToolResult { name, text, source_index: 0 }
            if name == "Read" && text == "output")
        );
    }

    #[rstest]
    fn normalize_tool_result_empty_text_dropped() {
        let msgs = vec![msg_tool_result(Some("Read"), "")];
        assert!(normalize(&msgs).is_empty());
    }

    #[rstest]
    fn normalize_tool_result_missing_name_uses_sentinel() {
        let msgs = vec![msg_tool_result(None, "some output")];
        let blocks = normalize(&msgs);
        assert_eq!(blocks.len(), 1);
        assert!(
            matches!(&blocks[0], NormalizedBlock::ToolResult { name, .. }
            if name == "<unknown>")
        );
    }

    // ================================
    // system / unknown roles → skipped
    // ================================
    #[rstest]
    #[case::system(msg_system())]
    #[case::unknown_role(Message {
        role: "custom".into(),
        content: vec![ContentBlock::Text { text: "nope".into() }],
        tool_call_id: None,
        tool_name: None,
        is_error: false,
    })]
    fn normalize_skips_non_standard_roles(#[case] msg: Message) {
        assert!(normalize(&[msg]).is_empty());
    }

    // ====================
    // mixed message stream
    // ====================
    #[rstest]
    fn normalize_preserves_order_and_indices_in_mixed_stream() {
        let msgs = vec![
            msg_user("q"),                         // index 0
            msg_assistant_text("a"),               // index 1
            msg_tool_result(Some("Read"), "done"), // index 2
            msg_user("thanks"),                    // index 3
        ];
        let blocks = normalize(&msgs);
        assert_eq!(blocks.len(), 4);

        assert!(matches!(
            &blocks[0],
            NormalizedBlock::User {
                source_index: 0,
                ..
            }
        ));
        assert!(matches!(
            &blocks[1],
            NormalizedBlock::Assistant {
                source_index: 1,
                ..
            }
        ));
        assert!(matches!(
            &blocks[2],
            NormalizedBlock::ToolResult {
                source_index: 2,
                ..
            }
        ));
        assert!(matches!(
            &blocks[3],
            NormalizedBlock::User {
                source_index: 3,
                ..
            }
        ));
    }

    // ====================
    // sanitize integration
    // ====================
    #[rstest]
    fn normalize_sanitizes_text_through_pipeline() {
        let msgs = vec![msg_user("line1\r\n\x1b[32mline2\x1b[0m")];
        let blocks = normalize(&msgs);
        assert!(matches!(&blocks[0], NormalizedBlock::User { text, .. }
            if text == "line1\nline2"));
    }
}
