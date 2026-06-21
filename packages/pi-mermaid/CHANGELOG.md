# @mammothb/pi-mermaid

## 0.1.1

### Patch Changes

- 9d54440: strict semantic for pi-hashline, per line hashing, atomic io.

## 0.1.0

### Minor Changes

- 14317aa: **pi-mermaid**: Removed extension code (TUI rendering, `/pi-mermaid` command, auto-render hooks). Package is now skills-only — provides the mermaid diagram skill with reference docs and validation scripts.

  **pi-memory, pi-ask, pi-ghsearch, pi-websearch**: Fixed `promptGuidelines` to self-identify their tool name in every bullet. The docs require this because all guidelines from all tools are concatenated flat into one "Guidelines:" section with no grouping. Also trimmed multi-sentence `promptSnippet` values (gh_search, gh_fetch, gh_auth_status, AskUserQuestion) to short one-liners matching the built-in tool standard.

## 0.0.1

- Initial release: Mermaid ASCII rendering extension + skill
