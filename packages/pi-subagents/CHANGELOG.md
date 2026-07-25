# @mammothb/pi-subagents

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
