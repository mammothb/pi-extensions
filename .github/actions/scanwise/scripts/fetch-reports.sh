#!/bin/bash
set -euo pipefail
export SONAR_INSTANCE_PORT=${SONAR_INSTANCE_PORT:-"9234"}
export SONAR_PROJECT_NAME="${SONAR_PROJECT_NAME:-$(basename "$(pwd)")}"

# ── Issues ───────────────────────────────────────────────────────────────────

create_pr_issues_report_json() {
  local issues_file="$1"
  local commit_file="$2"

  if [[ ! -f "$commit_file" ]]; then
    echo "Error: File '$commit_file' not found!"
    exit 1
  fi

  local first=true
  echo "[" > "$issues_file"
  while read -r CREATED_AT AUTHOR_EMAIL; do
    FORMATTED_CREATED_AT=$(date -d "$CREATED_AT" +"%Y-%m-%dT%H:%M:%S%z")
    ENCODED_CREATED_AT=${FORMATTED_CREATED_AT//+/%2B}
    ENCODED_EMAIL=${AUTHOR_EMAIL//+/%2B}
    fetch_and_append_issues "$issues_file" "$first" "&createdAt=$ENCODED_CREATED_AT&author=$ENCODED_EMAIL"
    first=false
  done < "$commit_file"
  echo "]" >> "$issues_file"
}

create_n_days_issues_report_json() {
  local issues_file="$1"
  local n_days="$2"

  local first=true
  echo "[" > "$issues_file"
  fetch_and_append_issues "$issues_file" "$first" "&createdInLast=$n_days"
  echo "]" >> "$issues_file"
}

create_overall_issues_report_json() {
  local issues_file="$1"

  local first=true
  echo "[" > "$issues_file"
  fetch_and_append_issues "$issues_file" "$first"
  echo "]" >> "$issues_file"
}

fetch_and_append_issues() {
  local issues_file="$1"
  local first="$2"
  local extra_params="$3"

  local PAGE=1
  while :; do
    RESPONSE=$(curl -s -u "admin:Son@rless123" \
      "http://localhost:${SONAR_INSTANCE_PORT}/api/issues/search?componentKeys=${SONAR_PROJECT_NAME}&ps=500&p=$PAGE&s=SEVERITY&asc=false${extra_params}")

    echo "$RESPONSE" | jq -c '.issues[]?' | while IFS= read -r issue; do
      if [ "$first" = true ]; then
        first=false
      else
        echo "," >> "$issues_file"
      fi
      echo "$issue" >> "$issues_file"
    done

    total=$(echo "$RESPONSE" | jq -r '.paging.total')
    if [[ ! "$total" =~ ^[0-9]+$ ]]; then break; fi
    if [ "$total" -le $(("$PAGE" * 500)) ]; then break; fi
    PAGE=$(("$PAGE" + 1))
  done
}

# ── Hotspots ─────────────────────────────────────────────────────────────────

create_pr_hotspots_report_json() {
  local input_file="$1"
  local output_file="$2"
  local commit_file="$3"

  local first=true
  echo "[" > "$output_file"
  while read -r CREATED_AT AUTHOR_EMAIL; do
    FORMATTED_CREATED_AT=$(date -d "$CREATED_AT" +"%Y-%m-%dT%H:%M:%S%z")
    matching=$(jq -c "[.[] | select(.author == \"$AUTHOR_EMAIL\" and .creationDate == \"$FORMATTED_CREATED_AT\")]" "$input_file")
    count=$(echo "$matching" | jq 'length')
    if [ "$count" -gt 0 ]; then
      if [ "$first" = true ]; then
        first=false
      else
        echo "," >> "$output_file"
      fi
      echo "$matching" | jq -r 'map(@json) | join(",")' >> "$output_file"
    fi
  done < "$commit_file"
  echo "]" >> "$output_file"
}

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

  local first=true
  echo "[" > "$hotspots_file"
  fetch_and_append_hotspots "$hotspots_file" "$first"
  echo "]" >> "$hotspots_file"
}

fetch_and_append_hotspots() {
  local hotspots_file="$1"
  local first="$2"

  local PAGE=1
  while :; do
    RESPONSE=$(curl -s -u "admin:Son@rless123" \
      "http://localhost:${SONAR_INSTANCE_PORT}/api/hotspots/search?projectKey=${SONAR_PROJECT_NAME}&ps=500&p=$PAGE")

    echo "$RESPONSE" | jq -c '.hotspots[]?' | while IFS= read -r hotspot; do
      if [ "$first" = true ]; then
        first=false
      else
        echo "," >> "$hotspots_file"
      fi
      echo "$hotspot" >> "$hotspots_file"
    done

    total=$(echo "$RESPONSE" | jq -r '.paging.total')
    if [[ ! "$total" =~ ^[0-9]+$ ]]; then break; fi
    if [ "$total" -le $(("$PAGE" * 500)) ]; then break; fi
    PAGE=$(("$PAGE" + 1))
  done
}

"$@"
