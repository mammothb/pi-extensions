#!/bin/bash
set -euo pipefail
export SONAR_PROJECT_NAME="${SONAR_PROJECT_NAME:-$(basename "$(pwd)")}"
export SONAR_GITROOT=${SONAR_GITROOT:-"$(pwd)"}
export SONAR_METRICS_PATH=${SONAR_METRICS_PATH:-"./sonar-metrics.json"}

# ── Markdown report generators ──────────────────────────────────────────────

generate_issues_report_md() {
  local input_json="$1"
  local output_md="$2"

  {
    echo "### Issues Details for $SONAR_PROJECT_NAME"
    echo "| Type | Severity | File | Line | Effort | Author | Rule | Message |"
    echo "|------|----------|------|------|--------|--------|------|---------|"
    jq -r '
      .[] |
      "| \(.type) | \(.severity) | \(.component | split(":")[1] | gsub("_"; "\\_")) | \(.line // "-") | " +
      "\(.effort) | \(.author | gsub("_"; "\\_")) | \(.rule) | " +
      (.message
        | gsub("\\|"; "\\|")
        | gsub("\\*"; "\\*")
        | gsub("_"; "\\_")
        | gsub("`"; "\\`")
        | gsub("\\["; "\\[")
        | gsub("\\]"; "\\]")
        | gsub("<"; "\\<")
        | gsub(">"; "\\>")
      ) + " |"
    ' "${input_json}"
  } > "${output_md}"
}

generate_hotspots_report_md() {
  local input_json="$1"
  local output_md="$2"

  {
    echo "### Security Hotspots for $SONAR_PROJECT_NAME"
    echo "| Category | Vuln. Probability | File | Line | Author | Rule | Message |"
    echo "|----------|-------------------|------|------|--------|------|---------|"
    jq -r '
      .[] |
      "| \(.securityCategory) | \(.vulnerabilityProbability) | \(.component | split(":")[1] | gsub("_"; "\\_")) | \(.line // "-") | \(.author | gsub("_"; "\\_")) | \(.ruleKey) | " +
      (.message
        | gsub("\\|"; "\\|")
        | gsub("\\*"; "\\*")
        | gsub("_"; "\\_")
        | gsub("`"; "\\`")
        | gsub("\\["; "\\[")
        | gsub("\\]"; "\\]")
        | gsub("<"; "\\<")
        | gsub(">"; "\\>")
      ) + " |"
    ' "${input_json}"
  } > "${output_md}"
}

# ── Inline detail tables for step summary ───────────────────────────────────

generate_issues_summary_md() {
  local input_json="$1"
  jq -r '
    if length == 0 then
      "_No new issues_"
    else
      "| Type | Severity | File | Line | Message |",
      "|------|----------|------|------|---------|",
      (.[] | "| \(.type) | **\(.severity)** | `\(.component | split(":")[1])` | \(.line // "-") | \(.message | gsub("\\|"; "\\|")) |")
    end
  ' "${input_json}"
}

generate_hotspots_summary_md() {
  local input_json="$1"
  jq -r '
    if length == 0 then
      "_No new hotspots_"
    else
      "| Category | Probability | File | Line | Message |",
      "|----------|-------------|------|------|---------|",
      (.[] | "| \(.securityCategory) | **\(.vulnerabilityProbability)** | `\(.component | split(":")[1])` | \(.line // "-") | \(.message | gsub("\\|"; "\\|")) |")
    end
  ' "${input_json}"
}

# ── Generate stars for ratings ──────────────────────────────────────────────

generate_stars() {
  local rating=$1
  local rounded_rating
  rounded_rating=$(printf "%.0f" "$rating")

  local full_stars
  full_stars=$(printf '★%.0s' $(seq 1 $((6 - rounded_rating))))
  local empty_stars
  empty_stars=$(printf '☆%.0s' $(seq 1 $((rounded_rating - 1))))

  if [[ $((6 - rounded_rating)) -eq 5 ]]; then
    echo "$full_stars"
  else
    echo "$full_stars$empty_stars"
  fi
}

# ── Main scanwise analysis summary (for GITHUB_STEP_SUMMARY) ────────────────

