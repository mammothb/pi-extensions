# @mammothb/pi-read

Smart `read` for pi — returns an AST structural outline for large files, and
delegates everything else to the built-in read.

## Behavior

| Input | Result |
| --- | --- |
| Small file (≤ threshold) | Built-in read (full content, exact output) |
| Large file, supported + enabled language | AST outline with line ranges |
| Large file, unsupported/disabled language | Built-in read (truncate + "continue" markers) |
| Image / binary | Built-in read (image attachment, MIME handling) |
| `offset`/`limit` drill-down | Built-in read (raw section) |
| Missing path / directory | Built-in read |

The override spreads `createReadToolDefinition` and only replaces `execute`, so
fallback paths are byte-identical to the built-in read — truncation signaling,
image attachments, prompt metadata, and TUI rendering all preserved.

## Optional dependencies

tree-sitter is fully optional and WASM-based (no native build):

- `web-tree-sitter` — the WASM runtime (`Parser.init()`, `Language.load()`).
- grammar packages — each ships a prebuilt `.wasm`
  (e.g. `tree-sitter-python/tree-sitter-python.wasm`).

When any is missing, large files fall through to the built-in read.

## Config

`.pi/pi-read.json` (project) over `~/.pi/agent/pi-read.json` (global):

```json
{
  "enabled": true,
  "thresholdLines": 2000,
  "thresholdBytes": 51200,
  "maxDepth": 10,
  "languages": {
    "typescript": true,
    "tsx": true,
    "javascript": true,
    "csharp": true,
    "python": true,
    "rust": true
  }
}
```

Set a language to `false` to disable outlining for it (falls back to built-in
read).

## Supported languages

| Language | Extensions | Symbols |
| --- | --- | --- |
| TypeScript / TSX | `.ts`, `.mts`, `.cts`, `.tsx` | class, function, method, interface, enum, type alias, arrow-fn const |
| JavaScript | `.js`, `.mjs`, `.cjs`, `.jsx` | class, function, method, interface, enum, type alias, arrow-fn const |
| C# | `.cs` | class, interface, method, constructor, struct, enum, namespace |
| Python | `.py` | class, function |
| Rust | `.rs` | function, struct, enum, trait, impl |

Symbols render as a terse outline with line ranges:

```
server.ts (typescript) — 2502 lines
├── class App (3 children) [1:7]
│   ├── method constructor [2:2]
│   └── method handleRequest [3:5]
└── function main [8:10]

Use read with offset/limit to view a specific section.
```
