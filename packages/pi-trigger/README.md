# @mammothb/pi-trigger

Mid-text trigger expansion for Pi skills and prompt templates.

Pi core requires `/skill:name` and `/prompt:name` tokens at the start of input.
Any prefix — e.g., `@docs/PROPOSAL.md /prompt:plan` — disables expansion.
pi-trigger scans the full message for namespace-prefixed tokens anywhere in the
text, expands them, and cleans the user prompt.

Supports:
- `/skill:name` — loads and inlines SKILL.md content
- `/prompt:name` — expands prompt templates with argument substitution

## Install

```
pi install npm:@mammothb/pi-trigger
```

## Usage

```
@docs/PROPOSAL.md /prompt:plan my-feature /skill:react
```

Each trigger becomes a visible, collapsible row in the TUI before the cleaned
user message reaches the LLM.

## How it works

pi-trigger intercepts the `input` event, scans for `/skill:name` and
`/prompt:name` tokens, expands them, sends the expanded content as custom
messages, and returns the cleaned text to Pi core. A single event handler
covers both leading-case (`/prompt:plan args`) and mid-text
(`@file /prompt:plan args`).

## Discovery

Skills are discovered from:
- `~/.pi/agent/skills/`
- `~/.agents/skills/`
- `.pi/skills/`
- Installed package roots (recursive SKILL.md scan)

Prompt templates are discovered from:
- `~/.pi/agent/prompts/`
- `.pi/prompts/`
- `<installed-package>/prompts/` (for packages with `pi.prompts` in package.json)
