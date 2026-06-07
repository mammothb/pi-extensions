---
"@mammothb/pi-eval": patch
"@mammothb/pi-ghsearch": patch
"@mammothb/pi-webfetch": patch
"@mammothb/pi-websearch": patch
---

Fix poor text contrast on colored tool backgrounds

Replace `theme.fg("dim", …)` with `theme.fg("muted", …)` or
`theme.fg("toolOutput", …)` in all tool renderers. The `dim` color
(#666666 in dark theme) had only 2.4:1 contrast against `toolSuccessBg`
(#283228), making secondary text nearly unreadable on green/red tool boxes.

Also add a "Theme colors in tool renderers" section to CONTRIBUTING.md
documenting the contrast issue and which colors to use.
