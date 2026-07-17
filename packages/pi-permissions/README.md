# pi-permissions

A [pi](https://pi.dev) extension providing:

- **Permission enforcement** — gates tool calls, bash commands (via arbiter executable), and file paths
- **`bw` CLI** — config-driven [bubblewrap](https://github.com/containers/bubblewrap) sandbox for pi

## bw — bwrap sandbox

`bw` is a Node.js CLI that wraps pi in a Linux namespace sandbox via `bwrap`. The current workspace is mounted read-write; system directories read-only; cache/state directories read-write.

### Quick start

```bash
pi install npm:@mammothb/pi-permissions
cp ~/.pi/agent/npm/node_modules/@mammothb/pi-permissions/bw-wrapper.sh ~/.local/bin/bw
chmod +x ~/.local/bin/bw
bw pi
```

### Config

Three layers, merged: **default** → **global** → **workspace**.

| Layer | Path | Purpose |
|---|---|---|
| Default | compiled into package | Core system binds |
| Global | `~/.config/bw/config.json` | Machine-wide overrides |
| Workspace | `.pi/bw.json` | Project-specific binds |

Two top-level bind keys with different merge behavior:

| Key | Behavior |
|---|---|
| `binds` | **Full replace.** Discards all lower-layer bind config. |
| `binds_extra` | **Merge.** Appends to accumulated binds from lower layers. |

Sub-key merge within `binds_extra`:
- `ro`, `roTry`, `rw` — arrays concatenate
- `docker` — scalar replaces (`null` disables)
- `wsl2` — shallow merge

```jsonc
// .pi/bw.json
{
  "binds_extra": {
    "ro": ["~/other-project/docs", "/some/data/dir"],
    "rw": ["./output"]
  },
  "options": {
    "env": { "GITHUB_TOKEN": "$GITHUB_TOKEN" },
    "path": ["~/.cargo/bin"],
    "tmpfsSize": "1G"
  }
}
```

### Options

| Key | Default | Description |
|---|---|---|
| `options.clearenv` | `true` | Start with blank environment. |
| `options.env` | `{}` | Extra env vars. `$VAR` references resolved from host env. |
| `options.path` | `[]` | Directories prepended to `PATH` before standard system dirs. |
| `options.tmpfsSize` | `"512M"` | `/tmp` size limit (documented intent; kernel default applies). |
| `options.unshareNet` | `false` | Network isolation. Leave `false` — pi needs LLM API and websearch. |
| `options.seccomp` | none | Path to seccomp BPF filter file. Optional. |

### WSL2

Detected automatically at runtime. Adds `/init`, `/run/WSL` binds and `WSL_INTEROP`, `WSL_DISTRO_NAME`, `WSLENV` env vars. Override by setting `binds.wsl2` explicitly.

### CLI

```
bw [--config <path>] [--] <command...>
bw --help
bw --version
```

If no command is given, launches `$SHELL` (or `/bin/bash`).

### Error messages

```
bw: path not found: /home/mmb/missing-dir (in .pi/bw.json, binds.ro[2])
```

## Permissions

The extension gates pi's tool calls, bash commands, and file paths. See [.pi/pi-permissions.json] for project-level rules and `~/.pi/agent/pi-permissions.json` for global rules.

### Config

| Location | Purpose |
|---|---|
| `~/.pi/agent/pi-permissions.json` | Global rules |
| `<project>/.pi/pi-permissions.json` | Project-level rules |

```jsonc
{
  "defaults": {
    "tools": "ask",   // allow | deny | ask
    "bash": "ask",
    "paths": "ask"
  },
  "tools": {
    "read": "allow",
    "write": "deny"
  },
  "paths": {
    "~/.ssh/**": "deny",
    "~/.config/**": "ask"
  },
  "bash": {
    "arbiter": "./.pi/bash-arbiter.sh"
  }
}
```

### Bash arbiter

When configured, bash commands are passed to an external arbiter executable. The arbiter receives the command on stdin and returns JSON with `{ allow: true }` or `{ allow: false, reason: "..." }` on stdout. This provides out-of-process enforcement — harder for an LLM to bypass than in-process guards.
