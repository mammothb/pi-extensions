#!/usr/bin/env bash
# bw wrapper — drop this in ~/.local/bin/bw after installing the pi package.
#   pi install npm:@mammothb/pi-permissions
#   cp bw-wrapper.sh ~/.local/bin/bw && chmod +x ~/.local/bin/bw
set -euo pipefail

BIN="${HOME}/.pi/agent/npm/node_modules/.bin/bw"

if [ -x "${BIN}" ]; then
  exec "${BIN}" "$@"
fi

echo "bw: not found. Install with: pi install npm:@mammothb/pi-permissions" >&2
echo "bw: for local dev, run tests instead: pnpm test -- --project pi-permissions test/bw/" >&2
exit 1
