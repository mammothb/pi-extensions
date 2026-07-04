# AGENTS

Monorepo of pi coding agent extensions, published under the `@mammothb/` scope.

See [CONTRIBUTING.md](./CONTRIBUTING.md) for development, testing, and release instructions.

## Extensions

| Package | Description |
| --- | --- |
| `@mammothb/pi-ask` | Interactive user prompting with a structured TUI form (1–4 questions) |
| `@mammothb/pi-eval` | Execute JavaScript and Python code in isolated subprocesses |
| `@mammothb/pi-ghsearch` | Typed GitHub search, fetch, and auth-status tools via the `gh` CLI |
| `@mammothb/pi-memory` | Persistent agent memory across sessions (`retain`, `recall`, `reflect`, etc.) |
| `@mammothb/pi-mermaid` | Skill that teaches the LLM to write Mermaid diagram syntax |
| `@mammothb/pi-permissions` | Permission enforcement — gates tool calls, bash commands (via arbiter executable), and file paths |
| `@mammothb/pi-shared` | Shared utilities for pi extensions (text extraction, config loading, error rendering) |
| `@mammothb/pi-stats` | Tracks tool, skill, and extension usage statistics per session |
| `@mammothb/pi-toast` | Desktop toast notifications on agent events (tmux-aware) |
| `@mammothb/pi-tokyonight-storm` | Tokyo Night Storm theme — colors corrected to match folke/tokyonight.nvim |
| `@mammothb/pi-webfetch` | Fetch and convert web content to markdown, text, or HTML |
| `@mammothb/pi-websearch` | Web search via SearXNG or Exa MCP |

### Crates (Rust)

| Crate | Description |
| --- | --- |
| `mm-cli` | Planning stage — see `crates/mm-cli/PLAN-*.md` |
