# @mammothb/pi-memory

Gives the pi agent persistent memory across sessions.

## Tools

| Tool | Description |
|------|-------------|
| `retain` | Store a key-value pair in persistent memory (supports `scope`, `ttlSeconds`) |
| `recall` | Search, list, or filter persistent memory by keyword or namespace |
| `reflect` | Store a conversation observation with auto-generated or custom key |
| `memory_edit` | Rename or delete a memory entry |
| `compact_memory` | Find oversized entries for summarization to keep memory concise |

## Storage

Memory is stored in `~/.pi/agent/pi-memory/`:

| File | Purpose |
|------|---------|
| `<hash>/memory.json` | Per-project key-value store |
| `<hash>/memory-meta.json` | Per-project TTL expiry metadata |
| `global.json` | Cross-project key-value store (use `scope: "global"`) |
| `global-meta.json` | Cross-project TTL expiry metadata |
| `index.json` | Project registry tracking all known projects |

Each project gets its own isolated memory via a SHA-256 hash of `cwd`.

## Usage

```sh
cd packages/pi-memory
pi -e ./index.ts
```

Then in a pi session:

```
/retain key="build-command" value="pnpm run build"
/retain key="user:prefers-tabs" value="true" scope="global"
/retain key="temp:branch-name" value="feat/foo" ttlSeconds="86400"
/recall query="build"
/recall list="true"
/recall namespace="convention:"
/reflect observation="This project uses Biome for formatting"
/memory_edit action="rename" key="old-key" newKey="new-key"
/memory_edit action="delete" key="stale-entry"
/compact_memory
```
