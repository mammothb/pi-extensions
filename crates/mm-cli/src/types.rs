use serde_json::Value;

#[derive(Debug)]
pub struct Message {
    /// "user" | "assistant" | "tool_result" | "system"
    pub role: String,
    pub content: Vec<ContentBlock>,
    /// Toll result metadata. Populated fro top-level fields on pi-format
    /// `toolResult` messages (`toolCallId`, `toolName`, `isError`).
    /// Also populated from Claude-format embedded `tool_result` blocks
    /// (`tool_use_id`, name derived from prior `tool_use`).
    pub tool_call_id: Option<String>,
    pub tool_name: Option<String>,
    pub is_error: bool,
    /// Runtime bash execution fields (pi-format `bashExecution` role).
    pub command: Option<String>,
    pub output: Option<String>,
    pub exit_code: Option<i32>,
}

impl Message {
    pub fn is_user(&self) -> bool {
        self.role == "user"
    }
    pub fn is_assistant(&self) -> bool {
        self.role == "assistant"
    }
    pub fn is_tool_result(&self) -> bool {
        self.role == "tool_result"
    }
    pub fn is_system(&self) -> bool {
        self.role == "system"
    }
    pub fn is_chain_boundary(&self) -> bool {
        self.role == "chain_boundary"
    }
}

#[derive(Debug)]
pub enum ContentBlock {
    Text {
        text: String,
    },
    ToolCall {
        id: String,
        name: String,
        input: Value,
    },
    ToolResult {
        tool_use_id: String,
        name: String,
        content: String,
        is_error: bool,
    },
    Thinking {
        thinking: String,
        redacted: bool,
    },
}

/// The lowest-level IR. All downstream processing (filter, brief, sections)
/// operates on this type exclusively.
#[derive(Debug)]
pub enum NormalizedBlock {
    User {
        text: String,
        /// Index into the original `Vec<Message>`, for line-reference
        /// annotations in brief output.
        source_index: usize,
    },
    /// An assistant message text block.
    Assistant { text: String, source_index: usize },
    /// A tool call from an assistant message.
    ToolCall {
        name: String,
        args: Value,
        source_index: usize,
    },
    /// A tool result (from Pi top-level toolResult message, or Claude embedded
    /// tool_result block).
    ToolResult {
        name: String,
        text: String,
        source_index: usize,
    },
    /// A bash execution (runtime-only, Pi mode).
    Bash {
        command: String,
        output: String,
        exit_code: Option<i32>,
        source_index: usize,
    },
}
