use std::collections::HashMap;

use serde::Deserialize;
use serde_json::Value;

use crate::parse_util::required_str;
use crate::types::{ContentBlock, Message};

/// Top-level Claude JSONL record, discriminated by `type` field.
#[derive(Debug, Deserialize, Clone)]
#[serde(tag = "type")]
enum ClaudeRecord {
    #[serde(rename = "user")]
    User { message: ClaudeMessage },
    #[serde(rename = "assistant")]
    Assistant { message: ClaudeMessage },
    #[serde(rename = "system")]
    System {
        #[serde(default)]
        subtype: Option<String>,
        #[serde(default)]
        message: Option<ClaudeMessage>,
        #[serde(default)]
        content: Option<String>,
    },
    /// Summary, file-history-snapshot, queue-operation, etc.
    #[serde(other)]
    Other,
}

/// Message wrapper inside user/assistant/system records.
#[derive(Debug, Deserialize, Clone)]
struct ClaudeMessage {
    #[serde(default)]
    role: Option<String>,
    #[serde(default)]
    content: Option<Value>, // string | [block, ...]
    #[serde(default)]
    id: Option<String>,
}

/// Convert Claude-format JSONL records into format-agnostic `Vec<Message>`.
/// Deserializes into typed intermediates, runs `merge_chunks` internally,
/// then semantic-parses into `Message`. Takes ownership of the raw values
/// from `lex()` — no clones at the serde boundary.
pub fn parse(raw_records: Vec<Value>) -> Vec<Message> {
    let records: Vec<ClaudeRecord> = raw_records
        .into_iter()
        .filter_map(|v| serde_json::from_value(v).ok())
        .collect();
    let merged = merge_chunks(&records);
    parse_merged(&merged)
}

/// Reassemble consecutive assistant records sharing the same `message.id`.
fn merge_chunks(records: &[ClaudeRecord]) -> Vec<ClaudeRecord> {
    let mut merged = Vec::with_capacity(records.len());
    let mut i = 0;

    while i < records.len() {
        // Try to start a merge group from this assistant-with-id
        if let ClaudeRecord::Assistant { message } = &records[i]
            && let Some(group_id) = &message.id
        {
            let mut group = vec![records[i].clone()];
            let mut j = i + 1;

            while j < records.len() {
                let is_same_group = matches!(&records[j],
                    ClaudeRecord::Assistant { message: m }
                    if m.id.as_ref() == Some(group_id)
                );
                if is_same_group {
                    group.push(records[j].clone());
                    j += 1;
                } else {
                    break;
                }
            }

            merged.push(merge_assistant_group(&group));
            i = j;
            continue;
        }
        // Passthrough: non-assistant, or assistant without id
        merged.push(records[i].clone());
        i += 1;
    }

    merged
}

/// Merge a group of consecutive assistant records. Content arrays are
/// concatenated; the first record provides id (already shared).
fn merge_assistant_group(group: &[ClaudeRecord]) -> ClaudeRecord {
    let base = match &group[0] {
        ClaudeRecord::Assistant { message } => message,
        _ => unreachable!(),
    };

    let all_content: Vec<Value> = group
        .iter()
        .filter_map(|r| match r {
            ClaudeRecord::Assistant { message } => match &message.content {
                Some(Value::Array(blocks)) => Some(blocks.clone()),
                _ => None,
            },
            _ => None,
        })
        .flatten()
        .collect();

    ClaudeRecord::Assistant {
        message: ClaudeMessage {
            role: base.role.clone(),
            content: Some(Value::Array(all_content)),
            id: base.id.clone(),
        },
    }
}

