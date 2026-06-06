# pi-toast

A [pi](https://pi.dev) extension that sends desktop toast notifications when
the agent finishes a turn.

## Usage

Once installed and configured, pi-toast fires a notification on the
`agent_end` event. The notification includes:

- **Title** — `Agent finished` with a session label. When running inside tmux,
  the label includes the tmux session name (e.g. `Agent finished (mysession)`).
  Outside tmux, the label is `(shell)`.
- **Message** — A 200-character preview of the last assistant message.

## Configuration

Configuration is loaded from two JSON files (project overrides global, global
overrides defaults):

| Location | Purpose |
| -------- | ------- |
| `~/.pi/agent/pi-toast.json` | Global config (applies to all projects) |
| `<project>/.pi/pi-toast.json` | Project-level config (overrides global) |

### Options

```jsonc
{
  // Path to a notification executable. The executable must accept two
  // positional arguments: <title> <message>.
  // When unset, notifications are disabled.
  "path": "/usr/bin/notify-send"
}
```

The only key is `path`. If omitted, the extension logs a warning and does
nothing.

### Example: notify-send (Linux)

```jsonc
{ "path": "/usr/bin/notify-send" }
```

### Example: terminal-notifier (macOS)

```jsonc
{ "path": "/usr/local/bin/terminal-notifier" }
```

Any executable that accepts `<title> <message>` as positional arguments will
work.

## Development

```bash
# Run tests from the workspace root
cd ../.. && pnpm run test

# Test locally with pi (from this package directory)
pi -e ./index.ts
```
