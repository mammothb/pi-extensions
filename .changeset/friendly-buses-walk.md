---
"@mammothb/pi-subagents": minor
---

Initial release: delegate tasks to specialized subagents with isolated context.

- Agent discovery from `~/.pi/agent/agents/*.md` and `.pi/agents/*.md` with YAML frontmatter
- Single-mode subagent launch via `pi -p --mode json` child processes
- Stuck detection with configurable timeout and one-shot warning latch
- Abort handling with SIGTERM/SIGKILL escalation and cleanup
- Model tier aliases via `~/.pi/agent/subagents.json` (`cheap`/`expensive` → provider/model)
- Bubblewrap sandbox integration point (`sandbox: true` in agent frontmatter, tool not wired yet)
- Fork session mode scaffolding (`mode: fork` in agent frontmatter, not wired yet)
- `subagent_resume` tool deferred to next release