/// Parse pre-merged Claude records into format-agnostic `Vec<Message>`.
fn parse_merged(records: &[ClaudeRecord]) -> Vec<Message> {
    let mut messages = Vec::new();
    let mut tool_id_to_name: HashMap<String, String> = HashMap::new();

    for record in records {
        match record {
            ClaudeRecord::User { message } => {
                if let Some(content) = &message.content {
                    messages.extend(parse_user_message(content, &tool_id_to_name));
                }
            }
            ClaudeRecord::Assistant { message } => {
                if let Some(content) = &message.content {
                    messages.extend(parse_assistant_message(content, &mut tool_id_to_name));
                }
            }
            ClaudeRecord::System {
                subtype,
                message: sys_msg,
                content,
            } => {
                match subtype.as_deref() {
                    Some("compact_boundary") => {
                        messages.push(Message {
                            role: "chain_boundary".into(),
                            content: vec![],
                            tool_call_id: None,
                            tool_name: None,
                            is_error: false,
                        });
                    }
                    Some("init") => {} // skip
                    _ => {
                        // Prefer top-level content, fall back to message.content
                        let text = content
                            .as_deref()
                            .or_else(|| {
                                sys_msg
                                    .as_ref()
                                    .and_then(|m| m.content.as_ref())
                                    .and_then(|v| v.as_str())
                            })
                            .filter(|s| !s.is_empty())
                            .map(|s| s.to_string());
                        if let Some(t) = text {
                            messages.push(Message {
                                role: "system".into(),
                                content: vec![ContentBlock::Text { text: t }],
                                tool_call_id: None,
                                tool_name: None,
                                is_error: false,
                            });
                        }
                    }
                }
            }
            ClaudeRecord::Other => {}
        }
    }

    messages
}

/// Partition a user message's content into text/image/document blocks (-> user
/// `Message`) and tool_result blocks (-> separate `tool_result` `Message`
/// each).
fn parse_user_message(content: &Value, tool_id_to_name: &HashMap<String, String>) -> Vec<Message> {
    let blocks = match content.as_array() {
        Some(a) => a,
        None => {
            // String content (rare, but valid in some Claude Code versions)
            if let Some(s) = content.as_str()
                && !s.is_empty()
            {
                return vec![Message {
                    role: "user".into(),
                    content: vec![ContentBlock::Text { text: s.into() }],
                    tool_call_id: None,
                    tool_name: None,
                    is_error: false,
                }];
            }
            return vec![];
        }
    };

    let (text_blocks, tool_result_blocks): (Vec<_>, Vec<_>) = blocks.iter().partition(|b| {
        matches!(
            b.get("type").and_then(Value::as_str),
            Some("text" | "image" | "document") | None
        )
    });

    let mut results = Vec::new();

    // Emit user message for non-tool_result blocks
    let text_content: Vec<ContentBlock> = text_blocks
        .iter()
        .filter_map(|b| parse_content_block(b))
        .collect();
    if !text_content.is_empty() {
        results.push(Message {
            role: "user".into(),
            content: text_content,
            tool_call_id: None,
            tool_name: None,
            is_error: false,
        });
    }

    // Emit tool_result messages for each tool_result block
    for block in &tool_result_blocks {
        if block.get("type").and_then(Value::as_str) != Some("tool_result") {
            continue;
        }

        let tool_use_id = match required_str(block, "tool_use_id") {
            Some(id) => id,
            None => continue,
        };

        let name = tool_id_to_name.get(&tool_use_id).cloned();

        let content_str = extract_tool_result_content(&block["content"]);
        let is_error = block
            .get("is_error")
            .and_then(Value::as_bool)
            .unwrap_or(false);

        results.push(Message {
            role: "tool_result".into(),
            content: vec![ContentBlock::Text { text: content_str }],
            tool_call_id: Some(tool_use_id),
            tool_name: name,
            is_error,
        });
    }

    results
}

/// Parse assistant content blocks. Tool_use id->name mappings are stored
/// for later tool_result name resolution.
fn parse_assistant_message(
    content: &Value,
    tool_id_to_name: &mut HashMap<String, String>,
) -> Vec<Message> {
    let blocks = match content.as_array() {
        Some(a) => a,
        None => return vec![],
    };

    let parsed: Vec<ContentBlock> = blocks
        .iter()
        .filter_map(|b| {
            let cb = parse_content_block(b)?;
            if let ContentBlock::ToolCall { id, name, .. } = &cb {
                tool_id_to_name.insert(id.clone(), name.clone());
            }
            Some(cb)
        })
        .collect();

    if parsed.is_empty() {
        return vec![];
    }

    vec![Message {
        role: "assistant".into(),
        content: parsed,
        tool_call_id: None,
        tool_name: None,
        is_error: false,
    }]
}

