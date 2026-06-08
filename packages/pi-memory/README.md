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

## Architecture

Tools are thin adapters over a swappable `MemoryBackend` interface:

```
retain/recall/reflect/etc  ──>  MemoryBackend (interface)  ──>  FileSystemBackend (default)
```

The backend owns storage, search, TTL expiry, and project/global merging. Tools only handle parameter validation, display formatting, and rendering.

### MemoryBackend interface

Defined in [`src/lib/backend.ts`](./src/lib/backend.ts). Six semantic methods:

| Method | Purpose |
|--------|---------|
| `remember(params)` | Store a memory entry (project or global, optional TTL) |
| `recall({ cwd, options })` | Search/list memories merged from both scopes, TTL-filtered, scored |
| `forget({ scope, cwd, key })` | Delete an entry (no-op if missing) |
| `rename({ scope, cwd, oldKey, newKey })` | Rename an entry, preserving value and TTL |
| `getIndex()` | Return the project registry |
| `upsertIndex(cwd, entry)` | Record a project access |

All methods return `Promise<>` so backends can be backed by external processes (IPC, HTTP), databases, or the local filesystem.

### FileSystemBackend (default)

Implements `MemoryBackend` using JSON files under `~/.pi/agent/pi-memory/`. Constructor takes a required `baseDir`:

```typescript
import { FileSystemBackend } from "@mammothb/pi-memory/src/lib/backends/filesystem.js";

const backend = new FileSystemBackend({
  baseDir: "/custom/storage/path",
});
```

### Custom backends

Implement the `MemoryBackend` interface and swap it in your extension entry point:

```typescript
import type { MemoryBackend } from "@mammothb/pi-memory/src/lib/backend.js";

class MyBackend implements MemoryBackend {
  async remember(params) { /* custom storage */ }
  async recall({ cwd, options }) { /* custom search + merge */ return []; }
  async forget({ scope, cwd, key }) {}
  async rename({ scope, cwd, oldKey, newKey }) {}
  async getIndex() { return {}; }
  async upsertIndex(cwd, entry) {}
}

export default function (pi: ExtensionAPI) {
  const backend = new MyBackend();
  pi.registerTool(createRetainTool(backend));
  // ... register other tools the same way
}
```

Examples of possible backends:
- **External process** — spawn a Go/Rust binary, send JSON over stdin/stdout or HTTP. The binary handles storage, search, and TTL natively.
- **SQLite** — single-file database with full-text search.
- **In-memory** — `Map`-based, for fast unit tests without filesystem I/O.

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
