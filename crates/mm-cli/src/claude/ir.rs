use serde_json::Value;

use crate::types::{ContentBlock, Message};

/// Split messages at `chain_boundary` sentinels. Returns one `Vec` per chain
/// with sentinels removed. Non-empty chains only.
pub fn split_chains(messages: &[Message]) -> Vec<Vec<&Message>> {
    let mut chains = vec![];
    let mut cur = vec![];

    for msg in messages {
        if msg.is_chain_boundary() {
            if !cur.is_empty() {
                chains.push(cur);
                cur = vec![];
            }
        } else {
            cur.push(msg);
        }
    }
    if !cur.is_empty() {
        chains.push(cur);
    }
    chains
}

const SEPARATOR: &str =
    "──────────────────────────────────────────────────────────────────────────";
const DOUBLE_SEP: &str =
    "══════════════════════════════════════════════════════════════════════════";

/// Render a lossless `.txt` transcript from format-agnostic `Message`s.
///
/// Line numbers are consecutive across the entire file (not per-chain).
/// Chain headers only appear when there are multiple chains (compact_boundary
/// splits).
pub fn emit_full(messages: &[Message], no_stats: bool) -> String {
    let chains = split_chains(messages);
    let mut out = String::new();
    let mut global_line: usize = 0;

    for (i, chain) in chains.iter().enumerate() {
        if chains.len() > 1 {
            out.push_str(DOUBLE_SEP);
            out.push('\n');
            // TODO: model extraction from original records (not in Message yet).
            out.push_str(&format!("Chain {} — system\n", i + 1));
            out.push_str(DOUBLE_SEP);
            out.push('\n');
            out.push('\n');
        }

        let mut prev_role: Option<&str> = None;

        for msg in chain {
            // Insert separator for role transitions that need visual grouping.
            let needs_sep = match (prev_role, msg.role.as_str()) {
                // assistant (with tool calls) -> tool_result
                (Some("assistant"), "tool_result") => true,
                // tool_result -> next assistant (new turn)
                (Some("tool_result"), "assistant") => true,
                // tool_result -> user (new turn)
                (Some("tool_result"), "user") => true,
                _ => false,
            };
            if needs_sep {
                out.push_str(SEPARATOR);
                out.push('\n');
                out.push('\n');
            }

            match msg.role.as_str() {
                "user" => {
                    global_line += 1;
                    out.push_str(&format!("[{global_line}]  user\n"));
                    for block in &msg.content {
                        if let ContentBlock::Text { text } = block {
                            for line in text.lines() {
                                out.push_str(&format!("     {line}\n"));
                            }
                        }
                    }
                }
                "assistant" => {
                    global_line += 1;
                    out.push_str(&format!("[{global_line}]  assistant\n"));
                    for block in &msg.content {
                        match block {
                            ContentBlock::Text { text } => {
                                for line in text.lines() {
                                    out.push_str(&format!("     {line}\n"));
                                }
                            }
                            ContentBlock::ToolCall { id, name, input } => {
                                global_line += 1;
                                let summary = tool_call_summary(name, input);
                                let sid = short_id(id);
                                out.push_str(&format!(
                                    "[{global_line}]    tool_call {summary}   #{sid}\n"
                                ));
                            }
                            ContentBlock::Thinking { thinking, .. } => {
                                out.push_str("     [thinking]\n");
                                for line in thinking.lines() {
                                    out.push_str(&format!("     {line}\n"));
                                }
                            }
                            // ToolResult blocks shouldn't appear in assistant messages
                            // after claude::parse unwinds them.
                            ContentBlock::ToolResult { .. } => {}
                        }
                    }
                }
                "tool_result" => {
                    global_line += 1;
                    let name = msg.tool_name.as_deref().unwrap_or("<unknown>");
                    out.push_str(&format!("[{global_line}]  tool_result [{name}]\n"));
                    for block in &msg.content {
                        if let ContentBlock::Text { text } = block {
                            for line in text.lines() {
                                out.push_str(&format!("     {line}\n"));
                            }
                        }
                    }
                }
                "system" => {
                    global_line += 1;
                    out.push_str(&format!("[{global_line}]  system\n"));
                    for block in &msg.content {
                        if let ContentBlock::Text { text } = block {
                            for line in text.lines() {
                                out.push_str(&format!("     {line}\n"));
                            }
                        }
                    }
                }
                _ => {} // chain_boundary and unknown — skip
            }

            prev_role = Some(msg.role.as_str());
        }
    }

    if !no_stats {
        let footer = stats_footer(messages);
        if !footer.is_empty() {
            out.push_str(SEPARATOR);
            out.push('\n');
            out.push_str(&footer);
            out.push('\n');
        }
    }

    out
}

