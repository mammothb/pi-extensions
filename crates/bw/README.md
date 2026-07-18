# bw — bwrap sandbox for pi

Config-driven [bubblewrap](https://github.com/containers/bubblewrap) sandbox. Runs pi (or any command) inside a Linux namespace with the workspace mounted read-write, system directories read-only, and everything else invisible.

## Install

```bash
cargo install bw-helper   # installs binary as `bw`
```

## Quick start

```bash
bw pi                     # run pi inside the sandbox
bw -- bash                # open a sandboxed shell
bw --validate             # check config is valid
bw --print-args -- pi     # see the bwrap command that would run
```

## Config

Three layers, merged top-to-bottom:

| Layer | Path | Purpose |
|---|---|---|
| Default | compiled into binary | Core system binds (ro: `/bin`, `/usr`; rw: `~/.cache`, `~/.npm`) |
| Global | `~/.config/bw/config.json` | Machine-wide overrides |
| Workspace | `.pi/bw.json` | Project-specific binds |

### Bind keys

Two top-level keys control bind mounts:

| Key | Behavior |
|---|---|
| `binds` | **Full replace.** Discards all lower-layer binds. Start from scratch. |
| `binds_extra` | **Merge.** Appends to binds accumulated from lower layers. |

Use `binds_extra` for the common case (add a path). Use `binds` when you need to start over.

### Subkeys

Within `binds` and `binds_extra`:

| Key | Merge rule |
|---|---|
| `ro` | Arrays concatenate |
| `ro_try` | Arrays concatenate |
| `rw` | Arrays concatenate |
| `docker` | Scalar replaces (`null` disables) |
| `wsl2` | Shallow merge |

`options` always shallow-merges. `env` merges key-by-key.

### Examples

**Add a read-only path for one project** (`.pi/bw.json`):

```json
{
  "binds_extra": {
    "ro": ["~/other-project/docs"]
  }
}
```

**Add a read-write scratch directory** (`.pi/bw.json`):

```json
{
  "binds_extra": {
    "rw": ["./output"]
  }
}
```

**Disable docker socket** (`~/.config/bw/config.json`):

```json
{
  "binds": {
    "docker": null
  }
}
```

**Replace all binds** (start from scratch):

```json
{
  "binds": {
    "ro": ["/bin", "/usr"],
    "rw": ["~/.cache"]
  }
}
```

**Set custom env vars** (`.pi/bw.json`):

```json
{
  "options": {
    "env": {
      "GITHUB_TOKEN": "$GITHUB_TOKEN",
      "DEBUG": "1"
    }
  }
}
```

`$VAR` references are resolved from the host environment.

**Network isolation** (`~/.config/bw/config.json`):

```json
{
  "options": {
    "unshare_net": true
  }
}
```

### Merge walkthrough

Given default config, plus this global config:

```json
{
  "binds_extra": {
    "ro": ["/extra"],
    "rw": ["/scratch"]
  }
}
```

And this workspace config:

```json
{
  "binds_extra": {
    "ro": ["~/project-docs"]
  }
}
```

Result: default ro paths + `/extra` + `~/project-docs`. Default rw paths + `/scratch`. Everything else (docker, wsl2, options) from defaults unless overridden.

If the workspace used `binds` instead of `binds_extra`, the result would have ONLY the workspace's ro paths — defaults and global would be discarded entirely.

## Paths

- `~/foo` — expands to `$HOME/foo`
- `./foo` — resolves relative to workspace root
- `/foo` — absolute, passed through

## WSL2

Detected automatically. Adds `/init`, `/run/WSL` (ro) and `/mnt/c`, `/mnt/wsl` (ro_try). Copies `WSL_INTEROP`, `WSL_DISTRO_NAME`, `WSLENV` from host env. Override by setting `binds.wsl2` explicitly.

## CLI

```
bw [--config <path>] [--validate | --print-args] [--] <command...>
```

If no command is given, launches `$SHELL`.
