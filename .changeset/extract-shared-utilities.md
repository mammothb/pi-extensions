---
"@mammothb/pi-shared": minor
"@mammothb/pi-eval": patch
"@mammothb/pi-websearch": patch
"@mammothb/pi-webfetch": patch
"@mammothb/pi-ghsearch": patch
---

Extract common render/utility functions to pi-shared

- Add `isTextContent`, `extractTextContent`, `firstTextBlock`, `renderError`, `getExpandKey` to `@mammothb/pi-shared`
- All extension packages now import these from pi-shared instead of duplicating them locally
- pi-webfetch switches to SDK `formatSize` instead of local copy
- pi-websearch adds missing error guard in `renderResult`
