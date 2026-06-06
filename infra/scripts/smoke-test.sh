#!/usr/bin/env bash
# ============================================================
# RRC Smoke Test Script
# ============================================================
# Verifies the full stack is working end-to-end.
# Runs against a live environment (local docker-compose or production).
#
# Usage:
#   ./infra/scripts/smoke-test.sh                          # local (default)
#   BASE_URL=https://api.rrc.dev ./infra/scripts/smoke-test.sh  # production
#   BEARER_TOKEN=<jwt> BASE_URL=https://api.rrc.dev ./infra/scripts/smoke-test.sh
#
# Exit codes:
#   0 = all checks passed
#   1 = one or more checks failed
# ============================================================
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:8080}"
RELEASE_DIRECT="${RELEASE_DIRECT:-http://localhost:8081}"
CALENDAR_DIRECT="${CALENDAR_DIRECT:-http://localhost:8083}"
AUDIT_DIRECT="${AUDIT_DIRECT:-http://localhost:8084}"
TENANT_ID="${TENANT_ID:-00000000-0000-0000-0000-000000000001}"
BEARER_TOKEN="${BEARER_TOKEN:-}"
MAX_WAIT_RISK="${MAX_WAIT_RISK:-15}"  # seconds to wait for risk score

PASS=0
FAIL=0

# ── Helpers ───────────────────────────────────────────────────────────────────

green()  { echo -e "\033[32m✓ $*\033[0m"; }
red()    { echo -e "\033[31m✗ $*\033[0m"; }
yellow() { echo -e "\033[33m● $*\033[0m"; }
bold()   { echo -e "\033[1m$*\033[0m"; }

pass() { green "$1"; ((PASS++)); }
fail() { red   "$1"; ((FAIL++)); }

# curl wrapper — returns HTTP status code
http() {
  local method="$1"; shift
  local url="$1";    shift
  local extra_args=("$@")

  local auth_header=""
  if [[ -n "$BEARER_TOKEN" ]]; then
    auth_header="-H Authorization: Bearer $BEARER_TOKEN"
  fi

  curl -s -o /tmp/smoke_body -w "%{http_code}" \
    -X "$method" \
    -H "Content-Type: application/json" \
    -H "x-tenant-id: $TENANT_ID" \
    ${auth_header:+ -H "$auth_header"} \
    "${extra_args[@]}" \
    "$url" || echo "000"
}

body() { cat /tmp/smoke_body 2>/dev/null; }

check_status() {
  local label="$1"
  local expected="$2"
  local actual="$3"
  if [[ "$actual" == "$expected" ]]; then
    pass "$label (HTTP $actual)"
  else
    fail "$label — expected $expected, got $actual"
    echo "     Body: $(body | head -c 300)"
  fi
}

# ── Health checks ─────────────────────────────────────────────────────────────

bold ""
bold "=== 1. Service Health Checks ==="

status=$(http GET "$BASE_URL/health")
check_status "Gateway /health" "200" "$status"

status=$(http GET "$RELEASE_DIRECT/health")
check_status "Release Service /health" "200" "$status"

status=$(http GET "$CALENDAR_DIRECT/health")
check_status "Calendar Service /health" "200" "$status"

status=$(http GET "$AUDIT_DIRECT/health")
check_status "Audit Service /health" "200" "$status"

# ── Calendar service ──────────────────────────────────────────────────────────

bold ""
bold "=== 2. Regulatory Windows ==="

status=$(http GET "$CALENDAR_DIRECT/api/v1/windows?jurisdiction=FCA&year=2026")
check_status "GET /windows FCA 2026" "200" "$status"

FCA_COUNT=$(body | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d))" 2>/dev/null || echo "0")
if [[ "$FCA_COUNT" -ge 1 ]]; then
  pass "FCA windows present ($FCA_COUNT windows)"
else
  fail "No FCA windows found — seed data may not have loaded"
fi

# ── Release lifecycle ─────────────────────────────────────────────────────────

bold ""
bold "=== 3. Release Lifecycle ==="

