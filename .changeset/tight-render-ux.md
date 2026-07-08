---
"@mammothb/pi-shared": minor
"@mammothb/pi-eval": minor
"@mammothb/pi-webfetch": minor
"@mammothb/pi-websearch": minor
"@mammothb/pi-ghsearch": minor
---

Standardize tool result rendering UX:

- All error paths use shared `renderError()` with optional `toolLabel` prefix
- All tools show `Ctrl+O to expand` hint in collapsed results and `Ctrl+O to collapse` in expanded results
- Shared `getExpandHint(theme, remaining?)` and `getCollapseHint(theme)` utilities in pi-shared
- Shared `PREVIEW_LINES` constant (7) across eval, webfetch, websearch
- WebFetch: added `renderCall` showing target URL; fixed error path not using `ctx.isError`; tight collapsed layout; YAML frontmatter stripped from preview
- WebSearch: error message no longer duplicates tool name prefix
- gh_search/gh_fetch: error messages strip `gh:` CLI prefix to avoid duplication with toolLabel
- Tool names extracted to `TOOL_NAME` constants, used consistently in promptGuidelines, renderCall, and renderError
