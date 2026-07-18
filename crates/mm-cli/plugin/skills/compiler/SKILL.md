---
name: compiler
description: "Compile and search Claude Code conversation logs with algorithmic summarisation and BM25-ranked recall."
---

## Workflow

### After /compact — recover context

A structured summary is automatically injected into context after every compaction (SessionStart hook). No manual step needed.

To refresh it manually:

```bash
mm compile --brief path/to/current-session.jsonl
```

### /mm:recall — search current session with ranking

```bash
mm search path/to/current-session.jsonl --query "keyword"
```

For regex patterns:

```bash
mm search path/to/current-session.jsonl --query "hook|inject"
```

### /mm:searchchat — search across sessions

```bash
cd ~/.claude/projects/<project> && mm search *.jsonl --query "keyword"
```

For broader search into subagents:

```bash
cd ~/.claude/projects/<project> && mm search **/*.jsonl --query "keyword"
```

### /mm:readchat — read a specific session

```bash
mm compile path/to/session.jsonl
```

For a quick overview instead of full transcript:

```bash
mm compile --brief path/to/session.jsonl
```

## Commands

| Command | Description |
| --- | --- |
| `mm compile <paths>` | Full transcript with line numbers |
| `mm compile --brief <paths>` | Structured summary — goals, files, commits, preferences + brief transcript |
| `mm compile --keep N <paths>` | Summary + last N user turns kept verbatim |
| `mm search <paths> --query "..."` | BM25-ranked search with line snippets |
| `mm search <paths> --query "." --page N` | Paginate all results |
| `mm search <paths> --query "..." --json` | JSON output with scores and match counts |

## Rules

- Forward slashes only in bash commands — even on Windows.
- Do NOT use `grep` on JSONL files. Always use `mm search`.
- After `/compact`, a structured summary is automatically injected into context (SessionStart hook). Run `mm compile --brief` manually only to refresh it.
- For regex patterns, use standard syntax: `hook|inject`, `fail.*build`, `auth.*token`.
