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
fallback paths are byte-identical to the native read — truncation signaling,
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

## Status

Skeleton: delegation, config, language gating, and outline rendering are
complete. Remaining work is the WASM loader (Phase 1) and the tree-sitter
symbol walk (Phase 2).
