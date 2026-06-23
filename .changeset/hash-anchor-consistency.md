---
"@mammothb/pi-hashline": patch
---

Fix hash-anchored line format gaps: grep output, mismatch diagnostics, prefix stripping, prompt instructions, and stale comments now consistently use `HASH│content` format. Remove dead old-format code (`formatNumberedLine`, `parseTag`, etc.).