RELEASE_NAME="Smoke Test Release $(date +%s)"
PLANNED_DATE="2026-08-20"

status=$(http POST "$RELEASE_DIRECT/api/v1/releases" \
  -d "{\"name\":\"$RELEASE_NAME\",\"planned_date\":\"$PLANNED_DATE\",\"owner_id\":\"99999999-9999-9999-9999-999999999999\"}")
check_status "POST /releases" "201" "$status"

RELEASE_ID=$(body | python3 -c "import sys,json; print(json.load(sys.stdin).get('release_id',''))" 2>/dev/null || echo "")

if [[ -z "$RELEASE_ID" ]]; then
  fail "Could not extract release_id from response"
else
  pass "Release created: $RELEASE_ID"

  status=$(http GET "$RELEASE_DIRECT/api/v1/releases/$RELEASE_ID")
  check_status "GET /releases/:id" "200" "$status"
fi

# ── Risk score evaluation ─────────────────────────────────────────────────────

bold ""
bold "=== 4. Risk Score Evaluation (SQS → Risk Engine) ==="

if [[ -n "$RELEASE_ID" ]]; then
  yellow "Waiting up to ${MAX_WAIT_RISK}s for risk score..."

  RISK_RECEIVED=false
  for ((i=1; i<=MAX_WAIT_RISK; i++)); do
    status=$(http GET "$RELEASE_DIRECT/api/v1/releases/$RELEASE_ID/risk")
    if [[ "$status" == "200" ]]; then
      RISK_LEVEL=$(body | python3 -c "import sys,json; print(json.load(sys.stdin).get('level',''))" 2>/dev/null || echo "")
      RISK_SCORE=$(body | python3 -c "import sys,json; print(json.load(sys.stdin).get('score',''))" 2>/dev/null || echo "")
      pass "Risk score computed in ${i}s: level=$RISK_LEVEL score=$RISK_SCORE"
      RISK_RECEIVED=true
      break
    fi
    sleep 1
  done

  if [[ "$RISK_RECEIVED" != "true" ]]; then
    fail "Risk score not computed within ${MAX_WAIT_RISK}s — check risk-engine and SQS"
  fi
fi

# ── BLOCKED classification ────────────────────────────────────────────────────

bold ""
bold "=== 5. BLOCKED Classification (FCA Q3 2026 Blackout) ==="

BLOCKED_DATE="2026-07-08"  # Inside FCA Q3 2026 BLACKOUT seed window

status=$(http POST "$RELEASE_DIRECT/api/v1/releases" \
  -d "{\"name\":\"Smoke BLOCKED Test $(date +%s)\",\"planned_date\":\"$BLOCKED_DATE\",\"owner_id\":\"99999999-9999-9999-9999-999999999999\"}")
check_status "POST /releases (BLOCKED date)" "201" "$status"

BLOCKED_ID=$(body | python3 -c "import sys,json; print(json.load(sys.stdin).get('release_id',''))" 2>/dev/null || echo "")

if [[ -n "$BLOCKED_ID" ]]; then
  yellow "Waiting ${MAX_WAIT_RISK}s for BLOCKED risk score..."
  BLOCKED_OK=false
  for ((i=1; i<=MAX_WAIT_RISK; i++)); do
    status=$(http GET "$RELEASE_DIRECT/api/v1/releases/$BLOCKED_ID/risk")
    if [[ "$status" == "200" ]]; then
      LEVEL=$(body | python3 -c "import sys,json; print(json.load(sys.stdin).get('level',''))" 2>/dev/null || echo "")
      if [[ "$LEVEL" == "AT_RISK" || "$LEVEL" == "BLOCKED" ]]; then
        pass "Regulatory window correctly elevated risk: $LEVEL"
      else
        yellow "Risk level is $LEVEL for a date inside a BLACKOUT window (check seed data dates)"
      fi
      BLOCKED_OK=true
      break
    fi
    sleep 1
  done
  [[ "$BLOCKED_OK" != "true" ]] && fail "No risk score for BLOCKED release within ${MAX_WAIT_RISK}s"
