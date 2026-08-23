---
"@mammothb/pi-web": minor
---

Add `unsloth` search provider — direct multi-engine scraping (duckduckgo, brave, google, mojeek, yahoo, yandex, wikipedia) with provider-deduplication and frequency ranking; no API key or Docker required. Enable with `"provider": "unsloth"` in `pi-web.json`, optionally under an `unsloth` block: `timeoutMs` (per-engine fetch timeout), `region` (`xx-yy`, default `us-en`), `safesearch` (`on`/`moderate`/`off`), and engine selection via mutually exclusive `engines` allowlist or `disabledEngines` blocklist. Search results now use a single shared grammar across all providers (`Title:`/`URL:`/`Snippet:` blocks with a WebFetch hint appended by the tool layer). Also fixes DDG extraction against current markup and Yahoo ad filtering for links hidden behind `/RU=` redirects.
