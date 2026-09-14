---
"@mammothb/pi-web": patch
---

Fix startup notification for the `unsloth` provider. The `session_start` toast previously read `search: unsloth @ https://mcp.exa.ai/mcp` — the URL was leaked from the exa-mcp config because the ternary had no `unsloth` branch. The toast now shows the resolved engine list (respecting the `engines` allowlist and `disabledEngines` blocklist) for unsloth, and continues to show the configured URL for `exa-mcp` and `searxng`.
