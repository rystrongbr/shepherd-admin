#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Phase B + B.5 production smoke test
#
# Run AFTER Steps 1 & 2 of the operational checklist:
#   - Railway env vars set (especially EMAIL_SENDGRID_WEBHOOK_PUBLIC_KEY)
#   - SendGrid Event Webhook configured + Signed Event Webhook ON
#   - Railway redeploy is green
#
# Usage:
#   ADMIN_PASSWORD=<your-railway-admin-password> ./scripts/smoke-test-phase-b5.sh
#
# Or, to also send a real founder digest to admin@barabove.app, set
# EMAIL_AUTOMATION_ENABLED=true in Railway first, then:
#   ADMIN_PASSWORD=<token> SEND_DIGEST=1 ./scripts/smoke-test-phase-b5.sh
# (Remember to flip EMAIL_AUTOMATION_ENABLED back to false after.)
# ─────────────────────────────────────────────────────────────────────────────

set -u  # error on undefined vars; we handle non-zero exit codes manually

BASE_URL="${BASE_URL:-https://admin.myshepherdapp.church}"

if [[ -z "${ADMIN_PASSWORD:-}" ]]; then
  echo "ERROR: ADMIN_PASSWORD env var is required."
  echo "Find it in Railway → Variables → ADMIN_PASSWORD (eye icon to reveal)."
  echo "If never set, the server's default is 'shepherd2026'."
  exit 1
fi

AUTH_HEADER="Authorization: Bearer ${ADMIN_PASSWORD}"

# Color helpers
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
GRAY='\033[0;90m'
NC='\033[0m'

PASS=0
FAIL=0
SKIP=0

print_header() {
  echo ""
  echo -e "${BLUE}━━━ $1 ━━━${NC}"
}

# check_http <name> <expected_status> <curl args...>
check_http() {
  local name="$1"
  local expected="$2"
  shift 2

  local response
  response=$(curl -s -o /tmp/smoke-body.txt -w "%{http_code}" "$@" 2>&1)
  local got="$response"

  if [[ "$got" == "$expected" ]]; then
    echo -e "  ${GREEN}✓${NC} ${name} → ${got}"
    PASS=$((PASS + 1))
    return 0
  else
    echo -e "  ${RED}✗${NC} ${name} → ${got} (expected ${expected})"
    echo -e "  ${GRAY}response body:${NC}"
    head -c 500 /tmp/smoke-body.txt | sed 's/^/    /'
    echo ""
    FAIL=$((FAIL + 1))
    return 1
  fi
}

# json_get <path>
json_get() {
  python3 -c "import sys, json; d=json.load(open('/tmp/smoke-body.txt')); print(d.get('$1', ''))" 2>/dev/null
}

echo -e "${BLUE}Phase B + B.5 production smoke test${NC}"
echo -e "${GRAY}Base URL: ${BASE_URL}${NC}"
echo -e "${GRAY}Token:    Bearer ****${ADMIN_PASSWORD: -4}${NC}"

# ─── 1. Health check (no auth) ───────────────────────────────────────────────
print_header "1. Health check"
check_http "GET /api/health" "200" -X GET "${BASE_URL}/api/health"

# ─── 2. Auth (without token should 401) ──────────────────────────────────────
print_header "2. Auth gate"
check_http "GET /api/email/status without auth" "401" \
  -X GET "${BASE_URL}/api/email/status"

# ─── 3. Email status with auth ───────────────────────────────────────────────
print_header "3. Email module status"
if check_http "GET /api/email/status" "200" \
  -X GET "${BASE_URL}/api/email/status" \
  -H "${AUTH_HEADER}"; then

  echo ""
  echo -e "  ${GRAY}status summary:${NC}"
  python3 <<'PY'
