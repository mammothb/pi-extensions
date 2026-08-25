---
"@mammothb/pi-shared": minor
"@mammothb/pi-office": minor
---

Add SharePoint file loading to pi-office and `cmd:` token source to pi-shared

pi-office gains an opt-in `load_sharepoint` tool that downloads files from
SharePoint via Microsoft Graph and writes them to a local temp path for the
reader tools (`read_pdf`, `read_docx`, `read_xlsx`). Configure it in
`~/.pi/agent/pi-office.json` or `.pi/pi-office.json`:

```json
{
  "sharepoint": {
    "tokenSource": "env:GRAPH_TOKEN",
    "baseUrl": "https://graph.microsoft.com/v1.0"
  }
}
```

`baseUrl` defaults to the global Graph endpoint; override it for sovereign
clouds (e.g. `https://graph.microsoft.us`).

pi-shared's `resolveSecret` now supports a `cmd:` prefix alongside `env:` and
`file:`: `cmd:command args` runs the command (no shell, quotes respected) and
returns trimmed stdout.
