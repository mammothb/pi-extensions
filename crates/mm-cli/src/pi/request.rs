use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::pipeline::stats::count_tokens;
use crate::types::NormalizedBlock;

/// Full input from the TS shim via stdin.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PiRequest {
    pub messages: Vec<Value>, // pi-ai format message objects
    #[serde(default)]
    pub previous_summary: Option<String>,
}

/// Response written to stdout.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PiResponse {
    pub summary: String,
    pub stats: PiStats,
}

/// Normalization statistics for debugging/verification.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PiStats {
    pub messages_in: usize,
    pub blocks_out: usize,
    pub tool_calls: usize,
    pub tool_results: usize,
    pub token_count: usize,
}

/// Extract text content from a block for token counting.
fn block_token_text(block: &NormalizedBlock) -> String {
    match block {
        NormalizedBlock::User { text, .. } => text.clone(),
        NormalizedBlock::Assistant { text, .. } => text.clone(),
        NormalizedBlock::ToolCall { name, args, .. } => {
            format!("{name} {}", serde_json::to_string(args).unwrap_or_default())
        }
        NormalizedBlock::ToolResult { text, .. } => text.clone(),
        NormalizedBlock::Bash {
            command, output, ..
        } => {
            format!("{command} {output}")
        }
    }
}

impl PiStats {
    pub fn from_blocks(blocks: &[NormalizedBlock], messages_in: usize) -> Self {
        let tool_calls = blocks
            .iter()
            .filter(|b| matches!(b, NormalizedBlock::ToolCall { .. }))
            .count();
        let tool_results = blocks
            .iter()
            .filter(|b| matches!(b, NormalizedBlock::ToolResult { .. }))
            .count();
        let token_count = blocks
            .iter()
            .map(|b| count_tokens(&block_token_text(b)))
            .sum();
        Self {
            messages_in,
            blocks_out: blocks.len(),
            tool_calls,
            tool_results,
            token_count,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rstest::rstest;
    use serde_json::json;

    // =====================
    // PiRequest deserialize
    // =====================

    #[rstest]
    fn deserialize_full_request() {
        let json = json!({
            "messages": [
                {"role": "user", "content": "hello"},
                {"role": "assistant", "content": [{"type": "text", "text": "hi"}]}
            ],
            "previousSummary": "[Session Goal]\n- fix bug"
        });

        let req: PiRequest = serde_json::from_value(json).unwrap();
        assert_eq!(req.messages.len(), 2);
        assert_eq!(
            req.previous_summary.as_deref(),
            Some("[Session Goal]\n- fix bug")
        );
    }

    #[rstest]
    fn deserialize_minimal_request() {
        let json = json!({
            "messages": [{"role": "user", "content": "hello"}]
        });

        let req: PiRequest = serde_json::from_value(json).unwrap();
        assert_eq!(req.messages.len(), 1);
        assert!(req.previous_summary.is_none());
    }

    #[rstest]
    fn deserialize_null_optional_fields() {
        let json = json!({
            "messages": [],
            "previousSummary": null
        });

        let req: PiRequest = serde_json::from_value(json).unwrap();
        assert!(req.previous_summary.is_none());
    }

    // ====================
    // PiResponse serialize
    // ====================

    #[rstest]
    fn serialize_response() {
        let response = PiResponse {
            summary: "test summary".into(),
            stats: PiStats {
                messages_in: 3,
                blocks_out: 5,
                tool_calls: 2,
                tool_results: 1,
                token_count: 42,
            },
        };

        let json = serde_json::to_value(&response).unwrap();
        assert_eq!(json["summary"], "test summary");
        assert_eq!(json["stats"]["messagesIn"], 3);
        assert_eq!(json["stats"]["blocksOut"], 5);
        assert_eq!(json["stats"]["toolCalls"], 2);
        assert_eq!(json["stats"]["toolResults"], 1);
        assert_eq!(json["stats"]["tokenCount"], 42);
    }

    #[rstest]
    fn serialize_response_empty_summary() {
        let response = PiResponse {
            summary: String::new(),
            stats: PiStats {
                messages_in: 0,
                blocks_out: 0,
                tool_calls: 0,
                tool_results: 0,
                token_count: 0,
            },
        };

        let json = serde_json::to_string(&response).unwrap();
        assert!(json.contains("\"summary\":\"\""));
    }

    // =======
    // PiStats
    // =======

    fn user_block(idx: usize) -> NormalizedBlock {
        NormalizedBlock::User {
            text: "hello".into(),
            source_index: idx,
        }
    }

    fn tool_call_block(name: &str, idx: usize) -> NormalizedBlock {
        NormalizedBlock::ToolCall {
            name: name.into(),
            args: json!({"file_path": "src/main.rs"}),
            source_index: idx,
        }
    }

    fn tool_result_block(name: &str, idx: usize) -> NormalizedBlock {
        NormalizedBlock::ToolResult {
            name: name.into(),
            text: "output".into(),
            source_index: idx,
        }
    }

    #[rstest]
    fn from_blocks_counts_correctly() {
        let blocks = vec![
            user_block(0),
            tool_call_block("Read", 1),
            tool_result_block("Read", 2),
            user_block(3),
            tool_call_block("Edit", 4),
            tool_call_block("Bash", 5),
            tool_result_block("Edit", 6),
        ];

        let stats = PiStats::from_blocks(&blocks, 4);
        assert_eq!(stats.messages_in, 4);
        assert_eq!(stats.blocks_out, 7);
        assert_eq!(stats.tool_calls, 3);
        assert_eq!(stats.tool_results, 2);
        assert!(stats.token_count > 0);
    }

    #[rstest]
    fn from_blocks_empty() {
        let stats = PiStats::from_blocks(&[], 0);
        assert_eq!(stats.messages_in, 0);
        assert_eq!(stats.blocks_out, 0);
        assert_eq!(stats.tool_calls, 0);
        assert_eq!(stats.tool_results, 0);
        assert_eq!(stats.token_count, 0);
    }

    #[rstest]
    fn from_blocks_only_users() {
        let blocks = vec![user_block(0), user_block(1), user_block(2)];
        let stats = PiStats::from_blocks(&blocks, 3);
        assert_eq!(stats.messages_in, 3);
        assert_eq!(stats.blocks_out, 3);
        assert_eq!(stats.tool_calls, 0);
        assert_eq!(stats.tool_results, 0);
        assert_eq!(stats.token_count, 3); // "hello" × 3
    }
}
