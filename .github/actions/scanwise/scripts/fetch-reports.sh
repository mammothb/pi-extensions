#!/bin/bash
set -euo pipefail
export SONAR_INSTANCE_PORT=${SONAR_INSTANCE_PORT:-"9234"}
export SONAR_PROJECT_NAME="${SONAR_PROJECT_NAME:-$(basename "$(pwd)")}"

# ── Issues ───────────────────────────────────────────────────────────────────

create_n_days_issues_report_json() {
  local issues_file="$1"
  local n_days="$2"

  echo "[" > "$issues_file"
  fetch_and_append_issues "$issues_file" "&createdInLast=$n_days"
  echo "]" >> "$issues_file"
}

create_overall_issues_report_json() {
  local issues_file="$1"

  echo "[" > "$issues_file"
  fetch_and_append_issues "$issues_file"
  echo "]" >> "$issues_file"
}

fetch_and_append_issues() {
  local issues_file="$1"
  local extra_params="${2:-}"

  local PAGE=1
  while :; do
    RESPONSE=$(curl -s -u "admin:Son@rless123" \
      "http://localhost:${SONAR_INSTANCE_PORT}/api/issues/search?componentKeys=${SONAR_PROJECT_NAME}&ps=500&p=$PAGE&s=SEVERITY&asc=false${extra_params}")

    echo "$RESPONSE" | jq -c '.issues[]?' | while IFS= read -r issue; do
      _append_with_comma "$issues_file" "$issue"
    done

    total=$(echo "$RESPONSE" | jq -r '.paging.total')
    if [[ ! "$total" =~ ^[0-9]+$ ]]; then break; fi
    if [ "$total" -le $(("$PAGE" * 500)) ]; then break; fi
    PAGE=$(("$PAGE" + 1))
  done
}

# ── Hotspots ─────────────────────────────────────────────────────────────────

create_n_days_hotspots_report_json() {
  local input_file="$1"
  local output_file="$2"
  local n_days="$3"
  local n_days_num=${n_days%d}

  cutoff_date=$(date -d "$n_days_num days ago" +"%Y-%m-%dT%H:%M:%S%z")
  echo "Cutoff date: $cutoff_date"
  jq -c "[.[] | select(.creationDate >= \"$cutoff_date\")]" "$input_file" > "$output_file"
}

create_overall_hotspots_report_json() {
  local hotspots_file="$1"

  echo "[" > "$hotspots_file"
  fetch_and_append_hotspots "$hotspots_file"
  echo "]" >> "$hotspots_file"
}

fetch_and_append_hotspots() {
  local hotspots_file="$1"

  local PAGE=1
  while :; do
    RESPONSE=$(curl -s -u "admin:Son@rless123" \
      "http://localhost:${SONAR_INSTANCE_PORT}/api/hotspots/search?projectKey=${SONAR_PROJECT_NAME}&ps=500&p=$PAGE")

    echo "$RESPONSE" | jq -c '.hotspots[]?' | while IFS= read -r hotspot; do
      _append_with_comma "$hotspots_file" "$hotspot"
    done

    total=$(echo "$RESPONSE" | jq -r '.paging.total')
    if [[ ! "$total" =~ ^[0-9]+$ ]]; then break; fi
    if [ "$total" -le $(("$PAGE" * 500)) ]; then break; fi
    PAGE=$(("$PAGE" + 1))
  done
}

# ── Shared helper ────────────────────────────────────────────────────────────
# Uses a file-based sentinel to track first-vs-subsequent across subshells.

_append_with_comma() {
  local file="$1"
  local entry="$2"
  local sentinel="/tmp/scanwise_first_$$"

  if [ -f "$sentinel" ]; then
    rm -f "$sentinel"
  else
    echo "," >> "$file"
  fi
  echo "$entry" >> "$file"
}

# Create sentinel before each top-level fetch call
# (resets for each new overall/n_days report generation)
touch /tmp/scanwise_first_$$

"$@"

# Clean up sentinel
rm -f /tmp/scanwise_first_$$
