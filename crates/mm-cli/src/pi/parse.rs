use serde_json::Value;

use crate::{
    parse_util::{optional_str, required_str},
    types::{ContentBlock, Message},
};

pub fn parse(records: &[Value]) -> Vec<Message> {
    records
        .iter()
        .filter(|r| r.get("type").and_then(Value::as_str) == Some("message"))
        .filter_map(|r| r.get("message"))
        .filter_map(parse_message)
        .collect()
}

pub fn parse_messages(values: &[Value]) -> Vec<Message> {
    values.iter().filter_map(parse_message).collect()
}

fn parse_message(msg: &Value) -> Option<Message> {
    let raw_role = required_str(msg, "role")?;
    let role = normalize_role(&raw_role);
    let content = parse_content(&msg["content"]);
    // bash_execution uses command/output fields, content is not required
    if content.is_empty() && role != "bash_execution" {
        None
    } else {
        Some(Message {
            role,
            content,
            tool_call_id: optional_str(msg, "toolCallId"),
            tool_name: optional_str(msg, "toolName"),
            is_error: msg.get("isError").and_then(Value::as_bool).unwrap_or(false),
            command: optional_str(msg, "command"),
            output: optional_str(msg, "output"),
            exit_code: msg
                .get("exitCode")
                .and_then(Value::as_i64)
                .map(|n| n as i32),
        })
    }
}

/// Normalize Pi-format camelCase role names to format-agnostic snake_case.
fn normalize_role(raw: &str) -> String {
    match raw {
        "toolResult" => "tool_result".into(),
        "bashExecution" => "bash_execution".into(),
        other => other.into(),
    }
}

fn parse_content(content: &Value) -> Vec<ContentBlock> {
    match content {
        Value::String(s) if !s.is_empty() => vec![ContentBlock::Text { text: s.clone() }],
        Value::Array(parts) => parts.iter().filter_map(parse_content_block).collect(),
        _ => vec![],
    }
}

