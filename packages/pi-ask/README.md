# pi-ask

A [pi](https://pi.dev) extension that adds an `AskUserQuestion` tool for interactive
user prompting during agent execution. When the LLM needs user input —
preferences, clarifications, implementation decisions — it can ask 1–4
structured questions with a TUI form instead of plain-text back-and-forth.

## Usage

Once installed, the LLM can call the `AskUserQuestion` tool to present the user with a
tabbed form. Each question gets its own tab; a final **Submit** tab sends all
answers back to the agent.

### Tool parameters

The `AskUserQuestion` tool accepts an object with a `questions` array (1–4 questions):

| Field | Type | Description |
| --- | --- | --- |
| `questions[].header` | string | Short label (max 12 characters) shown in the tab bar |
| `questions[].question` | string | The question text displayed to the user |
| `questions[].options` | array | 2–4 answer options, each with a `label` (required) and optional `description` |
| `questions[].multi` | boolean | Allow selecting multiple options |
| `questions[].recommended` | number | Index of the recommended/default option (0-based) |

A free-text **"Type your own answer..."** option is always appended
automatically — there is no need to add an "Other" option yourself.

### Answer format

When the user submits, the tool returns answers as a key-value record
mapping question text → selected answer text:

- **Single-select**: the label of the chosen option
- **Multi-select**: labels joined with `", "` e.g. `"Option A, Option C"`
- **Free-text**: the user's typed string verbatim

### Example

```json
{
  "questions": [
    {
      "header": "Color",
      "question": "What color should the button be?",
      "options": [
        { "label": "Blue", "description": "Matches the existing primary palette" },
        { "label": "Green", "description": "Suggests success/confirmation" },
        { "label": "Red", "description": "High urgency, use sparingly" }
      ],
      "multi": false,
      "recommended": 0
    },
    {
      "header": "Placement",
      "question": "Where should the button appear?",
      "options": [
        { "label": "Top right" },
        { "label": "Bottom center" },
        { "label": "Inline with text" }
      ],
      "multi": false
    }
  ]
}
```

## UI controls

### Tabs

When multiple questions are present, each question occupies its own tab. The
last tab is **Submit**, which is only active once all questions have been
answered. For single-question prompts the tab bar is hidden and submission
happens directly.

### Selection

- **Single-select** (`multi: false`): pressing Enter on an option selects it
  and auto-advances to the next tab (or Submit).
- **Multi-select** (`multi: true`): pressing Space toggles options on/off.
  Press Enter to confirm the selection and advance.
- Any question can be answered with free-text by choosing "Type your own
  answer..." to open an inline editor.

### Keybindings

Default keybindings (configurable in `keybindings.json`):

| ID | Default keys | Description |
| --- | --- | --- |
| `pi-ask.cursorUp` | `up`, `k` | Move highlight up |
| `pi-ask.cursorDown` | `down`, `j` | Move highlight down |
| `pi-ask.prevTab` | `left`, `h` | Previous question tab |
| `pi-ask.nextTab` | `right`, `l` | Next question tab |

Global TUI keys (`enter`, `space`, `escape`, `tab`) also apply. See the
[pi keybindings docs](https://pi.dev/docs/keybindings) for customization.

### Cancellation

Press `Escape` at any time to cancel. The tool returns a `cancelled: true`
response and the agent sees `"User cancelled"`.

## Requirements

- **pi** with interactive mode — the `AskUserQuestion` tool requires `ctx.hasUI` to be
  true (aborts with an error in non-interactive/headless mode).

## Development

```bash
# Run unit tests from the workspace root
cd ../.. && pnpm run test

# Test with coverage
pnpm run test:coverage

# Test locally with pi (from this package directory)
pi -e ./index.ts
```