import json
try:
    d = json.load(open("/tmp/smoke-body.txt"))
    print(f"    automationEnabled:           {d.get('automationEnabled')}")
    print(f"    dryRun:                      {d.get('dryRun')}")
    print(f"    deactivationRestoreEnabled:  {d.get('deactivationRestoreEnabled')}")
    fd = d.get("founderDigest", {})
    if fd:
        print(f"    founderDigest.to:            {fd.get('to')}")
        print(f"    founderDigest.cronSchedule:  {fd.get('cronSchedule')}")
        print(f"    founderDigest.cronTz:        {fd.get('cronTz')}")
    crons = d.get("crons", [])
    if crons:
        print(f"    registered crons:            {len(crons)}")
        for c in crons:
            print(f"      - {c.get('name','?')}: {c.get('schedule','?')} ({c.get('tz','?')})")
except Exception as e:
    print(f"    (could not parse: {e})")
PY
fi

# ─── 4. Deactivations list endpoint ──────────────────────────────────────────
print_header "4. Deactivations dashboard data"
if check_http "GET /api/email/deactivations" "200" \
  -X GET "${BASE_URL}/api/email/deactivations?limit=10" \
  -H "${AUTH_HEADER}"; then

  python3 <<'PY'
import json
try:
    d = json.load(open("/tmp/smoke-body.txt"))
    s = d.get("summary", {})
    print(f"    restoreEnabled:        {d.get('restoreEnabled')}")
    print(f"    summary.newInWindow:   {s.get('newInWindow')}")
    print(f"    summary.donorsInWindow: {s.get('donorsInWindow')}")
    print(f"    summary.totalBacklog:  {s.get('totalBacklog')}")
    print(f"    rows returned:         {len(d.get('rows', []))}")
except Exception as e:
    print(f"    (could not parse: {e})")
PY
fi

# ─── 5. Founder digest preview (renders, does not send) ──────────────────────
print_header "5. Founder digest preview (no email sent)"
if check_http "POST /api/email/founder-digest/preview" "200" \
  -X POST "${BASE_URL}/api/email/founder-digest/preview" \
  -H "${AUTH_HEADER}" \
  -H "Content-Type: application/json" \
  --data '{}'; then

  python3 <<'PY'
import json
try:
    d = json.load(open("/tmp/smoke-body.txt"))
    subject = d.get("subject", "")
    html = d.get("html", "") or ""
    print(f"    subject: {subject}")
    print(f"    html bytes: {len(html)}")
except Exception as e:
    print(f"    (could not parse: {e})")
PY

  # Save the HTML to a file so the user can preview it locally
  python3 -c "
import json
d = json.load(open('/tmp/smoke-body.txt'))
open('/tmp/founder-digest-preview.html','w').write(d.get('html',''))
" 2>/dev/null && echo -e "  ${GRAY}preview HTML saved to /tmp/founder-digest-preview.html${NC}"
fi

# ─── 6. Restore button gating ────────────────────────────────────────────────
print_header "6. Restore gating (should be disabled by default)"
# Try restoring member id 999999 — should get either 409 (restore_disabled)
# or 404 (not_found). 409 means the gate is enforcing; 404 means the gate
# is OFF (restore is enabled). Either is structurally valid, but 409 is
# the expected default.
RESTORE_CODE=$(curl -s -o /tmp/smoke-body.txt -w "%{http_code}" \
  -X POST "${BASE_URL}/api/email/deactivations/999999/restore" \
  -H "${AUTH_HEADER}" \
  -H "Content-Type: application/json" \
  --data '{"note":"smoke test"}')

if [[ "$RESTORE_CODE" == "409" ]]; then
  REASON=$(python3 -c "import json; print(json.load(open('/tmp/smoke-body.txt')).get('reason',''))" 2>/dev/null)
  if [[ "$REASON" == "restore_disabled" ]]; then
    echo -e "  ${GREEN}✓${NC} Restore is gated OFF (EMAIL_DEACTIVATION_RESTORE_ENABLED=false) → 409 restore_disabled"
    PASS=$((PASS + 1))
  else
    echo -e "  ${YELLOW}!${NC} Restore returned 409 but reason=${REASON} (expected restore_disabled)"
    FAIL=$((FAIL + 1))
  fi
elif [[ "$RESTORE_CODE" == "404" ]]; then
  echo -e "  ${YELLOW}!${NC} Restore is ENABLED (EMAIL_DEACTIVATION_RESTORE_ENABLED=true) → 404 not_found for fake id 999999"
  echo -e "  ${YELLOW}  ${NC} This is fine if you intentionally turned it on. Otherwise flip the env flag back to false."
  PASS=$((PASS + 1))
