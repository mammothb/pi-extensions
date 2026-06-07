# @mammothb/pi-shared

## 1.1.0

### Minor Changes

- f7eba7a: Extract common render/utility functions to pi-shared

  - Add `isTextContent`, `extractTextContent`, `firstTextBlock`, `renderError`, `getExpandKey` to `@mammothb/pi-shared`
  - All extension packages now import these from pi-shared instead of duplicating them locally
  - pi-webfetch switches to SDK `formatSize` instead of local copy
  - pi-websearch adds missing error guard in `renderResult`

## 1.0.0

### Major Changes

- d105fe5: add expandTilde to share package. use expandTilde in pi-eval config
