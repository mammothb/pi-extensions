---
"@mammothb/pi-permissions": patch
---

Revert `bw` CLI — the npm bin entry pointed to TypeScript source which fails with Node v24's `--experimental-strip-types` in `node_modules`. Removed until a working bin strategy is in place.
