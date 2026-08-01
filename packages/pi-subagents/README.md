# pi-subagents

Interactive research mode for [pi](https://pi.dev): fork the current session
into a tmux pane running a fresh pi, steer the research directly, and send
findings back to the parent session.

## Commands

| Command | Description |
| --- | --- |
| `/rsh <task>` | Fork the current session into an interactive tmux pane |
| `/rsh-report` | (in the child pane) send research findings back to the parent |
| `/rsh-close [id]` | Tear down a research session; omit id to list active sessions |

### `/rsh`

Forks the current session — parent transcript plus a boundary marker — into
a fresh pi session spawned in a new tmux pane. The child is an interactive
pi: you steer it directly, redirect it, iterate, then report back.

The child is launched from an executable script kept at
`~/.pi/agent/research-scripts/<session-id>.sh`, with stderr logged to
`<session-id>.log`, so the exact invocation survives for debugging.

### `/rsh-report`

Run inside the research pane. The child's last assistant message is written
to a report file and delivered to the parent before the parent's next agent
turn, appearing as a `research_complete` message.

### `/rsh-close`

Cleans up a session by id: the tmux pane, the forked session file, the
launch script and log, and the session state. Without an id it lists active
research sessions.

## Lifecycle

Research sessions clean up after themselves:

- When the child pi exits — gracefully or because the pane died — it removes
  its own pane, session file, launch script, and state.
- Every pi process sweeps `research-sessions/` on startup and cleans sessions
  whose pane or child process is gone (covers crashes and SIGKILL).
- `/rsh-close` remains for manual cleanup.

## Configuration

`pi-subagents.json`, read from `~/.pi/agent/` (global) and `.pi/` (project;
project overrides global):

| Key | Type | Default | Description |
| --- | --- | --- | --- |
| `focusOnStart` | boolean | `true` | Jump into the research pane after `/rsh` |

## Requirements

- **tmux** — the research child runs in a tmux pane
- **pi** — the forked child runs pi interactively

## Development

```bash
# Run unit tests from the workspace root
cd ../.. && pnpm run test

# Test with coverage
pnpm run test:coverage
```
