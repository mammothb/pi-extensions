# Contributing

## Setup

```sh
corepack enable pnpm   # if pnpm isn't already available
pnpm install
```

## Development

| Command              | Purpose                        |
| -------------------- | ------------------------------ |
| `pnpm run check`     | Lint and format check (biome)  |
| `pnpm run format`    | Auto-format (biome)            |
| `pnpm run test`      | Run tests (vitest)             |
| `pnpm run test:coverage` | Tests with coverage        |

Run `pnpm run check` before committing.

## Adding a changeset

When your PR introduces a user-facing change (feature, fix, breaking change):

```sh
pnpm changeset add
```

Select the changed package(s) and pick a semver bump:
- **patch** — bug fixes
- **minor** — new features
- **major** — breaking changes

Commit the generated `.changeset/*.md` file alongside your code.

## Release

Releases are done via a Forgejo Actions workflow.

1. Merge your PR (including the changeset) to `main`.
2. Go to **Actions → Release → Run workflow** on the Forgejo repo.
3. The workflow consumes the changeset, bumps versions, pushes a version commit,
   and publishes to npm.

The `NPM_TOKEN` secret must be set in the repo's Actions secrets.

## Packages

This is a pnpm workspace monorepo. Each package under `packages/` is published
independently. Peer dependencies on `@earendil-works/pi-*` packages should use
`"*"` to accept whatever version the user's pi installation provides.
