---
"@mammothb/pi-eval": minor
---

Added optional `cwd` parameter to the `eval` tool — models can now specify a working directory for subprocess execution. When omitted, defaults to the agent's current working directory (backward compatible). The `cwd` also affects config loading (`.pi/pi-eval.json`), matching the mental model of "run this code in that directory."
