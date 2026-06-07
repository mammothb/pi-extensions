# Contributing

## Setup

Requires Node.js `v24.15.0` (see `.nvmrc`).

```sh
corepack enable pnpm   # if pnpm isn't already available
pnpm install
```

To publish locally, set `NPM_TOKEN` in your environment so `.npmrc` can
authenticate with the npm registry.

## Development

| Command                 | Purpose                                    |
| ----------------------- | ------------------------------------------ |
| `pnpm run check`        | Lint and format check (biome). Aliased as `pnpm run lint`. |
| `pnpm run format`       | Auto-format (biome)                        |
| `pnpm run test`         | Run tests (vitest)                         |
| `pnpm run test:coverage`| Tests with coverage                        |

Run `pnpm run check` before committing.

To test a package locally with pi:

```sh
cd packages/<package>
pi -e ./index.ts
```

### Code style

Biome enforces double quotes, semicolons, and space indentation (see
`biome.json`).

### Theme colors in tool renderers

When rendering tool output via `renderCall` or `renderResult`, the content is
displayed inside a colored box (`toolPendingBg`, `toolSuccessBg`, or
`toolErrorBg`). Some theme colors have poor contrast on these backgrounds:

| Color | Dark theme | Contrast on `toolSuccessBg` (#283228) |
|-------|-----------|---------------------------------------|
| `dim` | #666666 | **2.4:1** — unreadable |
| `muted` / `toolOutput` | #808080 | **3.4:1** — below WCAG AA (4.5:1) |
| `text` | #d4d4d4 | **9.3:1** — passes AAA |

**Rules of thumb:**

- **Never use `dim`** for text on tool backgrounds. Use `muted` instead.
- Use `toolOutput` for code-like or output content that needs to be readable.
- `text` is always safe but should be reserved for primary content (it removes
  visual hierarchy when overused).
- `success`, `error`, and `warning` have adequate contrast for status info.

Status colors (`success`/`error`) and `toolTitle`/`toolOutput` are designed
for use on tool backgrounds. General-purpose colors (`dim`, `muted`) are
designed for use on the terminal's default background and lose readability
when placed on colored boxes.

If a theme author wants to improve contrast further, they can brighten
`toolOutput` independently without affecting other uses of `muted`.

### Tests

The vitest workspace (`vitest.config.ts`) covers `pi-ghsearch`, `pi-webfetch`,
and `pi-websearch`. `pi-toast` has no tests and is not yet in the workspace —
add it when writing tests.

## Packages

This is a pnpm workspace monorepo. Each package under `packages/` is published
independently under the `@mammothb/` scope.

| Package | Description |
| --- | --- |
| `@mammothb/pi-ghsearch` | Typed GitHub search, fetch, and auth-status tools via the `gh` CLI |
| `@mammothb/pi-toast` | Desktop toast notifications on agent events (tmux-aware) |
| `@mammothb/pi-webfetch` | Fetch and convert web content to markdown/text/html |
| `@mammothb/pi-websearch` | Web search via SearXNG or Exa MCP |

### Project structure

Each package follows this layout:

```
packages/<name>/
  index.ts          # extension entry point
  src/              # implementation
  test/             # vitest tests
  evals/            # eval/smoke tests (pi-ghsearch only)
  tsconfig.json     # extends ../../tsconfig.base.json
```

Packages ship TypeScript source directly — there is no build step.
TypeScript is configured with `bundler` module resolution, `ES2022` target,
and `noEmit` (see `tsconfig.base.json`).

### Dependencies

Shared library versions are managed via pnpm catalogs in
`pnpm-workspace.yaml`. Add catalog entries there rather than pinning
versions in individual `package.json` files.

Peer dependencies on `@earendil-works/pi-*` packages should use `"*"` to
accept whatever version the user's pi installation provides.

## Adding a changeset

When your PR introduces a user-facing change (feature, fix, breaking change):

```sh
pnpm changeset add
```

Select the changed package(s) (listed above) and pick a semver bump:
- **patch** — bug fixes
- **minor** — new features
- **major** — breaking changes

Commit the generated `.changeset/*.md` file alongside your code.

## Release

Releases are done via a manually-triggered Forgejo Actions workflow.

1. Merge your PR (including the changeset) to `main`.
2. Go to **Actions → Release → Run workflow** on the Forgejo repo.
3. The workflow consumes the changeset, bumps versions, pushes a version
   commit, and publishes to npm.

The `NPM_TOKEN` secret must be set in the repo's Actions secrets.