/// Convert a Claude-format content block into a format-agnostic `ContentBlock`.
fn parse_content_block(block: &Value) -> Option<ContentBlock> {
    match block.get("type").and_then(Value::as_str)? {
        "text" => Some(ContentBlock::Text {
            text: required_str(block, "text")?,
        }),
        "tool_use" => Some(ContentBlock::ToolCall {
            id: required_str(block, "id")?,
            name: required_str(block, "name")?,
            input: block.get("input").cloned().unwrap_or(Value::Null),
        }),
        "thinking" => Some(ContentBlock::Thinking {
            thinking: required_str(block, "thinking")?,
            redacted: block
                .get("redacted")
                .and_then(Value::as_bool)
                .unwrap_or(false),
        }),
        "image" => {
            let mime_type = source_media_type(block).unwrap_or_else(|| "image/png".into());
            Some(ContentBlock::Text {
                text: format!("[image: {mime_type}]"),
            })
        }
        "document" => {
            let mime_type =
                source_media_type(block).unwrap_or_else(|| "application/octet-stream".into());
            Some(ContentBlock::Text {
                text: format!("[document: {mime_type}]"),
            })
        }
        _ => None,
    }
}

// ===========================
// extract_tool_result_content
// ===========================

/// Extract `source.media_type` from image/document blocks.
fn source_media_type(block: &Value) -> Option<String> {
    block
        .get("source")
        .and_then(|s| s.get("media_type"))
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .map(String::from)
}