/// Build a stats footer: "N messages · T tool calls · ~X tokens"
fn stats_footer(messages: &[Message]) -> String {
    let msg_count = messages.len();
    if msg_count == 0 {
        return String::new();
    }

    let mut tool_calls = 0usize;
    let mut tool_results = 0usize;
    let mut char_count = 0usize;

    for msg in messages {
        if msg.role.as_str() == "tool_result" {
            tool_results += 1
        }
        for block in &msg.content {
            match block {
                ContentBlock::Text { text } => char_count += text.len(),
                ContentBlock::ToolCall { name, input, .. } => {
                    tool_calls += 1;
                    char_count += name.len();
                    char_count += input.to_string().len();
                }
                ContentBlock::ToolResult { content, .. } => {
                    char_count += content.len();
                }
                ContentBlock::Thinking { thinking, .. } => {
                    char_count += thinking.len();
                }
            }
        }
    }

    let tok_est = char_count / 4;
    let tok = if tok_est >= 1000 {
        format!("~{:.1}k", tok_est as f64 / 1000.0)
    } else {
        format!("~{tok_est}")
    };

    let mut parts = vec![format!("{msg_count} messages")];
    if tool_calls > 0 {
        parts.push(format!("{tool_calls} tool calls"));
    }
    if tool_results > 0 {
        parts.push(format!("{tool_results} tool results"));
    }
    parts.push(format!("{tok} tokens"));

    parts.join(" · ")
}

/// Build a one-line tool-call summary: `Name("arg")` or `Name`.
fn tool_call_summary(name: &str, input: &Value) -> String {
    if let Some(field) = tool_arg_field(name)
        && let Some(val) = input.get(field).and_then(Value::as_str)
    {
        return format!("{name}(\"{val}\")");
    }
    if name == "Bash" {
        let val = input
            .get("description")
            .or_else(|| input.get("command"))
            .and_then(Value::as_str)
            .unwrap_or("");
        // Truncate long commands (no `description` means raw command).
        let has_desc = input.get("description").is_some();
        let val = if !has_desc && val.len() > 60 {
            format!("{}...", &val[..57])
        } else {
            val.to_string()
        };
        if val.is_empty() {
            return "Bash".into();
        }
        return format!("Bash(\"{val}\")");
    }
    name.to_string()
}

/// Map tool name -> primary arg field for one-line summaries.
fn tool_arg_field(name: &str) -> Option<&str> {
    match name {
        "Read" | "Edit" | "Write" => Some("file_path"),
        "Glob" | "Grep" => Some("pattern"),
        "Agent" => Some("description"),
        "Skill" => Some("skill"),
        _ => None,
    }
}

