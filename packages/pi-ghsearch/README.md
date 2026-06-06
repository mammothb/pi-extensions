# pi-ghsearch

A [pi](https://pi.dev) extension that wraps the `gh` CLI with three tools for searching GitHub:

- **`gh_search`** — Search repos, issues, PRs, code, and commits via `gh search` with typed parameters, JSON defaults, and automatic output truncation.
- **`gh_fetch`** — Fetch full content of a GitHub resource (file, issue, PR, discussion, etc.) via `gh api`. Converts web URLs to REST endpoints automatically.
- **`gh_auth_status`** — Check GitHub CLI authentication status. Use to diagnose failed `gh_search`/`gh_fetch` calls.

The extension also checks auth status on session start and can optionally block raw `gh search`/`gh api`/`gh auth` bash commands to ensure the typed tools are used instead.

## Configuration

Configuration is loaded from two JSON files (project overrides global, global overrides defaults):

| Location | Purpose |
|---|---|
| `~/.pi/agent/pi-ghsearch.json` | Global config (applies to all projects) |
| `<project>/.pi/pi-ghsearch.json` | Project-level config (overrides global) |

### Options

```jsonc
{
  // Restrict ALL searches to repos within a GitHub organization.
  // gh_search automatically adds --owner <org> to every command.
  // gh_fetch and gh_auth_status are NOT affected.
  "organization": "my-org",

  // Block model-initiated bash executions of `gh search`, `gh api`,
  // and `gh auth`, redirecting to the typed tools instead.
  // Other gh commands (gh repo clone, gh issue create, etc.) are unaffected.
  "banBashGh": true,

  // Default timeout for gh CLI commands in milliseconds (default: 30000).
  "timeoutMs": 60000,

  // Default values applied when the LLM doesn't supply them explicitly.
  "defaults": {
    "limit": 50   // max results per search (default: 30)
  }
}
```

All keys are optional — missing keys fall back to built-in defaults.

## Development

```bash
# Run unit tests (no network required)
npm test

# Run eval/smoke tests (requires gh CLI + network)
# These are excluded from `npm test` by default.
# To run them, temporarily add "evals/**/*.test.ts" to vitest.config.ts include.

# Test locally with pi
pi -e ./index.ts
```