/// Claude `tool_result.content` can be a plain string or an array of
/// content blocks.
fn extract_tool_result_content(content: &Value) -> String {
    match content {
        Value::String(s) => s.clone(),
        Value::Array(blocks) => blocks
            .iter()
            .filter_map(|b| match b.get("type").and_then(Value::as_str)? {
                "text" => required_str(b, "text"),
                _ => None,
            })
            .collect::<Vec<_>>()
            .join("\n"),
        _ => String::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rstest::rstest;
    use serde_json::json;

    // Helpers: build raw JSONL `Value` records (same as what `lex` produces)
    fn rec(typ: &str, message: Value) -> Value {
        json!({"type": typ, "message": message})
    }

    fn assistant_with_id(id: &str, content: Value) -> Value {
        json!({
            "type": "assistant",
            "message": {
                "role": "assistant",
                "content": content,
                "id": id,
                "model": "claude-3",
                "usage": {"input_tokens": 10, "output_tokens": 5}
            }
        })
    }

    /// Round-trip helper: raw values -> typed -> merge → parse_merged.
    fn parse_raw(records: &[Value]) -> Vec<Message> {
        let typed: Vec<ClaudeRecord> = records
            .iter()
            .filter_map(|v| serde_json::from_value(v.clone()).ok())
            .collect();
        let merged = merge_chunks(&typed);
        parse_merged(&merged)
    }

    /// Convert raw values to typed records.
    fn typed(records: &[Value]) -> Vec<ClaudeRecord> {
        records
            .iter()
            .filter_map(|v| serde_json::from_value(v.clone()).ok())
            .collect()
    }

    // ==============
    // merge_chunks
    // ==============

    #[rstest]
    fn merge_chunks_empty_input() {
        assert!(merge_chunks(&[]).is_empty());
    }

    #[rstest]
    fn merge_chunks_no_splitting_passthrough() {
        let records = typed(&[
            rec(
                "user",
                json!({"role": "user", "content": [{"type": "text", "text": "hi"}]}),
            ),
            assistant_with_id("msg_1", json!([{"type": "text", "text": "hello"}])),
        ]);

        let result = merge_chunks(&records);
        assert_eq!(result.len(), 2);
        assert!(matches!(&result[0], ClaudeRecord::User { .. }));
        let second = match &result[1] {
            ClaudeRecord::Assistant { message } => message,
            other => panic!("expected Assistant, got {other:?}"),
        };
        assert_eq!(second.id.as_deref(), Some("msg_1"));
    }

    #[rstest]
    fn merge_chunks_consecutive_same_id_merged() {
        let records = typed(&[
            assistant_with_id("msg_1", json!([{"type": "text", "text": "part 1"}])),
            assistant_with_id("msg_1", json!([{"type": "text", "text": "part 2"}])),
            assistant_with_id(
                "msg_1",
                json!([{"type": "tool_use", "id": "t1", "name": "Read", "input": {}}]),
            ),
        ]);

        let result = merge_chunks(&records);
        assert_eq!(result.len(), 1);

        let merged_message = match &result[0] {
            ClaudeRecord::Assistant { message } => message,
            other => panic!("expected Assistant, got {other:?}"),
        };
        let content = merged_message.content.as_ref().unwrap().as_array().unwrap();
        assert_eq!(content.len(), 3);
        assert_eq!(content[0]["text"], "part 1");
        assert_eq!(content[1]["text"], "part 2");
        assert_eq!(content[2]["name"], "Read");
    }

    #[rstest]
    fn merge_chunks_different_ids_not_merged() {
        let records = typed(&[
            assistant_with_id("msg_1", json!([{"type": "text", "text": "a"}])),
            assistant_with_id("msg_2", json!([{"type": "text", "text": "b"}])),
        ]);
        assert_eq!(merge_chunks(&records).len(), 2);
    }

    #[rstest]
    fn merge_chunks_non_assistant_interleaved_blocks_merge() {
        let records = typed(&[
            assistant_with_id("msg_1", json!([{"type": "text", "text": "part 1"}])),
            assistant_with_id("msg_1", json!([{"type": "text", "text": "part 2"}])),
            rec(
                "user",
                json!({"role": "user", "content": [{"type": "tool_result", "tool_use_id": "t1", "content": "ok"}]}),
            ),
            assistant_with_id("msg_1", json!([{"type": "text", "text": "part 3"}])),
        ]);

        let result = merge_chunks(&records);
        assert_eq!(result.len(), 3);
        assert!(matches!(&result[0], ClaudeRecord::Assistant { .. }));
        assert!(matches!(&result[1], ClaudeRecord::User { .. }));
        assert!(matches!(&result[2], ClaudeRecord::Assistant { .. }));
    }

    // ==============
    // parse_merged
    // ==============

    // ── user messages ──

    #[rstest]
    fn parse_user_message_text() {
        let msgs = parse_raw(&[rec(
            "user",
            json!({"role": "user", "content": [{"type": "text", "text": "hello"}]}),
        )]);
        assert_eq!(msgs.len(), 1);
        assert!(msgs[0].is_user());
    }

    #[rstest]
    fn parse_user_message_string_content() {
        let msgs = parse_raw(&[rec(
            "user",
            json!({"role": "user", "content": "plain string"}),
        )]);
        assert_eq!(msgs.len(), 1);
        assert!(
            matches!(&msgs[0].content[0], ContentBlock::Text { text } if text == "plain string")
        );
    }

    // ── assistant messages ──

    #[rstest]
    fn parse_assistant_text() {
        let msgs = parse_raw(&[rec(
            "assistant",
            json!({"role": "assistant", "content": [{"type": "text", "text": "ok"}]}),
        )]);
        assert_eq!(msgs.len(), 1);
        assert!(msgs[0].is_assistant());
    }

    #[rstest]
    fn parse_assistant_tool_use() {
        let msgs = parse_raw(&[rec(
            "assistant",
            json!({"role": "assistant", "content": [
                {"type": "tool_use", "id": "t1", "name": "Read", "input": {"file_path": "src/main.rs"}}
            ]}),
        )]);
        assert_eq!(msgs.len(), 1);
        match &msgs[0].content[0] {
            ContentBlock::ToolCall { id, name, input } => {
                assert_eq!(id, "t1");
                assert_eq!(name, "Read");
                assert_eq!(input["file_path"], "src/main.rs");
            }
            other => panic!("expected ToolCall, got {other:?}"),
        }
    }

    #[rstest]
    fn parse_assistant_thinking_preserved() {
        let msgs = parse_raw(&[rec(
            "assistant",
            json!({"role": "assistant", "content": [
                {"type": "thinking", "thinking": "hmm...", "redacted": false},
                {"type": "text", "text": "visible text"}
            ]}),
        )]);
        assert_eq!(msgs.len(), 1);
        assert_eq!(msgs[0].content.len(), 2);
        assert!(matches!(&msgs[0].content[0], ContentBlock::Thinking { .. }));
    }

    #[rstest]
    fn parse_merged_assistant_produces_single_message() {
        let msgs = parse_raw(&[rec(
            "assistant",
            json!({"role": "assistant", "content": [
                {"type": "text", "text": "part 1"},
                {"type": "text", "text": "part 2"},
                {"type": "tool_use", "id": "t1", "name": "Read", "input": {}}
            ]}),
        )]);
        assert_eq!(msgs.len(), 1);
        assert_eq!(msgs[0].content.len(), 3);
    }

    // ── tool_result unwinding ──

    #[rstest]
    fn parse_assistant_tool_use_tracks_name() {
        let msgs = parse_raw(&[
            rec(
                "assistant",
                json!({"role": "assistant", "content": [
                    {"type": "tool_use", "id": "toolu_001", "name": "Write", "input": {}}
                ]}),
            ),
            rec(
                "user",
                json!({"role": "user", "content": [
                    {"type": "tool_result", "tool_use_id": "toolu_001", "content": "done", "is_error": false}
                ]}),
            ),
        ]);
        assert_eq!(msgs.len(), 2);
        assert!(msgs[1].is_tool_result());
        assert_eq!(msgs[1].tool_name.as_deref(), Some("Write"));
    }

    #[rstest]
    fn parse_tool_result_unresolved_id_is_none() {
        let msgs = parse_raw(&[rec(
            "user",
            json!({"role": "user", "content": [
                {"type": "tool_result", "tool_use_id": "nonexistent", "content": "output"}
            ]}),
        )]);
        assert_eq!(msgs.len(), 1);
        assert_eq!(msgs[0].tool_name.as_deref(), None);
    }

    #[rstest]
    #[case::error_true(true)]
    #[case::error_false(false)]
    fn parse_tool_result_is_error_flag(#[case] is_error: bool) {
        let msgs = parse_raw(&[rec(
            "user",
            json!({"role": "user", "content": [
                {"type": "tool_result", "tool_use_id": "t1", "content": "result", "is_error": is_error}
            ]}),
        )]);
        assert_eq!(msgs.len(), 1);
        assert_eq!(msgs[0].is_error, is_error);
    }

    #[rstest]
    fn parse_user_with_both_text_and_tool_result() {
        let msgs = parse_raw(&[
            rec(
                "assistant",
                json!({"role": "assistant", "content": [
                    {"type": "tool_use", "id": "t1", "name": "Edit", "input": {}}
                ]}),
            ),
            rec(
                "user",
                json!({"role": "user", "content": [
                    {"type": "text", "text": "feedback"},
                    {"type": "tool_result", "tool_use_id": "t1", "content": "edited"}
                ]}),
            ),
        ]);
        assert_eq!(msgs.len(), 3);
        assert!(msgs[0].is_assistant());
        assert!(msgs[1].is_user());
        assert!(msgs[2].is_tool_result());
    }

    #[rstest]
    fn parse_multiple_tool_results_in_one_user() {
        let msgs = parse_raw(&[
            rec(
                "assistant",
                json!({"role": "assistant", "content": [
                    {"type": "tool_use", "id": "t1", "name": "Read", "input": {}},
                    {"type": "tool_use", "id": "t2", "name": "Edit", "input": {}}
                ]}),
            ),
            rec(
                "user",
                json!({"role": "user", "content": [
                    {"type": "tool_result", "tool_use_id": "t1", "content": "file"},
                    {"type": "tool_result", "tool_use_id": "t2", "content": "edited"}
                ]}),
            ),
        ]);
        assert_eq!(msgs.len(), 3);
        assert_eq!(msgs[1].tool_name.as_deref(), Some("Read"));
        assert_eq!(msgs[2].tool_name.as_deref(), Some("Edit"));
    }

    // ── block types ──

    #[rstest]
    #[case::image_known("image", "image/jpeg", "[image: image/jpeg]")]
    #[case::image_default("image", "", "[image: image/png]")]
    #[case::document("document", "application/pdf", "[document: application/pdf]")]
    fn parse_media_block_becomes_text_placeholder(
        #[case] block_type: &str,
        #[case] media_type: &str,
        #[case] expected: &str,
    ) {
        let mut source = json!({"type": "base64", "data": "..."});
        if !media_type.is_empty() {
            source["media_type"] = json!(media_type);
        }
        let msgs = parse_raw(&[rec(
            "user",
            json!({"role": "user", "content": [
                {"type": block_type, "source": source}
            ]}),
        )]);
        assert_eq!(msgs.len(), 1);
        assert!(matches!(&msgs[0].content[0], ContentBlock::Text { text } if text == expected));
    }

    #[rstest]
    fn parse_unknown_block_type_skipped() {
        let msgs = parse_raw(&[rec(
            "user",
            json!({"role": "user", "content": [
                {"type": "text", "text": "visible"},
                {"type": "unknown_x", "data": {}}
            ]}),
        )]);
        assert_eq!(msgs.len(), 1);
        assert_eq!(msgs[0].content.len(), 1);
    }

    // ── system messages ──

    #[rstest]
    fn parse_system_init_skipped() {
        let msgs = parse_raw(&[json!({
            "type": "system",
            "subtype": "init",
            "content": "some text"
        })]);
        assert!(msgs.is_empty());
    }

    #[rstest]
    fn parse_system_compact_boundary_emits_sentinel() {
        let msgs = parse_raw(&[json!({
            "type": "system",
            "subtype": "compact_boundary",
            "content": "some text"
        })]);
        assert_eq!(msgs.len(), 1);
        assert!(msgs[0].is_chain_boundary());
    }

    #[rstest]
    fn parse_system_custom_kept() {
        let msgs = parse_raw(&[json!({
            "type": "system",
            "subtype": "custom",
            "content": "some text"
        })]);
        assert_eq!(msgs.len(), 1);
        assert!(msgs[0].is_system());
    }

    // ── malformed / resilience ──

    #[rstest]
    #[case::missing_message(json!({ "type": "user" }))]
    #[case::non_object_message(json!({ "type": "user", "message": "error" }))]
    #[case::typo_content_field(json!({
        "type": "user",
        "message": { "role": "user", "contenst": [{ "type": "text", "text": "data" }] }
    }))]
    fn parse_skips_malformed_record(#[case] record: Value) {
        assert!(parse_raw(&[record]).is_empty());
    }

    #[rstest]
    fn parse_mixed_valid_and_invalid_records() {
        let msgs = parse_raw(&[
            json!({"type": "user"}), // missing message -> skip
            rec(
                "user",
                json!({"role": "user", "content": [{"type": "text", "text": "valid"}]}),
            ),
            json!({"type": "user", "message": "error"}), // non-object -> skip
            rec(
                "assistant",
                json!({"role": "assistant", "content": [{"type": "text", "text": "also valid"}]}),
            ),
        ]);
        assert_eq!(msgs.len(), 2);
        assert!(msgs[0].is_user());
        assert!(msgs[1].is_assistant());
    }

    // ==============
    // parse (public)
    // ==============

    #[rstest]
    fn parse_integration_split_assistant() {
        let records = vec![
            rec(
                "user",
                json!({"role": "user", "content": [{"type": "text", "text": "question"}]}),
            ),
            assistant_with_id("msg_split", json!([{"type": "text", "text": "part 1"}])),
            assistant_with_id(
                "msg_split",
                json!([
                    {"type": "text", "text": "part 2"},
                    {"type": "tool_use", "id": "toolu_1", "name": "Read", "input": {}}
                ]),
            ),
            rec(
                "user",
                json!({"role": "user", "content": [
                    {"type": "tool_result", "tool_use_id": "toolu_1", "content": "result"}
                ]}),
            ),
        ];
        let msgs = parse(records);

        assert_eq!(msgs.len(), 3);
        assert!(msgs[0].is_user());
        assert!(msgs[1].is_assistant());
        assert_eq!(msgs[1].content.len(), 3);
        assert!(msgs[2].is_tool_result());
        assert_eq!(msgs[2].tool_name.as_deref(), Some("Read"));
    }

    #[rstest]
    fn parse_integration_non_assistant_skipped() {
        let msgs = parse(vec![
            json!({"type": "summary", "summary": "test"}),
            json!({"type": "file-history-snapshot", "data": {}}),
            rec(
                "user",
                json!({"role": "user", "content": [{"type": "text", "text": "hello"}]}),
            ),
        ]);
        assert_eq!(msgs.len(), 1);
        assert!(msgs[0].is_user());
    }

    #[rstest]
    fn parse_empty_input() {
        assert!(parse(vec![]).is_empty());
    }

    // ==============
    // Fixture tests
    // ==============

    fn parse_fixture(name: &str) -> Vec<Message> {
        let path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("tests/fixtures")
            .join(name);
        let records = crate::lex::lex(&path).expect("fixture should be valid JSONL");
        parse(records)
    }

    #[rstest]
    fn fixture_claude_sample() {
        let msgs = parse_fixture("claude_sample.jsonl");
        assert_eq!(msgs.len(), 7);
        assert!(msgs[0].is_user());
        assert!(msgs[1].is_assistant());
        assert!(msgs[2].is_tool_result());
    }

    #[rstest]
    fn fixture_claude_rich() {
        let msgs = parse_fixture("claude_rich.jsonl");
        assert!(msgs.len() > 20);
        let tool_results: Vec<_> = msgs.iter().filter(|m| m.is_tool_result()).collect();
        assert!(!tool_results.is_empty());
        let errors: Vec<_> = msgs.iter().filter(|m| m.is_error).collect();
        assert!(!errors.is_empty());
    }

    #[rstest]
    fn fixture_representative_messages() {
        let msgs = parse_fixture("representative_messages.jsonl");
        assert_eq!(msgs.len(), 11);
        let has_edit = msgs.iter().any(|m| {
            m.content
                .iter()
                .any(|b| matches!(b, ContentBlock::ToolCall { name, .. } if name == "Edit"))
        });
        let has_bash = msgs.iter().any(|m| {
            m.content
                .iter()
                .any(|b| matches!(b, ContentBlock::ToolCall { name, .. } if name == "Bash"))
        });
        assert!(has_edit);
        assert!(has_bash);
    }

    #[rstest]
    fn fixture_edge_cases() {
        let msgs = parse_fixture("edge_cases.jsonl");
        assert!(!msgs.is_empty());
        let has_error = msgs.iter().any(|m| m.is_tool_result() && m.is_error);
        assert!(has_error);
    }

    #[rstest]
    fn fixture_away_summary() {
        let msgs = parse_fixture("away_summary.jsonl");
        assert_eq!(msgs.len(), 1);
        assert!(msgs[0].is_system());
        assert!(
            matches!(&msgs[0].content[0], ContentBlock::Text { text } if text.contains("We're adding"))
        );
    }

    #[rstest]
    fn fixture_split_assistant() {
        let msgs = parse_fixture("split_assistant.jsonl");
        assert_eq!(msgs.len(), 4);
        assert!(msgs[0].is_user());
        assert!(msgs[1].is_assistant());
        assert_eq!(msgs[1].content.len(), 4);
        assert!(msgs[2].is_tool_result());
        assert_eq!(msgs[2].tool_name.as_deref(), Some("Write"));
        assert!(msgs[3].is_assistant());
    }
}