fn parse_content_block(block: &Value) -> Option<ContentBlock> {
    match block.get("type").and_then(Value::as_str)? {
        "text" => Some(ContentBlock::Text {
            text: required_str(block, "text")?,
        }),
        "toolCall" => Some(ContentBlock::ToolCall {
            id: required_str(block, "id")?,
            name: required_str(block, "name")?,
            input: block.get("arguments").cloned().unwrap_or(Value::Null),
        }),
        "thinking" => Some(ContentBlock::Thinking {
            thinking: required_str(block, "thinking")?,
            redacted: block
                .get("redacted")
                .and_then(Value::as_bool)
                .unwrap_or(false),
        }),
        "image" => {
            let mime_type = optional_str(block, "mimeType")
                .filter(|s| !s.is_empty())
                .unwrap_or_else(|| "image/png".into());
            Some(ContentBlock::Text {
                text: format!("[image: {mime_type}]"),
            })
        }
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rstest::rstest;
    use serde_json::json;

    /// Build a raw JSONL record: `{"type": "message", "message": ...}`.
    fn record(message: Value) -> Value {
        json!({"type": "message", "message": message})
    }

    // ===================
    // Top-level filtering
    // ===================
    #[rstest]
    fn parse_filters_non_message_type_entries() {
        let records = vec![
            json!({"type": "compaction", "data": {}}),
            record(json!({"role": "user", "content": "hello"})),
        ];
        let msgs = parse(&records);
        assert_eq!(msgs.len(), 1);
        assert_eq!(msgs[0].role, "user");
    }

    #[rstest]
    fn parse_skips_entry_with_missing_message_field() {
        let records = vec![json!({"type": "message"})];
        assert!(parse(&records).is_empty());
    }

    // ========================================
    // Malformed or empty input → zero messages
    // ========================================
    #[rstest]
    #[case::empty_role(json!({"role": "", "content": "data"}))]
    #[case::missing_role(json!({"content": "data"}))]
    #[case::empty_string_content(json!({"role": "user", "content": ""}))]
    #[case::null_content(json!({"role": "user", "content": null}))]
    #[case::text_block_empty_text(json!({
        "role": "assistant",
        "content": [{"type": "text", "text": ""}]
    }))]
    #[case::tool_call_missing_id(json!({
        "role": "assistant",
        "content": [{"type": "toolCall", "name": "Read", "arguments": {}}]
    }))]
    #[case::tool_call_empty_name(json!({
        "role": "assistant",
        "content": [{"type": "toolCall", "id": "t1", "name": "", "arguments": {}}]
    }))]
    #[case::thinking_empty(json!({
        "role": "assistant",
        "content": [{"type": "thinking", "thinking": "", "redacted": false}]
    }))]
    fn parse_drops_malformed_input(#[case] msg: Value) {
        assert!(parse(&[record(msg)]).is_empty());
    }

    // ========================
    // Valid roles pass through
    // ========================
    #[rstest]
    #[case::user(json!({"role": "user", "content": "hi"}))]
    #[case::assistant(json!({
        "role": "assistant",
        "content": [{"type": "text", "text": "ok"}]
    }))]
    fn parse_keeps_valid_role_message(#[case] msg: Value) {
        let expected_role = msg["role"].as_str().unwrap().to_string();
        let msgs = parse(&[record(msg)]);
        assert_eq!(msgs.len(), 1);
        assert_eq!(msgs[0].role, expected_role);
    }

    // ============================
    // bashExecution normalization
    // ============================

    #[rstest]
    fn parse_normalizes_bash_execution_role() {
        let records = vec![record(json!({
            "role": "bashExecution",
            "content": "ls -la",
            "command": "ls -la",
            "output": "total 0",
            "exitCode": 0
        }))];
        let msgs = parse(&records);
        assert_eq!(msgs.len(), 1);
        assert_eq!(msgs[0].role, "bash_execution");
        assert_eq!(msgs[0].command.as_deref(), Some("ls -la"));
        assert_eq!(msgs[0].output.as_deref(), Some("total 0"));
        assert_eq!(msgs[0].exit_code, Some(0));
    }

    #[rstest]
    fn parse_bash_execution_without_optional_fields() {
        let records = vec![record(json!({
            "role": "bashExecution",
            "content": "ls"
        }))];
        let msgs = parse(&records);
        assert_eq!(msgs.len(), 1);
        assert_eq!(msgs[0].role, "bash_execution");
        assert!(msgs[0].command.is_none());
        assert!(msgs[0].output.is_none());
        assert!(msgs[0].exit_code.is_none());
    }

    #[rstest]
    fn parse_bash_execution_nonzero_exit() {
        let records = vec![record(json!({
            "role": "bashExecution",
            "command": "false",
            "output": "",
            "exitCode": 1
        }))];
        let msgs = parse(&records);
        assert_eq!(msgs.len(), 1);
        assert_eq!(msgs[0].exit_code, Some(1));
    }

    // =========================
    // Tool result normalization
    // =========================
    #[rstest]
    fn parse_normalizes_tool_result_role() {
        let records = vec![record(json!({
            "role": "toolResult",
            "content": "some output",
            "toolCallId": "t1",
            "toolName": "Read",
            "isError": false
        }))];
        let msgs = parse(&records);
        assert_eq!(msgs.len(), 1);
        assert_eq!(msgs[0].role, "tool_result");
        assert!(msgs[0].is_tool_result());
        assert_eq!(msgs[0].tool_call_id.as_deref(), Some("t1"));
        assert_eq!(msgs[0].tool_name.as_deref(), Some("Read"));
        assert!(!msgs[0].is_error);
    }

    #[rstest]
    fn parse_tool_result_without_optional_fields() {
        let records = vec![record(
            json!({"role": "toolResult", "content": "output here"}),
        )];
        let msgs = parse(&records);
        assert_eq!(msgs.len(), 1);
        assert_eq!(msgs[0].role, "tool_result");
        assert!(msgs[0].tool_call_id.is_none());
        assert!(msgs[0].tool_name.is_none());
    }

    #[rstest]
    fn parse_tool_result_is_error_flag() {
        let records = vec![record(json!({
            "role": "toolResult",
            "content": "exit code 1",
            "isError": true
        }))];
        assert!(parse(&records)[0].is_error);
    }

    // =================================
    // Content blocks → correct variants
    // =================================
    #[rstest]
    #[case::string_content(json!({"role": "user", "content": "hello world"}), "hello world")]
    #[case::text_block(json!({
        "role": "assistant",
        "content": [{"type": "text", "text": "looking at this"}]
    }), "looking at this")]
    fn parse_yields_text_block(#[case] msg: Value, #[case] expected_text: &str) {
        let msgs = parse(&[record(msg)]);
        assert_eq!(msgs[0].content.len(), 1);
        match &msgs[0].content[0] {
            ContentBlock::Text { text } => assert_eq!(text, expected_text),
            other => panic!("expected Text, got {other:?}"),
        }
    }

    #[rstest]
    fn parse_yields_tool_call_block() {
        let records = vec![record(json!({
            "role": "assistant",
            "content": [{
                "type": "toolCall",
                "id": "tc1",
                "name": "Read",
                "arguments": {"file_path": "src/main.rs"}
            }]
        }))];
        let msgs = parse(&records);
        match &msgs[0].content[0] {
            ContentBlock::ToolCall { id, name, input } => {
                assert_eq!(id, "tc1");
                assert_eq!(name, "Read");
                assert_eq!(input["file_path"], "src/main.rs");
            }
            other => panic!("expected ToolCall, got {other:?}"),
        }
    }

    #[rstest]
    fn parse_tool_call_missing_arguments_defaults_to_null() {
        let records = vec![record(json!({
            "role": "assistant",
            "content": [{"type": "toolCall", "id": "t1", "name": "Read"}]
        }))];
        let msgs = parse(&records);
        match &msgs[0].content[0] {
            ContentBlock::ToolCall { input, .. } => assert!(input.is_null()),
            other => panic!("expected ToolCall, got {other:?}"),
        }
    }

    #[rstest]
    fn parse_yields_thinking_block() {
        let records = vec![record(json!({
            "role": "assistant",
            "content": [{"type": "thinking", "thinking": "hmm...", "redacted": false}]
        }))];
        let msgs = parse(&records);
        match &msgs[0].content[0] {
            ContentBlock::Thinking { thinking, redacted } => {
                assert_eq!(thinking, "hmm...");
                assert!(!redacted);
            }
            other => panic!("expected Thinking, got {other:?}"),
        }
    }

    #[rstest]
    fn parse_thinking_redacted_defaults_to_false() {
        let records = vec![record(json!({
            "role": "assistant",
            "content": [{"type": "thinking", "thinking": "secret"}]
        }))];
        let msgs = parse(&records);
        match &msgs[0].content[0] {
            ContentBlock::Thinking { redacted, .. } => assert!(!redacted),
            other => panic!("expected Thinking, got {other:?}"),
        }
    }

    // ================================
    // Image blocks → text placeholders
    // ================================
    #[rstest]
    #[case::with_type(json!({
        "role": "user",
        "content": [{"type": "image", "mimeType": "image/jpeg"}]
    }), "[image: image/jpeg]")]
    #[case::without_type(json!({
        "role": "user",
        "content": [{"type": "image"}]
    }), "[image: image/png]")]
    fn parse_image_becomes_text_placeholder(#[case] msg: Value, #[case] expected_text: &str) {
        let msgs = parse(&[record(msg)]);
        match &msgs[0].content[0] {
            ContentBlock::Text { text } => assert_eq!(text, expected_text),
            other => panic!("expected Text from image, got {other:?}"),
        }
    }

    // ==========
    // Edge cases
    // ==========
    #[rstest]
    fn parse_unknown_block_type_skipped() {
        let records = vec![record(json!({
            "role": "user",
            "content": [
                {"type": "text", "text": "actual text"},
                {"type": "unknown_x", "data": {}}
            ]
        }))];
        let msgs = parse(&records);
        assert_eq!(msgs.len(), 1);
        assert_eq!(msgs[0].content.len(), 1);
        assert!(matches!(msgs[0].content[0], ContentBlock::Text { .. }));
    }

    #[rstest]
    fn parse_mixed_content_blocks_in_one_message() {
        let records = vec![record(json!({
            "role": "assistant",
            "content": [
                {"type": "text", "text": "found it"},
                {"type": "toolCall", "id": "t1", "name": "Edit", "arguments": {"file_path": "x.rs"}}
            ]
        }))];
        let msgs = parse(&records);
        assert_eq!(msgs[0].content.len(), 2);
        assert!(matches!(msgs[0].content[0], ContentBlock::Text { .. }));
        assert!(matches!(msgs[0].content[1], ContentBlock::ToolCall { .. }));
    }

    #[rstest]
    fn parse_keeps_valid_messages_and_drops_invalid() {
        let records = vec![
            record(json!({"role": "user", "content": "good"})),
            record(json!({"role": "", "content": "bad role"})),
            record(json!({
                "role": "assistant",
                "content": [{"type": "text", "text": "also good"}]
            })),
        ];
        let msgs = parse(&records);
        assert_eq!(msgs.len(), 2);
        assert!(msgs[0].is_user());
        assert!(msgs[1].is_assistant());
    }

    // ===================================
    // parse_messages (unwrapped stdin path)
    // ===================================

    #[rstest]
    fn parse_messages_string_content() {
        let values = vec![json!({"role": "user", "content": "hello"})];
        let msgs = parse_messages(&values);
        assert_eq!(msgs.len(), 1);
        assert!(msgs[0].is_user());
        assert!(matches!(&msgs[0].content[0], ContentBlock::Text { text } if text == "hello"));
    }

    #[rstest]
    fn parse_messages_array_content() {
        let values = vec![json!({
            "role": "assistant",
            "content": [
                {"type": "text", "text": "found it"},
                {"type": "toolCall", "id": "t1", "name": "Read", "arguments": {"file_path": "src/main.rs"}}
            ]
        })];
        let msgs = parse_messages(&values);
        assert_eq!(msgs.len(), 1);
        assert!(msgs[0].is_assistant());
        assert_eq!(msgs[0].content.len(), 2);
        assert!(matches!(msgs[0].content[0], ContentBlock::Text { .. }));
        assert!(matches!(msgs[0].content[1], ContentBlock::ToolCall { .. }));
    }

    #[rstest]
    fn parse_messages_tool_result() {
        let values = vec![json!({
            "role": "toolResult",
            "content": "file contents",
            "toolCallId": "tc1",
            "toolName": "Read",
            "isError": false
        })];
        let msgs = parse_messages(&values);
        assert_eq!(msgs.len(), 1);
        assert!(msgs[0].is_tool_result());
        assert_eq!(msgs[0].tool_call_id.as_deref(), Some("tc1"));
        assert_eq!(msgs[0].tool_name.as_deref(), Some("Read"));
        assert!(!msgs[0].is_error);
    }

    #[rstest]
    fn parse_messages_tool_result_error() {
        let values = vec![json!({
            "role": "toolResult",
            "content": "command failed",
            "isError": true
        })];
        let msgs = parse_messages(&values);
        assert_eq!(msgs.len(), 1);
        assert!(msgs[0].is_tool_result());
        assert!(msgs[0].is_error);
    }

    #[rstest]
    fn parse_messages_drops_malformed() {
        let values = vec![
            json!({"role": "user", "content": "good"}),
            json!({"role": "", "content": "bad"}),
            json!({"content": "no role"}),
            json!({"role": "user", "content": ""}),
        ];
        let msgs = parse_messages(&values);
        assert_eq!(msgs.len(), 1);
        assert!(msgs[0].is_user());
    }

    #[rstest]
    fn parse_messages_empty_input() {
        let msgs = parse_messages(&[]);
        assert!(msgs.is_empty());
    }

    #[rstest]
    fn parse_messages_multiple_messages() {
        let values = vec![
            json!({"role": "user", "content": "q1"}),
            json!({"role": "assistant", "content": [{"type": "text", "text": "a1"}]}),
            json!({"role": "toolResult", "content": "result", "toolName": "Read"}),
            json!({"role": "user", "content": "q2"}),
        ];
        let msgs = parse_messages(&values);
        assert_eq!(msgs.len(), 4);
        assert!(msgs[0].is_user());
        assert!(msgs[1].is_assistant());
        assert!(msgs[2].is_tool_result());
        assert!(msgs[3].is_user());
    }
}
