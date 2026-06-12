#!/usr/bin/env bash
# =============================================================================
# AIpbx — Health Check Script
# =============================================================================
# Checks the health of all AIpbx services and exits 0 only if all pass.
#
# Usage:
#   bash healthcheck.sh           # human-readable output
#   bash healthcheck.sh --json    # JSON output for monitoring systems
#
# Exit codes:
#   0 — all services healthy
#   1 — one or more services unhealthy
# =============================================================================
set -euo pipefail

# -----------------------------------------------------------------------------
# Load .env for Redis password
# -----------------------------------------------------------------------------
DEPLOY_DIR="${DEPLOY_DIR:-/opt/aipbx}"
ENV_FILE="${DEPLOY_DIR}/.env"

if [[ -f "${ENV_FILE}" ]]; then
    # shellcheck disable=SC1090
    set -a; source "${ENV_FILE}"; set +a
fi

REDIS_PASSWORD="${REDIS_PASSWORD:-}"

# -----------------------------------------------------------------------------
# Flags
# -----------------------------------------------------------------------------
JSON_OUTPUT=false
for arg in "$@"; do
    case "${arg}" in
        --json) JSON_OUTPUT=true ;;
    esac
done

# -----------------------------------------------------------------------------
# Color helpers (disabled when --json or non-interactive)
# -----------------------------------------------------------------------------
if [[ "${JSON_OUTPUT}" == "false" ]] && [[ -t 1 ]]; then
    GREEN='\033[0;32m'
    RED='\033[0;31m'
    YELLOW='\033[0;33m'
    NC='\033[0m'
else
    GREEN=''
    RED=''
    YELLOW=''
    NC=''
fi

# -----------------------------------------------------------------------------
# State tracking
# -----------------------------------------------------------------------------
declare -A CHECK_STATUS   # service → "ok" | "fail"
declare -A CHECK_MESSAGE  # service → detail message
OVERALL_OK=true

# -----------------------------------------------------------------------------
# Helpers
# -----------------------------------------------------------------------------
check_pass() {
    local name="$1"
    local msg="${2:-}"
    CHECK_STATUS["${name}"]="ok"
    CHECK_MESSAGE["${name}"]="${msg}"
    if [[ "${JSON_OUTPUT}" == "false" ]]; then
        printf "  ${GREEN}OK${NC}   %-20s %s\n" "${name}" "${msg}"
    fi
}

check_fail() {
    local name="$1"
    local msg="${2:-}"
    CHECK_STATUS["${name}"]="fail"
    CHECK_MESSAGE["${name}"]="${msg}"
    OVERALL_OK=false
    if [[ "${JSON_OUTPUT}" == "false" ]]; then
        printf "  ${RED}FAIL${NC} %-20s %s\n" "${name}" "${msg}"
    fi
}

# Run a command; return its stdout. On error, return empty string.
run_check() {
    local output
    output=$(eval "$1" 2>/dev/null) && echo "${output}" || echo ""
}

# -----------------------------------------------------------------------------
# Individual checks
# -----------------------------------------------------------------------------

# 1. API (Node.js REST service)
check_api() {
    local url="http://localhost:3000/healthz"
    local response
    response=$(curl -sf --max-time 5 "${url}" 2>/dev/null || echo "")
    if [[ -n "${response}" ]]; then
        check_pass "api" "HTTP 200 from ${url}"
    else
        check_fail "api" "No response from ${url}"
    fi
}

# 2. AI Engine (Python gRPC/HTTP service)
check_ai_engine() {
    local url="http://localhost:8080/healthz"
    local response
    response=$(curl -sf --max-time 5 "${url}" 2>/dev/null || echo "")
    if [[ -n "${response}" ]]; then
        check_pass "ai-engine" "HTTP 200 from ${url}"
    else
        check_fail "ai-engine" "No response from ${url}"
    fi
}

# 3. Asterisk (check version via CLI)
check_asterisk() {
    cd "${DEPLOY_DIR}"
    local output
    output=$(docker compose exec -T asterisk asterisk -rx "core show version" 2>/dev/null | head -1 || echo "")
    if echo "${output}" | grep -qi "asterisk"; then
        check_pass "asterisk" "${output}"
    else
        check_fail "asterisk" "No response from Asterisk CLI (container may be down)"
    fi
}

