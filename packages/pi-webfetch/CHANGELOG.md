# @mammothb/pi-webfetch

## 1.0.2

### Patch Changes

- Updated dependencies [1d59c93]
  - @mammothb/pi-shared@1.2.0

## 1.0.1

### Patch Changes

- f7eba7a: Extract common render/utility functions to pi-shared

  - Add `isTextContent`, `extractTextContent`, `firstTextBlock`, `renderError`, `getExpandKey` to `@mammothb/pi-shared`
  - All extension packages now import these from pi-shared instead of duplicating them locally
  - pi-webfetch switches to SDK `formatSize` instead of local copy
  - pi-websearch adds missing error guard in `renderResult`

- f7eba7a: Fix poor text contrast on colored tool backgrounds

  Replace `theme.fg("dim", …)` with `theme.fg("muted", …)` or
  `theme.fg("toolOutput", …)` in all tool renderers. The `dim` color
  (#666666 in dark theme) had only 2.4:1 contrast against `toolSuccessBg`
  (#283228), making secondary text nearly unreadable on green/red tool boxes.

  Also add a "Theme colors in tool renderers" section to CONTRIBUTING.md
  documenting the contrast issue and which colors to use.

- Updated dependencies [f7eba7a]
  - @mammothb/pi-shared@1.1.0

## 1.0.0

### Major Changes

- 759d16c: update readme
