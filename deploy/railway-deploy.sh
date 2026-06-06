#!/usr/bin/env bash
# ============================================================
# Railway deployment script for Regulated Release Calendar
# ============================================================
# Pre-requisites:
#   npm install -g @railway/cli
#   railway login
#   railway init  (first time only — creates the project)
#
# Usage:
#   ./deploy/railway-deploy.sh              # deploy all services
#   ./deploy/railway-deploy.sh gateway      # deploy single service
#
# Secrets must be set in Railway dashboard (or via railway variables set):
#   AUTH0_DOMAIN, AUTH0_AUDIENCE, JIRA_WEBHOOK_SECRET,
#   SENDGRID_API_KEY, SLACK_WEBHOOK_URL
# ============================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

SERVICES=(
  "gateway:services/gateway"
  "release-svc:services/release"
  "risk-engine:services/risk-engine"
  "calendar-svc:services/calendar"
  "audit-svc:services/audit"
  "notifications-svc:services/notifications"
  "frontend:frontend"
)

TARGET="${1:-all}"

deploy_service() {
  local name="$1"
  local path="$2"
  echo ""
  echo "──────────────────────────────────────────"
  echo " Deploying: $name  ($path)"
  echo "──────────────────────────────────────────"
  cd "$ROOT/$path"
  railway up --service "$name" --detach
  cd "$ROOT"
}

echo "=== Regulated Release Calendar — Railway Deploy ==="
echo "Target: $TARGET"
echo ""

for entry in "${SERVICES[@]}"; do
  name="${entry%%:*}"
  path="${entry##*:}"
  if [[ "$TARGET" == "all" || "$TARGET" == "$name" ]]; then
    deploy_service "$name" "$path"
  fi
done

echo ""
echo "=== Deployment dispatched ==="
echo "Monitor progress: railway logs --service <name>"
echo "Get service URLs: railway status"