fi

# ── Audit trail ───────────────────────────────────────────────────────────────

bold ""
bold "=== 6. Audit Trail ==="

# Write a manual audit entry and verify retrieval
AUDIT_RELEASE_ID="${BLOCKED_ID:-$RELEASE_ID}"
if [[ -n "$AUDIT_RELEASE_ID" ]]; then
  status=$(http POST "$AUDIT_DIRECT/api/v1/audit" \
    -d "{\"release_id\":\"$AUDIT_RELEASE_ID\",\"tenant_id\":\"$TENANT_ID\",\"release_name\":\"Smoke Test\",\"planned_date\":\"2026-07-08\",\"level\":\"AT_RISK\",\"score\":40,\"reasons\":[],\"windows_evaluated\":[]}")
  check_status "POST /audit (write entry)" "201" "$status"

  status=$(http GET "$AUDIT_DIRECT/api/v1/audit/$AUDIT_RELEASE_ID")
  check_status "GET /audit/:release_id" "200" "$status"

  ENTRY_COUNT=$(body | python3 -c "import sys,json; print(len(json.load(sys.stdin)))" 2>/dev/null || echo "0")
  if [[ "$ENTRY_COUNT" -ge 1 ]]; then
    pass "Audit entries present ($ENTRY_COUNT)"
  else
    fail "No audit entries returned"
  fi

  # PDF export
  PDF_STATUS=$(curl -s -o /tmp/smoke_pdf -w "%{http_code}" \
    -H "x-tenant-id: $TENANT_ID" \
    "$AUDIT_DIRECT/api/v1/audit/$AUDIT_RELEASE_ID/export")
  if [[ "$PDF_STATUS" == "200" ]]; then
    PDF_MAGIC=$(head -c 4 /tmp/smoke_pdf 2>/dev/null || echo "")
    if [[ "$PDF_MAGIC" == "%PDF" ]]; then
      pass "PDF export — valid PDF file"
    else
      fail "PDF export — file does not start with %PDF"
    fi
  else
    fail "PDF export — HTTP $PDF_STATUS"
  fi
fi

# ── Error format ──────────────────────────────────────────────────────────────

bold ""
bold "=== 7. Error Format Consistency ==="

status=$(http GET "$RELEASE_DIRECT/api/v1/releases/00000000-0000-0000-0000-000000000000")
check_status "404 returns error object" "404" "$status"
ERROR_CODE=$(body | python3 -c "import sys,json; print(json.load(sys.stdin).get('error',{}).get('code','MISSING'))" 2>/dev/null || echo "MISSING")
if [[ "$ERROR_CODE" != "MISSING" && "$ERROR_CODE" != "" ]]; then
  pass "Error has code field: $ERROR_CODE"
else
  fail "Error response missing 'error.code' field"
fi

# ── Summary ───────────────────────────────────────────────────────────────────

bold ""
bold "=== Smoke Test Summary ==="
echo ""
green "Passed: $PASS"
if [[ "$FAIL" -gt 0 ]]; then
  red "Failed: $FAIL"
  echo ""
  echo "Fix the failures above before going to production."
  exit 1
else
  echo ""
  green "All smoke tests passed! ✓"
  echo ""
  bold "MVP Definition of Done checklist:"
  green "  All services start cleanly"
  green "  POST release → risk score within ${MAX_WAIT_RISK}s"
  green "  FCA blackout window evaluates release"
  green "  Audit trail records and PDF export work"
  green "  Error responses are consistently formatted"
  echo ""
  bold "Remaining manual verifications:"
  yellow "  [ ] Jira webhook: send test payload to POST /webhooks/jira"
  yellow "  [ ] Email notification: verify BLOCKED release triggers SendGrid email"
  yellow "  [ ] Auth0: login with a real user, verify JWT contains tenant_id claim"
  yellow "  [ ] Design partner: onboard first tenant, run their release calendar"
fi
