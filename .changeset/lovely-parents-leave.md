---
"@mammothb/pi-subagents": minor
---

Add socket IPC push delivery for research reports via the `aipcd` daemon. Report submissions now route through a Unix domain socket (`research-ipc.sock`) when the daemon is reachable, falling back to file-based IPC transparently.
