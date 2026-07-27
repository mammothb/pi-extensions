# @mammothb/pi-subagents

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
