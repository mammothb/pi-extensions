---
"@mammothb/pi-memory": patch
"@mammothb/pi-subagents": minor
---

TUI: render individual tool calls in expanded subagent results. Child process messages are now preserved in SubagentResult.messages and formatted as styled tool call lines (read/edit/write/bash/eval/gh_search/gh_fetch/WebFetch/WebSearch + fallback for unknown tools) between the header and output body.
