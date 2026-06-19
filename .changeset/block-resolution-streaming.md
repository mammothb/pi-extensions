---
"@mammothb/pi-hashline": minor
---

Block-aware editing with treesitter resolution, streaming-tolerant parser, mismatch handling, and render integration.

- **Block resolution**: Core block resolver extracts code blocks from edit hunks for targeted application. Treesitter block resolver uses tree-sitter grammars (JavaScript, TypeScript, Python, YAML) to identify syntactic boundaries and scope blocks precisely.
- **Mismatch handling**: Detects, reports, and applies partial patches when hunks don't match exactly. Supports structured mismatch reporting with anchor-content replay for stale-edit recovery.
- **Streaming-tolerant parser**: Handles partial/incomplete hashline input from streaming LLM output without breaking.
- **Header parser & multi-file hints**: Parses `¶PATH#TAG` headers to extract file metadata; multi-file hints surface affected files during tool calls.
- **Diff generator**: Generates unified diffs for patch sections, enabling visual review of changes.
- **Strict edit mode**: Enforces exact anchor matching before applying edits.
- **Prefixes system**: Portable prefix definitions for consistent hashline grammar across tools.
- **Render integration**: Wires hashline tool calls/results into pi's TUI render pipeline for inline result display.
