---
"@mammothb/pi-subagents": major
---

Refactor to interactive research mode only.

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
