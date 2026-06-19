---
"@mammothb/pi-hashline": patch
---

Fix `---` (markdown horizontal rule) silently consumed as envelope separator

Replaced custom envelope markers (`<<<`/`>>>`/`---`/`...`) with oh-my-pi's
`*** Begin Patch` / `*** End Patch` / `*** Abort`. This eliminates the
`envelope-separator` collision where `---` was silently dropped from
hunk bodies, causing empty-body errors or missing content in markdown edits.
