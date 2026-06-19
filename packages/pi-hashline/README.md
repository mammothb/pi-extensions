# pi-hashline

Hashline anchoring for pi — content-addressed read/edit with stale-edit
protection.

## Tools

| Tool | Description |
|---|---|
| `read` | Read files with `\u00b6PATH#TAG` headers. Copy the header to use with `edit`. |
| `edit` | Edit files using hashline anchoring. Validates tags before writes — stale tags are rejected. |
| `write` | Create or overwrite files. Returns a `\u00b6PATH#TAG` header for immediate editing. |
| `grep` | Search with ripgrep. Matching files get `\u00b6PATH#TAG` headers. |

## Usage

```sh
pi -e ./index.ts
```

## Grammar

The hashline grammar is documented in [src/prompt.md](src/prompt.md) —
this is the same reference injected into the LLM's system prompt.  Key
operations:

- `replace N..M:` — replace lines N through M with body rows
- `delete N..M` — delete lines N through M
- `insert before|after N:` — insert body rows relative to line N
- `insert head:|tail:` — insert at file boundaries

Body rows use `+TEXT` syntax.  There are no `-` rows.

## Recovery

Stale-tag edits (file changed between read and edit) are automatically
recovered via two strategies:

1. **Structured-patch 3-way merge** — apply edits to the cached snapshot,
   create a structured patch, apply to live content.
2. **Anchor-content replay** — when anchors still match, apply edits
   directly to the live file.

## Peer Dependencies

- `@earendil-works/pi-coding-agent`
- `@earendil-works/pi-ai`
- `@earendil-works/pi-tui`
- `typebox`
