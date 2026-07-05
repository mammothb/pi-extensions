# @mammothb/pi-trigger

## 1.0.0

- Initial release: mid-text `/skill:name` and `/prompt:name` trigger expansion
- `input` event interception covers both leading-case and mid-text triggers
- Filesystem discovery of skills and prompt templates from standard Pi locations
- Package-root discovery for prompts in installed extensions (npm:, git:)
- TUI rendering via `SkillInvocationMessageComponent` for collapsible trigger rows