generate_scanwise_analysis_summary_md() {
  local new_issues_json="$1"
  local new_hotspots_json="$2"
  local new_artifact_link="${3:-}"
  local overall_artifact_link="${4:-}"

  # New code stats
  local new_code_smells new_bugs new_vulnerabilities new_security_hotspots
  new_code_smells=$(jq '[.[] | select(.type == "CODE_SMELL")] | length' "$new_issues_json")
  new_bugs=$(jq '[.[] | select(.type == "BUG")] | length' "$new_issues_json")
  new_vulnerabilities=$(jq '[.[] | select(.type == "VULNERABILITY")] | length' "$new_issues_json")
  new_security_hotspots=$(jq 'length' "$new_hotspots_json")

  # Overall metrics
  local overall_metrics
  overall_metrics=$(cat "${SONAR_GITROOT}/${SONAR_METRICS_PATH}")

  local name ncloc code_smells bugs vulnerabilities security_hotspots
  local sqale_rating reliability_rating security_rating coverage duplicated_lines_density quality_gate_status

  name=$(echo "$overall_metrics" | jq -r '.component.name')
  ncloc=$(echo "$overall_metrics" | jq -r '.component.measures[] | select(.metric == "ncloc") | .value')
  code_smells=$(echo "$overall_metrics" | jq -r '.component.measures[] | select(.metric == "code_smells") | .value')
  bugs=$(echo "$overall_metrics" | jq -r '.component.measures[] | select(.metric == "bugs") | .value')
  vulnerabilities=$(echo "$overall_metrics" | jq -r '.component.measures[] | select(.metric == "vulnerabilities") | .value')
  security_hotspots=$(echo "$overall_metrics" | jq -r '.component.measures[] | select(.metric == "security_hotspots") | .value')
  sqale_rating=$(echo "$overall_metrics" | jq -r '.component.measures[] | select(.metric == "sqale_rating") | .value')
  reliability_rating=$(echo "$overall_metrics" | jq -r '.component.measures[] | select(.metric == "reliability_rating") | .value')
  security_rating=$(echo "$overall_metrics" | jq -r '.component.measures[] | select(.metric == "security_rating") | .value')
  coverage=$(echo "$overall_metrics" | jq -r '.component.measures[] | select(.metric == "coverage") | .value')
  duplicated_lines_density=$(echo "$overall_metrics" | jq -r '.component.measures[] | select(.metric == "duplicated_lines_density") | .value')
  quality_gate_status=$(echo "$overall_metrics" | jq -r '.component.measures[] | select(.metric == "quality_gate_details") | .value | fromjson | .level')

  local sqale_stars reliability_stars security_stars
  sqale_stars=$(generate_stars "$sqale_rating")
  reliability_stars=$(generate_stars "$reliability_rating")
  security_stars=$(generate_stars "$security_rating")

  # Build summary
  local summary=""

  # Quality Gate banner
  if [ "$quality_gate_status" = "OK" ]; then
    summary+="## ✅ Quality Gate: **PASSED**\n\n"
  else
    summary+="## ❌ Quality Gate: **FAILED**\n\n"
  fi

  # New code section
  summary+="### 🆕 New Code (this PR)\n\n"
  summary+="| 💡 Code Smells | 🐞 Bugs | 🔒 Vulnerabilities | 🔥 Hotspots |\n"
  summary+="|----------------|---------|--------------------|-------------|\n"
  summary+="| $new_code_smells | $new_bugs | $new_vulnerabilities | $new_security_hotspots |\n\n"

  # Inline new issues table
  local new_issues_table
  new_issues_table=$(generate_issues_summary_md "$new_issues_json")
  summary+="<details>\n<summary><b>New Issues</b></summary>\n\n${new_issues_table}\n</details>\n\n"

  # Inline new hotspots table
  local new_hotspots_table
  new_hotspots_table=$(generate_hotspots_summary_md "$new_hotspots_json")
  summary+="<details>\n<summary><b>New Security Hotspots</b></summary>\n\n${new_hotspots_table}\n</details>\n\n"

  # Overall code section
  summary+="### 🔁 Overall Code\n\n"
  summary+="| Metric | Value |\n"
  summary+="|--------|-------|\n"
  summary+="| 📊 Lines of Code | $ncloc |\n"
  summary+="| 💡 Code Smells | $code_smells |\n"
  summary+="| 🐞 Bugs | $bugs |\n"
  summary+="| 🔒 Vulnerabilities | $vulnerabilities |\n"
  summary+="| 🔥 Security Hotspots | $security_hotspots |\n"
  summary+="| 💎 Maintainability | $sqale_stars |\n"
  summary+="| ⚙️ Reliability | $reliability_stars |\n"
  summary+="| 🔐 Security | $security_stars |\n"
  summary+="| 🛡 Test Coverage | ${coverage}% |\n"
  summary+="| 🌀 Duplicated Lines | ${duplicated_lines_density}% |\n\n"

  # Artifact links
  if [ -n "$new_artifact_link" ]; then
    summary+="📥 [Download new-code reports](${new_artifact_link})\n"
  fi
  if [ -n "$overall_artifact_link" ]; then
    summary+="📥 [Download overall reports](${overall_artifact_link})\n"
  fi

  printf "%b" "$summary"
}

"$@"