/// Shorten a tool call ID to its last 6 characters
fn short_id(id: &str) -> &str {
    if id.len() > 6 {
        &id[id.len() - 6..]
    } else {
        id
    }
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
            command: None,
            output: None,
            exit_code: None,
        }
    }

    fn msg_assistant_text(text: &str) -> Message {
        Message {
            role: "assistant".into(),
            content: vec![ContentBlock::Text { text: text.into() }],
            tool_call_id: None,
            tool_name: None,
            is_error: false,
            command: None,
            output: None,
            exit_code: None,
        }
    }

    fn msg_assistant_with_tool(name: &str, id: &str, input: Value) -> Message {
        Message {
            role: "assistant".into(),
            content: vec![
                ContentBlock::Text {
                    text: "looking...".into(),
                },
                ContentBlock::ToolCall {
                    id: id.into(),
                    name: name.into(),
                    input,
                },
            ],
            tool_call_id: None,
            tool_name: None,
            is_error: false,
            command: None,
            output: None,
            exit_code: None,
        }
    }

    fn msg_assistant_thinking(thinking: &str) -> Message {
        Message {
            role: "assistant".into(),
            content: vec![ContentBlock::Thinking {
                thinking: thinking.into(),
                redacted: false,
            }],
            tool_call_id: None,
            tool_name: None,
            is_error: false,
            command: None,
            output: None,
            exit_code: None,
        }
    }

    fn msg_tool_result(name: &str, text: &str) -> Message {
        Message {
            role: "tool_result".into(),
            content: vec![ContentBlock::Text { text: text.into() }],
            tool_call_id: None,
            tool_name: Some(name.into()),
            is_error: false,
            command: None,
            output: None,
            exit_code: None,
        }
    }

    fn msg_system(text: &str) -> Message {
        Message {
            role: "system".into(),
            content: vec![ContentBlock::Text { text: text.into() }],
            tool_call_id: None,
            tool_name: None,
            is_error: false,
            command: None,
            output: None,
            exit_code: None,
        }
    }

    fn boundary() -> Message {
        Message {
            role: "chain_boundary".into(),
            content: vec![],
            tool_call_id: None,
            tool_name: None,
            is_error: false,
            command: None,
            output: None,
            exit_code: None,
        }
    }

    // ==============
    // split_chains
    // ==============

    #[rstest]
    fn split_chains_empty() {
        assert!(split_chains(&[]).is_empty());
    }

    #[rstest]
    fn split_chains_no_boundaries_single_chain() {
        let msgs = vec![msg_user("hi"), msg_assistant_text("hello")];
        let chains = split_chains(&msgs);
        assert_eq!(chains.len(), 1);
        assert_eq!(chains[0].len(), 2);
    }

    #[rstest]
    fn split_chains_single_boundary_two_chains() {
        let msgs = vec![
            msg_user("first"),
            msg_assistant_text("response"),
            boundary(),
            msg_user("second"),
            msg_assistant_text("ok"),
        ];
        let chains = split_chains(&msgs);
        assert_eq!(chains.len(), 2);
        assert_eq!(chains[0].len(), 2);
        assert_eq!(chains[1].len(), 2);
    }

    #[rstest]
    fn split_chains_leading_boundary_ignored() {
        let msgs = vec![boundary(), msg_user("hi"), msg_assistant_text("hey")];
        let chains = split_chains(&msgs);
        assert_eq!(chains.len(), 1);
    }

    #[rstest]
    fn split_chains_trailing_boundary_ignored() {
        let msgs = vec![msg_user("hi"), msg_assistant_text("hey"), boundary()];
        let chains = split_chains(&msgs);
        assert_eq!(chains.len(), 1);
        assert_eq!(chains[0].len(), 2);
    }

    #[rstest]
    fn split_chains_consecutive_boundaries_no_empty_chain() {
        let msgs = vec![msg_user("a"), boundary(), boundary(), msg_user("b")];
        let chains = split_chains(&msgs);
        assert_eq!(chains.len(), 2);
    }

    // ===========
    // emit_full
    // ===========

    #[rstest]
    fn emit_full_empty() {
        assert_eq!(emit_full(&[], false), "");
    }

    #[rstest]
    fn emit_full_single_user_message() {
        let msgs = vec![msg_user("hello world")];
        let out = emit_full(&msgs, false);
        assert!(out.contains("[1]  user"));
        assert!(out.contains("     hello world"));
    }

    #[rstest]
    fn emit_full_user_assistant_tool_result_flow() {
        let msgs = vec![
            msg_user("fix the bug"),
            msg_assistant_with_tool(
                "Read",
                "toolu_01ABC123",
                json!({"file_path": "src/main.rs"}),
            ),
            msg_tool_result("Read", "fn main() {\n    println!(\"hello\");\n}"),
            msg_assistant_text("found the issue"),
            msg_assistant_with_tool(
                "Edit",
                "toolu_02XYZ789",
                json!({"file_path": "src/main.rs"}),
            ),
            msg_tool_result("Edit", "edit applied"),
        ];
        let out = emit_full(&msgs, false);

        // Line numbers present
        assert!(out.contains("[1]  user"));
        assert!(out.contains("[2]  assistant"));
        assert!(out.contains("[3]    tool_call"));
        assert!(out.contains("[4]  tool_result"));
        assert!(out.contains("[5]  assistant"));
        assert!(out.contains("[6]  assistant"));
        assert!(out.contains("[7]    tool_call"));
        assert!(out.contains("[8]  tool_result"));

        // Tool call summaries
        assert!(out.contains("Read(\"src/main.rs\")"));
        assert!(out.contains("Edit(\"src/main.rs\")"));

        // Separators between assistant->tool_result boundaries
        assert!(out.contains("────────────"));

        // Tool call IDs shortened
        assert!(out.contains("#ABC123"));
        assert!(out.contains("#XYZ789"));
    }

    #[rstest]
    fn emit_full_thinking_block() {
        let msgs = vec![msg_assistant_thinking("hmm, let me think...")];
        let out = emit_full(&msgs, false);
        assert!(out.contains("[thinking]"));
        assert!(out.contains("hmm, let me think..."));
    }

    #[rstest]
    fn emit_full_system_message() {
        let msgs = vec![msg_system("compaction happened")];
        let out = emit_full(&msgs, false);
        assert!(out.contains("[1]  system"));
        assert!(out.contains("     compaction happened"));
    }

    #[rstest]
    fn emit_full_multi_chain_with_boundaries() {
        let msgs = vec![
            msg_user("first question"),
            msg_assistant_text("first answer"),
            boundary(),
            msg_user("second question"),
            msg_assistant_text("second answer"),
        ];
        let out = emit_full(&msgs, false);

        // Chain headers present (2 chains)
        assert!(out.contains("══════════"));
        assert!(out.contains("Chain 1"));
        assert!(out.contains("Chain 2"));

        // Line numbers continue across chains
        assert!(out.contains("[3]  user")); // second chain starts at line 3
    }

    #[rstest]
    fn emit_full_no_chain_header_for_single_chain() {
        let msgs = vec![msg_user("hi"), msg_assistant_text("hey")];
        let out = emit_full(&msgs, false);
        assert!(!out.contains("Chain"));
    }

    // ================
    // tool_call_summary
    // ================

    #[rstest]
    #[case::read("Read", "file_path", "src/main.rs", "Read(\"src/main.rs\")")]
    #[case::edit("Edit", "file_path", "lib.rs", "Edit(\"lib.rs\")")]
    #[case::write("Write", "file_path", "out.txt", "Write(\"out.txt\")")]
    #[case::glob("Glob", "pattern", "**/*.rs", "Glob(\"**/*.rs\")")]
    #[case::grep("Grep", "pattern", "TODO", "Grep(\"TODO\")")]
    #[case::bash_with_command("Bash", "command", "cargo build", "Bash(\"cargo build\")")]
    #[case::bash_with_description(
        "Bash",
        "description",
        "build the project",
        "Bash(\"build the project\")"
    )]
    fn tool_call_summary_standard(
        #[case] name: &str,
        #[case] field: &str,
        #[case] value: &str,
        #[case] expected: &str,
    ) {
        let input = json!({ field: value });
        assert_eq!(tool_call_summary(name, &input), expected);
    }

    #[rstest]
    fn tool_call_summary_unknown_tool_no_arg() {
        assert_eq!(
            tool_call_summary("UnknownTool", &json!({"x": 1})),
            "UnknownTool"
        );
    }

    #[rstest]
    fn tool_call_summary_bash_long_command_truncated() {
        let long_cmd = "a".repeat(100);
        let input = json!({"command": long_cmd});
        let result = tool_call_summary("Bash", &input);
        assert!(result.starts_with("Bash(\""));
        assert!(result.ends_with("...\")"));
        assert!(result.len() <= 70); // Bash("…") + padding
    }

    #[rstest]
    fn tool_call_summary_bash_no_command() {
        assert_eq!(tool_call_summary("Bash", &json!({})), "Bash");
    }

    // ==========
    // short_id
    // ==========

    #[rstest]
    #[case::short("abc", "abc")]
    #[case::exact_6("abc123", "abc123")]
    #[case::long("toolu_01ABC123", "ABC123")]
    fn short_id_suffixes(#[case] input: &str, #[case] expected: &str) {
        assert_eq!(short_id(input), expected);
    }
}