# 4. PostgreSQL
check_postgres() {
    cd "${DEPLOY_DIR}"
    local output
    output=$(docker compose exec -T postgres pg_isready 2>/dev/null || echo "")
    if echo "${output}" | grep -q "accepting connections"; then
        check_pass "postgres" "${output}"
    else
        check_fail "postgres" "pg_isready failed: ${output}"
    fi
}

# 5. Redis
check_redis() {
    cd "${DEPLOY_DIR}"
    local output
    if [[ -n "${REDIS_PASSWORD}" ]]; then
        output=$(docker compose exec -T redis redis-cli -a "${REDIS_PASSWORD}" ping 2>/dev/null || echo "")
    else
        output=$(docker compose exec -T redis redis-cli ping 2>/dev/null || echo "")
    fi

    if [[ "${output}" == "PONG" ]]; then
        check_pass "redis" "PONG"
    else
        check_fail "redis" "redis-cli ping returned: '${output}'"
    fi
}

# 6. nginx (check it's running and serving HTTP)
check_nginx() {
    cd "${DEPLOY_DIR}"
    # Check container is running
    local status
    status=$(docker compose ps --status running --services 2>/dev/null | grep "^nginx" || echo "")
    if [[ -n "${status}" ]]; then
        # Also verify it responds to HTTP (the 301 redirect is a healthy response)
        local http_code
        http_code=$(curl -o /dev/null -sw "%{http_code}" --max-time 5 "http://localhost:80/" 2>/dev/null || echo "")
        if [[ "${http_code}" == "301" ]] || [[ "${http_code}" == "200" ]]; then
            check_pass "nginx" "Container running, HTTP ${http_code}"
        else
            check_pass "nginx" "Container running (HTTP code: ${http_code:-no response})"
        fi
    else
        check_fail "nginx" "nginx container is not running"
    fi
}

# -----------------------------------------------------------------------------
# JSON output
# -----------------------------------------------------------------------------
output_json() {
    local timestamp
    timestamp=$(date -u '+%Y-%m-%dT%H:%M:%SZ')
    local overall
    overall=$( [[ "${OVERALL_OK}" == "true" ]] && echo "healthy" || echo "unhealthy" )

    echo "{"
    echo "  \"timestamp\": \"${timestamp}\","
    echo "  \"overall\": \"${overall}\","
    echo "  \"checks\": {"

    local first=true
    for name in api ai-engine asterisk postgres redis nginx; do
        if [[ "${first}" == "false" ]]; then echo ","; fi
        first=false
        local status="${CHECK_STATUS[${name}]:-unknown}"
        local message="${CHECK_MESSAGE[${name}]:-}"
        # Escape quotes in message
        message="${message//\"/\\\"}"
        printf "    \"%s\": {\"status\": \"%s\", \"message\": \"%s\"}" \
            "${name}" "${status}" "${message}"
    done

    echo ""
    echo "  }"
    echo "}"
}

# -----------------------------------------------------------------------------
# Main
# -----------------------------------------------------------------------------
main() {
    if [[ "${JSON_OUTPUT}" == "false" ]]; then
        echo ""
        echo "  AIpbx Health Check — $(date -u '+%Y-%m-%dT%H:%M:%SZ')"
        echo "  ──────────────────────────────────────────────────────"
    fi

    check_api
    check_ai_engine
    check_asterisk
    check_postgres
    check_redis
    check_nginx

    if [[ "${JSON_OUTPUT}" == "true" ]]; then
        output_json
    else
        echo "  ──────────────────────────────────────────────────────"
        if [[ "${OVERALL_OK}" == "true" ]]; then
            printf "  ${GREEN}All checks passed.${NC}\n"
        else
            printf "  ${RED}One or more checks failed.${NC}\n"
        fi
        echo ""
    fi

    [[ "${OVERALL_OK}" == "true" ]] && exit 0 || exit 1
}

main "$@"
