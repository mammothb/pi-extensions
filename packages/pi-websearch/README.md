# pi-websearch

A [pi](https://pi.dev) extension that adds a `websearch` tool for searching
the web via a configurable provider.

## Providers

Two search backends are supported, configured via the `provider` option:

| Provider   | Description |
| ---------- | ----------- |
| `exa-mcp`  | [Exa][] MCP server over JSON-RPC HTTP (default) |
| `searxng`  | Self-hosted [SearXNG][] metasearch instance |

## Usage

Once installed, the LLM can call the `websearch` tool to search the web for
current information, cite sources, and scrape specific URLs.

### Tool parameters

| Parameter              | Type   | Default      | Description |
| ---------------------- | ------ | ------------ | ----------- |
| `query`                | string | _(required)_ | Search query |
| `numResults`           | number | `8`          | Number of results to return |
| `type`                 | string | `"auto"`     | Search type: `"auto"`, `"fast"`, or `"deep"` |
| `livecrawl`            | string | `"fallback"` | Live crawl mode: `"fallback"` or `"preferred"` |
| `contextMaxCharacters` | number | `10000`      | Max characters for LLM-optimized context |

## Configuration

Configuration is loaded from two JSON files (project overrides global, global
overrides defaults):

| Location | Purpose |
| -------- | ------- |
| `~/.pi/agent/pi-websearch.json` | Global config (applies to all projects) |
| `<project>/.pi/pi-websearch.json` | Project-level config (overrides global) |

### Options

```jsonc
{
  // Which provider to use: "exa-mcp" or "searxng" (default: "exa-mcp")
  "provider": "exa-mcp",

  "exaMcp": {
    // MCP server URL (default: "https://mcp.exa.ai/mcp")
    "url": "https://mcp.exa.ai/mcp",
    // MCP tool name (default: "web_search_exa")
    "tool": "web_search_exa"
  },

  "searxng": {
    // SearXNG instance URL (default: "http://localhost:8080")
    "url": "http://localhost:8080",
    // SafeSearch: 0 (off), 1 (moderate), 2 (strict)
    "safesearch": 0,
    // Optional path to a custom management script
    "script": "/path/to/custom-searxng"
  },

  // Request timeout in milliseconds (default: 25000)
  "timeoutMs": 25000,

  // Default values for search parameters
  "defaults": {
    "numResults": 8,
    "type": "auto",
    "livecrawl": "fallback",
    "contextMaxCharacters": 10000
  }
}
```

All keys are optional — missing keys fall back to built-in defaults.

## SearXNG provider

When `provider` is set to `"searxng"`, the extension manages a local SearXNG
Docker instance automatically:

- On `session_start`, the extension starts SearXNG via `docker compose up -d`
  (using the bundled `bin/searxng` script or a custom script).
- On `session_shutdown` (quit), it stops SearXNG when no other pi instances
  are using it.
- Instance tracking uses PID-based lock files under
  `~/.pi/agent/searxng-instances/`.

### Setting up SearXNG

The bundled `docker-compose.yml` and `.env` files are in `searxng/`. By default
SearXNG listens on `http://localhost:8080`. You can change the port in
`searxng/.env` (`SEARXNG_PORT`).

To use a custom management script, set `searxng.script` to a path (supports
`~` expansion). The script must accept `up` and `down` commands — matching
the interface of the built-in `bin/searxng` script.

## Development

```bash
# Run tests from the workspace root
cd ../.. && pnpm run test

# Test locally with pi (from this package directory)
pi -e ./index.ts
```

[Exa]: https://exa.ai
[SearXNG]: https://docs.searxng.org
