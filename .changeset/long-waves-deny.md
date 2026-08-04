---
"@mammothb/pi-subagents": patch
---

Harden socket IPC frame decoding against invalid and non-object payloads, guard error/close teardown against stale sockets, resolve fallback rejections cleanly, and improve test coverage.
