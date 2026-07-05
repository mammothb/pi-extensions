# @mammothb/pi-memory

VCC conversation compaction for Pi, backed by mm-cli. Replaces Pi core's
default LLM-based compaction with structured summaries produced by the `mm`
binary.

## Commands

| Command | Description |
|---------|-------------|
| `/mm-compact` | Compact conversation with mm-cli structured summary. Accepts `keep:N` and a follow-up prompt. |
| `/mm-recall` | Search session history. Defaults to active lineage; add `scope:all` for off-lineage branches. |

## Tools

| Tool | Description |
|------|-------------|
| `mm_recall` | Search session history programmatically. Supports regex queries, paging, and expand indices. |

## Architecture

The extension is a thin TypeScript shim over the `mm-cli` Rust binary:

```
/mm-compact  ──>  before-compact hook  ──>  compile()  ──>  mm pi (subprocess)
/mm-recall   ──>  recall pipeline     ──>  session JSONL parsing + BM25 search
mm_recall    ──>  recall pipeline     ──>  (same pipeline as /mm-recall)
```

All heavy computation (message normalization, noise filtering, section
extraction, brief compilation, merge with previous summary) is handled by
mm-cli. The shim only wraps the subprocess call and handles session file
reading/searching.

## Settings

Configured via `~/.pi/agent/pi-memory.json`:

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `overrideDefaultCompaction` | boolean | `false` | When true, mm-compact handles ALL compactions (`/compact`, auto threshold, overflow). When false, only `/mm-compact`. |
| `debug` | boolean | `false` | Write debug snapshot to `/tmp/mm-compact-debug.json` on each compaction. |

## Usage

```sh
cd packages/pi-memory
pi -e ./index.ts
```

Then in a pi session:

```
/mm-compact                        # basic compaction
/mm-compact keep:3                 # keep last 3 user turns
/mm-compact keep:2 continue        # keep 2 turns + send follow-up prompt
/mm-recall                         # show recent history
/mm-recall "refactor|rewrite"      # regex search
/mm-recall login scope:all         # search all branches
```
