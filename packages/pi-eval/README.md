# pi-eval

A [pi](https://pi.dev) extension that adds an `eval` tool for executing
JavaScript and Python code in isolated subprocesses.

## Usage

Once installed, the LLM can call the `eval` tool to run code snippets without
managing temp files. Each call spawns a fresh subprocess — no state persists
between calls.

### Tool parameters

| Parameter  | Type   | Default     | Description |
| ---------- | ------ | ----------- | ----------- |
| `language` | string | _(required)_ | Programming language: `"javascript"` or `"python"` |
| `code`     | string | _(required)_ | Code to execute |
| `cwd`      | string | agent's cwd  | Working directory for the subprocess |

### Runtime configuration

Python binary and Node.js module paths are configured via JSON files, not per-call parameters:

- **Global**: `~/.pi/agent/pi-eval.json`
- **Project**: `.pi/pi-eval.json` (overrides global)

```json
{
  "pythonPath": ".venv/bin/python3",
  "nodeModulesPath": "./node_modules"
}
```

Relative paths in project configs are resolved relative to the project root.

### Features

- **JavaScript**: Writes code to a temp file, spawns `node` as a subprocess.
  Console output is captured as labeled `STDOUT:` / `STDERR:` sections.
  Set `nodeModulesPath` in config to make project packages available via `require()`.
- **Python**: Spawns `python3` with `-c`, capturing stdout/stderr identically.
  By default, searches `PATH` for `python3` (falling back to `/usr/bin/python3`,
  `/usr/local/bin/python3`). Set `pythonPath` in config to target a venv or custom binary.
- **Safety**: 30-second timeout, 1 MB output cap, Escape to cancel a running evaluation.
