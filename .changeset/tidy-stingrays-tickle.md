---
"@mammothb/pi-shared": minor
"@mammothb/pi-ask": patch
---

Added BgSafeTruncatedText, a TruncatedText subclass that preserves parent background colors when text is truncated with an ellipsis. pi-ask now uses it in renderCall and renderResult so the ask tool renders correctly on colored backgrounds (toolSuccessBg, toolErrorBg, toolPendingBg).
