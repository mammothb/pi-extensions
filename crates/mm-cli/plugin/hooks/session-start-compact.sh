#!/usr/bin/env bash
# SessionStart (compact) hook — injects a structured summary into Claude's
# context after every compaction. Reads hook input JSON from stdin, extracts
# the transcript path, runs mm compile --brief, and wraps the result in the
# additionalContext JSON format.

set -euo pipefail

INPUT="$(cat)"
TRANSCRIPT_PATH="$(echo "$INPUT" | jq -r .transcript_path)"

if [ -z "$TRANSCRIPT_PATH" ] || [ "$TRANSCRIPT_PATH" = "null" ]; then
    echo '{}'
    exit 0
fi

SUMMARY="$(mm compile --brief "$TRANSCRIPT_PATH" 2>/dev/null || true)"

jq -n --arg ctx "$SUMMARY" '{
    hookSpecificOutput: {
        hookEventName: "SessionStart",
        additionalContext: $ctx
    }
}'
