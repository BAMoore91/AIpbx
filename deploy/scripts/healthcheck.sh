#!/usr/bin/env bash
# =============================================================================
# AIpbx — Service health check
#
# Checks all AIpbx services and exits 0 if all are healthy, 1 if any fail.
#
# Usage:
#   bash healthcheck.sh            # human-readable output
#   bash healthcheck.sh --json     # JSON output for monitoring systems
#
# Optional env:
#   DEPLOY_DIR     — repo root (default: /opt/aipbx)
#   REDIS_PASSWORD — for Redis ping check (loaded from .env if available)
# =============================================================================
set -euo pipefail

DEPLOY_DIR="${DEPLOY_DIR:-/opt/aipbx}"

# Load .env for REDIS_PASSWORD etc.
if [[ -f "${DEPLOY_DIR}/.env" ]]; then
    # shellcheck disable=SC1090
    set -a; source "${DEPLOY_DIR}/.env"; set +a
fi

REDIS_PASSWORD="${REDIS_PASSWORD:-}"
JSON_OUTPUT=0
[[ "${1:-}" == "--json" ]] && JSON_OUTPUT=1

# Colors (disabled in JSON mode or non-tty)
if [[ "${JSON_OUTPUT}" -eq 0 ]] && [[ -t 1 ]]; then
    RED='\033[0;31m'
    GREEN='\033[0;32m'
    YELLOW='\033[1;33m'
    NC='\033[0m'
else
    RED=''; GREEN=''; YELLOW=''; NC=''
fi

# Track overall status
OVERALL=0
declare -A RESULTS
declare -A DETAILS

check() {
    local name="$1"; shift
    local result
    if result=$("$@" 2>&1); then
        RESULTS["${name}"]="ok"
        DETAILS["${name}"]="${result:-healthy}"
    else
        RESULTS["${name}"]="fail"
        DETAILS["${name}"]="${result:-check failed}"
        OVERALL=1
    fi
}

print_status() {
    local name="$1"
    local status="${RESULTS[$name]}"
    local detail="${DETAILS[$name]}"
    if [[ "${status}" == "ok" ]]; then
        echo -e "  ${GREEN}[OK]${NC}   ${name}: ${detail}"
    else
        echo -e "  ${RED}[FAIL]${NC} ${name}: ${detail}"
    fi
}

# ---------------------------------------------------------------------------
# Individual checks
# ---------------------------------------------------------------------------

check_api() {
    local response
    response=$(curl -sf --max-time 5 http://localhost:3000/healthz 2>&1) || \
    response=$(curl -sf --max-time 5 http://api:3000/healthz 2>&1)
    echo "${response}" | head -c 100
}

check_ai_engine() {
    local response
    response=$(curl -sf --max-time 5 http://localhost:8080/healthz 2>&1) || \
    response=$(curl -sf --max-time 5 http://ai-engine:8080/healthz 2>&1)
    echo "${response}" | head -c 100
}

check_asterisk() {
    cd "${DEPLOY_DIR}"
    local version
    version=$(docker compose exec -T asterisk asterisk -rx "core show version" 2>&1 | head -1)
    echo "${version}"
}

check_postgres() {
    cd "${DEPLOY_DIR}"
    docker compose exec -T postgres pg_isready \
        -U "${POSTGRES_USER:-aipbx}" \
        -d "${POSTGRES_DB:-aipbx}" \
        2>&1
}

check_redis() {
    cd "${DEPLOY_DIR}"
    local pong
    if [[ -n "${REDIS_PASSWORD}" ]]; then
        pong=$(docker compose exec -T redis redis-cli -a "${REDIS_PASSWORD}" ping 2>&1)
    else
        pong=$(docker compose exec -T redis redis-cli ping 2>&1)
    fi
    echo "${pong}"
}

check_nginx() {
    cd "${DEPLOY_DIR}"
    docker compose exec -T nginx nginx -t 2>&1 | grep -c "successful" | xargs -I{} echo "nginx config OK"
}

# ---------------------------------------------------------------------------
# Run all checks
# ---------------------------------------------------------------------------
run_checks() {
    check "api"        check_api
    check "ai-engine"  check_ai_engine
    check "asterisk"   check_asterisk
    check "postgres"   check_postgres
    check "redis"      check_redis
    check "nginx"      check_nginx
}

# ---------------------------------------------------------------------------
# Output
# ---------------------------------------------------------------------------
output_human() {
    local ts
    ts=$(date -u '+%Y-%m-%dT%H:%M:%SZ')
    echo ""
    echo "  AIpbx Health Check — ${ts}"
    echo "  ----------------------------------------"
    for svc in api ai-engine asterisk postgres redis nginx; do
        print_status "${svc}"
    done
    echo "  ----------------------------------------"
    if [[ "${OVERALL}" -eq 0 ]]; then
        echo -e "  ${GREEN}All services healthy.${NC}"
    else
        echo -e "  ${RED}One or more services are unhealthy.${NC}"
    fi
    echo ""
}

output_json() {
    local ts
    ts=$(date -u '+%Y-%m-%dT%H:%M:%SZ')
    local overall_str
    overall_str=$([[ "${OVERALL}" -eq 0 ]] && echo "ok" || echo "fail")

    printf '{\n  "timestamp": "%s",\n  "status": "%s",\n  "services": {\n' \
        "${ts}" "${overall_str}"

    local first=1
    for svc in api ai-engine asterisk postgres redis nginx; do
        [[ "${first}" -eq 0 ]] && printf ',\n'
        # Escape double-quotes in detail
        local detail
        detail="${DETAILS[$svc]//\"/\\\"}"
        printf '    "%s": {"status": "%s", "detail": "%s"}' \
            "${svc}" "${RESULTS[$svc]}" "${detail}"
        first=0
    done

    printf '\n  }\n}\n'
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
run_checks

if [[ "${JSON_OUTPUT}" -eq 1 ]]; then
    output_json
else
    output_human
fi

exit "${OVERALL}"
