use std::io::{Read, Write, stdin, stdout};

use anyhow::{Context, Result};

use crate::commands::ExitStatus;
use crate::pi::request::{PiResponse, PiStats};
use crate::pi::{parse::parse_messages, request::PiRequest};
use crate::pipeline::brief::compile_brief;
use crate::pipeline::noise::filter_noise;
use crate::pipeline::normalize::normalize;

pub fn execute() -> Result<ExitStatus> {
    let mut buf = String::new();
    stdin()
        .read_to_string(&mut buf)
        .context("failed to read stdin")?;

    let request: PiRequest =
        serde_json::from_str(&buf).context("failed to parse PiRequest from stdin")?;
    let response = process(request);

    let json = serde_json::to_string(&response).context("failed to serialize PiResponse")?;
    stdout()
        .write_all(json.as_bytes())
        .context("failed to write to stdout")?;

    Ok(ExitStatus::Success)
}

pub fn process(request: PiRequest) -> PiResponse {
    let messages = parse_messages(&request.messages);
    let blocks = normalize(&messages);
    let blocks = filter_noise(blocks);
    let brief = compile_brief(&blocks);
    let stats = PiStats::from_blocks(&blocks, request.messages.len());

    PiResponse {
        summary: brief,
        stats,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rstest::rstest;
    use serde_json::json;

    #[rstest]
    fn process_empty_messages() {
        let request = PiRequest {
            messages: vec![],
            previous_summary: None,
            file_ops: None,
            keep: None,
        };

        let response = process(request);
        assert_eq!(response.stats.messages_in, 0);
        assert_eq!(response.stats.blocks_out, 0);
        assert_eq!(response.stats.tool_calls, 0);
        assert_eq!(response.stats.tool_results, 0);
        assert_eq!(response.summary, "");
    }

    #[rstest]
    fn process_user_messages_only() {
        let request = PiRequest {
            messages: vec![
                json!({"role": "user", "content": "hello"}),
                json!({"role": "user", "content": "world"}),
            ],
            previous_summary: None,
            file_ops: None,
            keep: None,
        };

        let response = process(request);
        assert_eq!(response.stats.messages_in, 2);
        assert_eq!(response.stats.blocks_out, 2);
        assert_eq!(response.stats.tool_calls, 0);
        assert_eq!(response.stats.tool_results, 0);
    }

    #[rstest]
    fn process_full_conversation_flow() {
        let request = PiRequest {
            messages: vec![
                json!({"role": "user", "content": "fix the bug"}),
                json!({
                    "role": "assistant",
                    "content": [
                        {"type": "text", "text": "looking at the code"},
                        {"type": "toolCall", "id": "t1", "name": "Read", "arguments": {"file_path": "src/main.rs"}},
                        {"type": "toolCall", "id": "t2", "name": "Grep", "arguments": {"pattern": "TODO"}}
                    ]
                }),
                json!({"role": "toolResult", "content": "fn main() {}", "toolCallId": "t1", "toolName": "Read", "isError": false}),
                json!({"role": "toolResult", "content": "src/main.rs:10: TODO fix", "toolCallId": "t2", "toolName": "Grep", "isError": false}),
                json!({"role": "assistant", "content": [{"type": "text", "text": "found it"}]}),
            ],
            previous_summary: None,
            file_ops: None,
            keep: None,
        };

        let response = process(request);
        assert!(response.summary.contains("[user]"));
        assert!(response.summary.contains("[assistant]"));
        assert!(response.summary.contains("* Read"));
        assert!(response.summary.contains("* Grep"));
        assert_eq!(response.stats.messages_in, 5);
        // 1 user + 1 assistant text + 2 tool calls + 2 tool results + 1 assistant text = 7
        assert_eq!(response.stats.blocks_out, 7);
        assert_eq!(response.stats.tool_calls, 2);
        assert_eq!(response.stats.tool_results, 2);
    }

    #[rstest]
    fn process_skips_malformed_messages() {
        let request = PiRequest {
            messages: vec![
                json!({"role": "user", "content": "good"}),
                json!({"role": "", "content": "bad role"}),
                json!({"role": "assistant", "content": [{"type": "text", "text": "also good"}]}),
                json!({"content": "no role field"}),
            ],
            previous_summary: None,
            file_ops: None,
            keep: None,
        };

        let response = process(request);
        assert_eq!(response.stats.messages_in, 4);
        assert_eq!(response.stats.blocks_out, 2);
        assert_eq!(response.stats.tool_calls, 0);
        assert_eq!(response.stats.tool_results, 0);
    }

    #[rstest]
    fn process_tool_result_with_error() {
        let request = PiRequest {
            messages: vec![
                json!({"role": "user", "content": "run tests"}),
                json!({
                    "role": "assistant",
                    "content": [
                        {"type": "toolCall", "id": "t1", "name": "Bash", "arguments": {"command": "cargo test"}}
                    ]
                }),
                json!({"role": "toolResult", "content": "2 failed", "toolCallId": "t1", "toolName": "Bash", "isError": true}),
            ],
            previous_summary: None,
            file_ops: None,
            keep: None,
        };

        let response = process(request);
        assert_eq!(response.stats.messages_in, 3);
        assert_eq!(response.stats.blocks_out, 3);
        assert_eq!(response.stats.tool_calls, 1);
        assert_eq!(response.stats.tool_results, 1);
    }
}
