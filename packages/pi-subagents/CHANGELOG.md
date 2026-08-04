# @mammothb/pi-subagents

## 1.1.0

### Minor Changes

- 0acecd7: Add socket IPC push delivery for research reports via the `aipcd` daemon. Report submissions now route through a Unix domain socket (`research-ipc.sock`) when the daemon is reachable, falling back to file-based IPC transparently.

### Patch Changes

- 0acecd7: Harden socket IPC frame decoding against invalid and non-object payloads, guard error/close teardown against stale sockets, resolve fallback rejections cleanly, and improve test coverage.

## 1.0.0

### Major Changes

- 6b6e960: Refactor to interactive research mode only.

  **Removed** the autonomous subagent workflow:

  - `subagent` and `subagent_resume` tools
  - agent `.md` discovery with YAML frontmatter config
  - sandbox, concurrency, rendering, and resume machinery

  **Interactive research is now the only mode:**

  - `/rsh` — fork the current session into an interactive tmux pane
  - `/rsh-report` — send research findings back to the parent session
  - `/rsh-close` — tear down a research session (pane, session file, launch script, state)
  - Auto-cleanup when the research child exits, plus a stale-session sweep on startup for sessions that died uncleanly (crash/SIGKILL)
  - Launch scripts kept under `~/.pi/agent/research-scripts/` with stderr logging for troubleshooting

  **New config file** `pi-subagents.json` (global `~/.pi/agent/` or project `.pi/`):

  - `focusOnStart: boolean` — jump into the research pane after `/rsh` (default `true`)

## 0.5.0

### Minor Changes

- 6f19e00: Fix pi-subagents to load subagent prompt. Update pi-subagents config path.

## 0.4.0

### Minor Changes

- 91a99a5: TUI: render individual tool calls in expanded subagent results. Child process messages are now preserved in SubagentResult.messages and formatted as styled tool call lines (read/edit/write/bash/eval/gh_search/gh_fetch/WebFetch/WebSearch + fallback for unknown tools) between the header and output body.

## 0.3.0

### Minor Changes

- 7cfb525: pi-ghsearch: safer type coercion in search result and fetch-type-detector formatting (objects now return fallback instead of "[object Object]")
  pi-memory: thread scopePrefix through recall pipeline
  pi-office: fix truncated preview message to show actual maxChars instead of hardcoded "2000"
  pi-subagents: sandbox isolation via bubblewrap, fork sessions with parent context inheritance, subagent_resume tool, launch refactor with injected LaunchChildFn, cwd validation extraction

## 0.2.1

### Patch Changes

- b913f85: Refactor rendering, error handling, and parsing internals across packages. Fixes include: trigger `${N:-default}` expansion with empty values, eval signal line parsing, document merged-cell handling, and GitHub URL shortening.
- Updated dependencies [b913f85]
  - @mammothb/pi-shared@1.4.1

## 0.2.0

### Minor Changes

- cb7ad8d: Initial release: delegate tasks to specialized subagents with isolated context.

  - Agent discovery from `~/.pi/agent/agents/*.md` and `.pi/agents/*.md` with YAML frontmatter
  - Single-mode subagent launch via `pi -p --mode json` child processes
  - Stuck detection with configurable timeout and one-shot warning latch
  - Abort handling with SIGTERM/SIGKILL escalation and cleanup
  - Model tier aliases via `~/.pi/agent/subagents.json` (`cheap`/`expensive` → provider/model)
  - Bubblewrap sandbox integration point (`sandbox: true` in agent frontmatter, tool not wired yet)
  - Fork session mode scaffolding (`mode: fork` in agent frontmatter, not wired yet)
  - `subagent_resume` tool deferred to next release
