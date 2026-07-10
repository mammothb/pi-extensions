# AGENTS

Monorepo of pi coding agent extensions, published under the `@mammothb/` scope.

See [CONTRIBUTING.md](./CONTRIBUTING.md) for development, testing, and release instructions.

## Extensions

| Package | Description |
| --- | --- |
| `@mammothb/pi-ask` | Interactive user prompting with a structured TUI form (1–4 questions) |
| `@mammothb/pi-eval` | Execute JavaScript and Python code in isolated subprocesses |
| `@mammothb/pi-ghsearch` | Typed GitHub search, fetch, and auth-status tools via the `gh` CLI |
| `@mammothb/pi-memory` | VCC conversation compaction backed by mm-cli (`/mm-compact`, `/mm-recall`, `mm_recall`) |
| `@mammothb/pi-mermaid` | Skill that teaches the LLM to write Mermaid diagram syntax |
| `@mammothb/pi-permissions` | Permission enforcement — gates tool calls, bash commands (via arbiter executable), and file paths |
| `@mammothb/pi-shared` | Shared utilities for pi extensions (text extraction, config loading, error rendering) |
| `@mammothb/pi-stats` | Tracks tool, skill, and extension usage statistics per session |
| `@mammothb/pi-toast` | Desktop toast notifications on agent events (tmux-aware) |
| `@mammothb/pi-tokyonight-storm` | Tokyo Night Storm theme — colors corrected to match folke/tokyonight.nvim |
| `@mammothb/pi-web` | Fetch and search the web — `WebFetch` + `WebSearch` tools |

### Crates (Rust)

| Crate | Description |
| --- | --- |
| `mm-cli` | Planning stage — see `crates/mm-cli/PLAN-*.md` |
