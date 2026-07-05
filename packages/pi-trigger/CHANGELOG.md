# @mammothb/pi-trigger

## 1.1.0

### Minor Changes

- b1df743: Add `#skill:name` and `#prompt:name` mid-text autocomplete via
  `AutocompleteProviderFactory`. Switch trigger prefix from `/` to `#`
  so autocomplete fires on any line, not just line 0 (editor restricts
  `/`-triggered autocomplete to the first line only).

  Also replace local `homePath` with `expandTilde` from `@mammothb/pi-shared`,
  and use `getAgentDir()` instead of hardcoded `~/.pi/agent` paths.

## 1.0.0

- Initial release: mid-text `/skill:name` and `/prompt:name` trigger expansion
- `input` event interception covers both leading-case and mid-text triggers
- Filesystem discovery of skills and prompt templates from standard Pi locations
- Package-root discovery for prompts in installed extensions (npm:, git:)
- TUI rendering via `SkillInvocationMessageComponent` for collapsible trigger rows
