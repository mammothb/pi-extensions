# pi-webfetch

A [pi](https://pi.dev) extension that adds a `WebFetch` tool for fetching and
converting web content.

## Usage

Once installed, the LLM can call the `WebFetch` tool to fetch content from URLs
and convert it to **markdown** (default), **text**, or **html**.

### Tool parameters

| Parameter  | Type     | Default      | Description |
| ---------- | -------- | ------------ | ----------- |
| `url`      | string   | _(required)_ | URL to fetch (must start with `http://` or `https://`) |
| `format`   | string   | `"markdown"` | Output format: `"markdown"`, `"text"`, or `"html"` |
| `timeout`  | number   | `30`         | Timeout in seconds (max `120`) |

The tool accepts HTTP URLs and automatically upgrades them to HTTPS. Results
may be summarized if the content is very large.

### Image handling

When the response is an image (jpg, png, gif, webp), the tool returns it as a
base64-encoded data URL that pi can render as an attachment.

### Content negotiation

The tool sets `Accept` headers based on the requested format:

- **markdown** — prefers `text/markdown`, falls back to `text/html`
- **text** — prefers `text/plain`, falls back to `text/html`
- **html** — prefers `text/html`

### HTML processing

HTML content is converted using [htmlparser2][] (for text extraction) and
[turndown][] (for markdown conversion). Scripts, styles, and metadata elements
are stripped.

### Limits

- Max response size: **5 MB**
- Max timeout: **120 seconds**
- Requests blocked by Cloudflare are automatically retried with an honest
  `User-Agent`

## Development

```bash
# Run tests from the workspace root
cd ../.. && pnpm run test

# Test locally with pi (from this package directory)
pi -e ./index.ts
```

[htmlparser2]: https://github.com/fb55/htmlparser2
[turndown]: https://github.com/mixmark-io/turndown
