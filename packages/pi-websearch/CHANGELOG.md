# @mammothb/pi-websearch

## 3.1.0

### Minor Changes

- 2a0e808: - Docker lifecycle: start and stop no longer block pi — child processes run detached so `docker compose up`/`down` survive pi exit
  - Shutdown health tracking: detects unclean SearXNG shutdowns from previous sessions via PID files and warns on next startup
  - Refactored SearXNG lifecycle into a `setupSearxng()` factory, eliminating closure variables in the extension entrypoint
  - Merged detached spawn paths in `runScript` — the `shutdownPidDir` option replaces the separate `runDetachedDown` function
  - `checkShutdownHealth` now returns a `cleanup()` method instead of requiring a separate `cleanShutdownPids` call
  - `SearchProvider` interface gained `usageNotes` — providers supply their own tool description strings
  - Moved MCP response parsing (`parseResponse`) into the Exa provider, removing the standalone `parsers.ts` module

## 3.0.0

### Major Changes

- d105fe5: add expandTilde to share package. use expandTilde in pi-eval config

### Patch Changes

- Updated dependencies [d105fe5]
  - @mammothb/pi-shared@1.0.0

## 2.0.0

### Major Changes

- 759d16c: update readme

## 1.0.0

### Major Changes

- 871998b: tmux aware toast notification at the end of agent turn. requires custom path to toast notifier
