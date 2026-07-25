#!/bin/bash
set -euo pipefail

export SONAR_INSTANCE_NAME=${SONAR_INSTANCE_NAME:-"sonar-server"}
export SONAR_INSTANCE_PORT=${SONAR_INSTANCE_PORT:-"9234"}
export SONAR_PROJECT_NAME="${SONAR_PROJECT_NAME:-$(basename "$(pwd)")}"
export SONAR_PROJECT_KEY="${SONAR_PROJECT_KEY:-$(basename "$(pwd)")}"
export SONAR_GITROOT=${SONAR_GITROOT:-"$(pwd)"}
export SONAR_SOURCE_PATH=${SONAR_SOURCE_PATH:-"."}
export SONAR_METRICS_PATH=${SONAR_METRICS_PATH:-"./sonar-metrics.json"}
export SONAR_OPTIONS=${SONAR_OPTIONS:-""}
export SONAR_EXTENSION_DIR="${HOME}/.scanwise/extensions"

export DOCKER_SONAR_CLI=${DOCKER_SONAR_CLI:-"sonarsource/sonar-scanner-cli:11.3"}
export DOCKER_SONAR_SERVER=${DOCKER_SONAR_SERVER:-"sonarqube:25.5.0.107428-community"}

export CLI_NAME="scanwise"

function uri_wait() {
  set +e
  URL=$1
  SLEEP_INT=${2:-60}
  for _ in $(seq 1 "${SLEEP_INT}"); do
    sleep 1
    printf .
    HTTP_CODE=$(curl -k -s -o /dev/null -I -w "%{http_code}" -H 'User-Agent: Mozilla/6.0' "${URL}")
    [[ "${HTTP_CODE}" == "200" ]] && EXIT_CODE=0 || EXIT_CODE=-1
    [[ "${EXIT_CODE}" -eq 0 ]] && echo && return
  done
  echo
  set -e
  return "${EXIT_CODE}"
}

function start() {
  docker-deps-get

  if ! docker inspect "${SONAR_INSTANCE_NAME}" > /dev/null 2>&1; then
    docker run -d --name "${SONAR_INSTANCE_NAME}" -p "${SONAR_INSTANCE_PORT}:9000" --network "${CLI_NAME}" \
      -v "${SONAR_EXTENSION_DIR}:/opt/sonarqube/extensions/plugins" \
      "${DOCKER_SONAR_SERVER}" > /dev/null 2>&1
  else
    docker start "${SONAR_INSTANCE_NAME}" > /dev/null 2>&1
  fi

  printf "Booting SonarQube docker instance "
  uri_wait "http://localhost:${SONAR_INSTANCE_PORT}" 60
  printf 'Waiting for SonarQube service availability '
  for _ in $(seq 1 180); do
    sleep 1
    printf .
    status_value=$(curl -s "http://localhost:${SONAR_INSTANCE_PORT}/api/system/status" | jq -r '.status')
    if [[ "$status_value" == "UP" ]]; then
      echo
      break
    fi
  done

  status_value=$(curl -s "http://localhost:${SONAR_INSTANCE_PORT}/api/system/status" | jq -r '.status')
  if [[ "$status_value" == "UP" ]]; then
    echo "SonarQube is running"
  else
    docker logs -f "${SONAR_INSTANCE_NAME}"
    echo "SonarQube is NOT running, exiting"
    exit 1
  fi

  curl -s -X POST -u "admin:admin" \
    -d "login=admin&previousPassword=admin&password=Son@rless123" \
    "http://localhost:${SONAR_INSTANCE_PORT}/api/users/change_password"
  echo "Local sonarqube URI: http://localhost:${SONAR_INSTANCE_PORT}"
  echo "Credentials: admin/Son@rless123"
}

function stop() {
  docker stop "${SONAR_INSTANCE_NAME}" > /dev/null 2>&1 && echo "Local SonarQube has been stopped"
}

