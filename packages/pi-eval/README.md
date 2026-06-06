# pi-eval

A [pi](https://pi.dev) extension that adds an `eval` tool for executing
JavaScript and Python code in isolated subprocesses.

## Usage

Once installed, the LLM can call the `eval` tool to run code snippets without
managing temp files. Each call spawns a fresh subprocess — no state persists
between calls.

### Tool parameters

| Parameter          | Type   | Default    | Description |
| ------------------ | ------ | ---------- | ----------- |
| `language`         | string | _(required)_ | Programming language: `"javascript"` or `"python"` |
| `code`             | string | _(required)_ | Code to execute |
| `nodeModulesPath`  | string | —          | Path to node_modules for `require()` resolution |
| `pythonPath`       | string | —          | Path to python3 binary (e.g., `.venv/bin/python3`) |

### Features

- **JavaScript**: Writes code to a temp file, spawns `node` as a subprocess.
  Console output is captured as labeled `STDOUT:` / `STDERR:` sections.
- **Python**: Coming in a future release.
- **Safety**: 30-second timeout, 1 MB output cap, abort-on-Escape support.
- **Dependency isolation**: Use `nodeModulesPath` to resolve packages from a
  project's `node_modules/`. Use `pythonPath` to target a venv.