else
  echo -e "  ${RED}✗${NC} Unexpected status ${RESTORE_CODE} from restore endpoint"
  head -c 300 /tmp/smoke-body.txt | sed 's/^/    /'
  echo ""
  FAIL=$((FAIL + 1))
fi

# ─── 7. Donor recompute (manual) ─────────────────────────────────────────────
print_header "7. Donor flag recompute"
if check_http "POST /api/email/donors/recompute" "200" \
  -X POST "${BASE_URL}/api/email/donors/recompute" \
  -H "${AUTH_HEADER}" \
  -H "Content-Type: application/json" \
  --data '{}'; then

  python3 <<'PY'
import json
try:
    d = json.load(open("/tmp/smoke-body.txt"))
    print(f"    updated: {d.get('updated', '?')} members")
except Exception:
    pass
PY
fi

# ─── 8. Founder digest send (optional, behind SEND_DIGEST=1) ─────────────────
print_header "8. Founder digest send"
if [[ "${SEND_DIGEST:-0}" == "1" ]]; then
  echo -e "  ${YELLOW}!${NC} SEND_DIGEST=1 set — this will send a REAL email to admin@barabove.app"
  RUN_CODE=$(curl -s -o /tmp/smoke-body.txt -w "%{http_code}" \
    -X POST "${BASE_URL}/api/email/founder-digest/run" \
    -H "${AUTH_HEADER}" \
    -H "Content-Type: application/json" \
    --data '{}')

  if [[ "$RUN_CODE" == "200" ]]; then
    echo -e "  ${GREEN}✓${NC} Digest sent → check admin@barabove.app inbox"
    PASS=$((PASS + 1))
    python3 <<'PY'
import json
try:
    d = json.load(open("/tmp/smoke-body.txt"))
    print(f"    sentTo: {d.get('sentTo')}")
    print(f"    ran:    {d.get('ran')}")
except Exception:
    pass
PY
  elif [[ "$RUN_CODE" == "409" ]]; then
    REASON=$(python3 -c "import json; print(json.load(open('/tmp/smoke-body.txt')).get('reason',''))" 2>/dev/null)
    echo -e "  ${YELLOW}!${NC} Digest blocked → 409 (reason=${REASON})"
    echo -e "  ${YELLOW}  ${NC} This usually means EMAIL_AUTOMATION_ENABLED=false. Flip it to true in Railway, then retry."
    SKIP=$((SKIP + 1))
  else
    echo -e "  ${RED}✗${NC} Unexpected ${RUN_CODE} from digest run"
    head -c 300 /tmp/smoke-body.txt | sed 's/^/    /'
    echo ""
    FAIL=$((FAIL + 1))
  fi
else
  echo -e "  ${GRAY}skipped (set SEND_DIGEST=1 to actually send a digest to admin@barabove.app)${NC}"
  SKIP=$((SKIP + 1))
fi

# ─── Final summary ───────────────────────────────────────────────────────────
echo ""
echo -e "${BLUE}━━━ Summary ━━━${NC}"
echo -e "  ${GREEN}✓ passed:  ${PASS}${NC}"
echo -e "  ${RED}✗ failed:  ${FAIL}${NC}"
echo -e "  ${GRAY}- skipped: ${SKIP}${NC}"
echo ""

if [[ "$FAIL" -gt 0 ]]; then
  echo -e "${RED}Some checks failed. Inspect the responses above.${NC}"
  exit 1
fi

echo -e "${GREEN}All checks passed.${NC}"
echo ""
echo "Next steps:"
echo "  1. Open /tmp/founder-digest-preview.html in a browser to eyeball the digest HTML"
echo "  2. Visit ${BASE_URL}/#/deactivations to confirm the dashboard loads"
echo "  3. Send a SendGrid Event Webhook test from the SendGrid dashboard"
echo "     and watch Railway logs for: [email/webhook] received N events"
echo "  4. When ready to arm: set EMAIL_AUTOMATION_ENABLED=true in Railway"