function scan() {
  start

  curl -s -u "admin:Son@rless123" -X POST "http://localhost:${SONAR_INSTANCE_PORT}/api/projects/create?name=${SONAR_PROJECT_NAME}&project=${SONAR_PROJECT_NAME}" | jq
  curl -s -u "admin:Son@rless123" -X POST "http://localhost:${SONAR_INSTANCE_PORT}/api/users/set_homepage?type=PROJECT&component=${SONAR_PROJECT_NAME}"

  echo "SONAR_GITROOT: ${SONAR_GITROOT}"
  echo "SONAR_SOURCE_PATH: ${SONAR_SOURCE_PATH}"

  SONAR_TOKEN=$(curl -s -X POST -u "admin:Son@rless123" "http://localhost:${SONAR_INSTANCE_PORT}/api/user_tokens/generate?name=$(date +%s%N)" | jq -r .token)
  export SONAR_TOKEN

  docker run --rm --network "${CLI_NAME}" \
    -e SONAR_HOST_URL="http://${SONAR_INSTANCE_NAME}:9000" \
    -e SONAR_TOKEN="${SONAR_TOKEN}" \
    -e SONAR_SCANNER_OPTS="-Dsonar.projectKey=${SONAR_PROJECT_NAME} -Dsonar.sources=${SONAR_SOURCE_PATH} ${SONAR_OPTIONS}" \
    -v "${SONAR_GITROOT}:/usr/src" \
    "${DOCKER_SONAR_CLI}"
  SCAN_RET_CODE="$?"

  if [[ "${SCAN_RET_CODE}" -eq "0" ]]; then
    printf '\nWaiting for analysis '
    for _ in $(seq 1 120); do
      sleep 1
      printf .
      status_value=$(curl -s -u "admin:Son@rless123" "http://localhost:${SONAR_INSTANCE_PORT}/api/qualitygates/project_status?projectKey=${SONAR_PROJECT_NAME}" | jq -r .projectStatus.status)
      if [[ "$status_value" != "NONE" ]]; then
        echo
        echo "SonarQube scanning done"
        break
      fi
    done
  else
    printf '\nSonarQube scanning failed!'
  fi
}

function results() {
  curl -s -u "admin:Son@rless123" "http://localhost:${SONAR_INSTANCE_PORT}/api/measures/component?component=${SONAR_PROJECT_NAME}&metricKeys=bugs,vulnerabilities,code_smells,quality_gate_details,violations,duplicated_lines_density,ncloc,coverage,reliability_rating,security_rating,security_review_rating,sqale_rating,security_hotspots,open_issues" \
    | jq -r > "${SONAR_GITROOT}/${SONAR_METRICS_PATH}"
  cat "${SONAR_GITROOT}/${SONAR_METRICS_PATH}"
  echo "Scan results written to ${SONAR_GITROOT}/${SONAR_METRICS_PATH}"
}

function reindex() {
  curl -X POST -u "admin:Son@rless123" "http://localhost:${SONAR_INSTANCE_PORT}/api/issues/reindex" -d "project=${SONAR_PROJECT_NAME}"
  LOG_FILE="/opt/sonarqube/logs/ce.log"
  PATTERN="Executed task.*type=ISSUE_SYNC.*status=SUCCESS"
  TIMEOUT=300
  COUNT=0

  echo "⏳ Waiting for reindexing..."

  while [ $COUNT -lt $TIMEOUT ]; do
    if docker exec "${SONAR_INSTANCE_NAME}" grep -q "$PATTERN" "$LOG_FILE"; then
      echo "✅ Reindexing completed in logs."
      exit 0
    fi
    sleep 1
    COUNT=$((COUNT + 1))
  done

  echo "⛔ Timeout after $TIMEOUT seconds checking reindexing completion in logs."
}

# ── Docker image cache support ──────────────────────────────────────────────

function docker-cache-load() {
  local cache_dir="${1:-/tmp/docker-cache}"
  if [ -f "$cache_dir/sonarqube.tar" ]; then
    echo "Loading cached SonarQube image..."
    docker load < "$cache_dir/sonarqube.tar"
  fi
  if [ -f "$cache_dir/sonar-scanner.tar" ]; then
    echo "Loading cached Sonar Scanner image..."
    docker load < "$cache_dir/sonar-scanner.tar"
  fi
}

function docker-cache-save() {
  local cache_dir="${1:-/tmp/docker-cache}"
  mkdir -p "$cache_dir"
  if docker image inspect "${DOCKER_SONAR_SERVER}" > /dev/null 2>&1; then
    echo "Saving SonarQube image to cache..."
    docker save "${DOCKER_SONAR_SERVER}" > "$cache_dir/sonarqube.tar"
  fi
  if docker image inspect "${DOCKER_SONAR_CLI}" > /dev/null 2>&1; then
    echo "Saving Sonar Scanner image to cache..."
    docker save "${DOCKER_SONAR_CLI}" > "$cache_dir/sonar-scanner.tar"
  fi
}

function docker-deps-get() {
  ( docker image inspect "${DOCKER_SONAR_SERVER}" > /dev/null 2>&1 || (echo "Downloading SonarQube..."; docker pull "${DOCKER_SONAR_SERVER}" > /dev/null 2>&1) ) &
  ( docker image inspect "${DOCKER_SONAR_CLI}" > /dev/null 2>&1 || (echo "Downloading Sonar CLI..."; docker pull "${DOCKER_SONAR_CLI}" > /dev/null 2>&1) ) &
  wait
  docker network inspect "${CLI_NAME}" > /dev/null 2>&1 || docker network create "${CLI_NAME}" > /dev/null 2>&1
}

function docker-clean() {
  docker rm -f "${SONAR_INSTANCE_NAME}"
  docker image rm -f "${DOCKER_SONAR_CLI}" "${DOCKER_SONAR_SERVER}"
  docker volume prune -f
  docker network rm -f "${CLI_NAME}"
}

"$@"
