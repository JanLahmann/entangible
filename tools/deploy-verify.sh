#!/usr/bin/env bash
# Deploy entangible.org and VERIFY it, in one command.
#
#   tools/deploy-verify.sh            trigger deploy-pocket, watch, verify live hash
#   tools/deploy-verify.sh --watch    don't trigger — watch the latest run, then verify
#   tools/deploy-verify.sh --retries N   auto-retry a failed run N times (default 1)
#
# Codifies the procedure learned the hard way (2026-07-25 GitHub Actions outage):
#   1. trigger the workflow (unless --watch)
#   2. wait for the run's CONCLUSION — never assume success
#   3. on failure, check githubstatus.io Actions component FIRST: an outage means
#      wait-and-retry, not debugging our workflow
#   4. auto-retry once (configurable)
#   5. after success, compare the live bundle hash on entangible.org against the
#      local pocket-app/dist build — deployed means "the bytes users get match
#      what we built", not "the workflow went green"
#
# Exit codes: 0 verified match · 1 deploy failed (after retries) · 2 hash mismatch
# Requires: gh (authenticated), curl. Run from anywhere inside the repo.

set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

WORKFLOW=deploy-pocket
LIVE_URL=https://entangible.org/
LOCAL_INDEX=pocket-app/dist/index.html
PROPAGATION_WAIT=20 # seconds between run success and CDN check
POLL=15             # seconds between run-status polls

retries=1
trigger=1
while [ $# -gt 0 ]; do
  case "$1" in
    --watch) trigger=0 ;;
    --retries) retries="$2"; shift ;;
    *) echo "unknown argument: $1" >&2; exit 64 ;;
  esac
  shift
done

actions_status() {
  curl -sf --max-time 15 https://www.githubstatus.com/api/v2/summary.json 2>/dev/null |
    python3 -c "
import json, sys
try:
    d = json.load(sys.stdin)
    comps = [c for c in d['components'] if c['name'] == 'Actions']
    print(comps[0]['status'] if comps else 'unknown')
except Exception:
    print('unknown')
" || echo unknown
}

run_once() {
  if [ "$trigger" = 1 ]; then
    gh workflow run "$WORKFLOW"
    sleep 8
  fi
  local run_id
  run_id=$(gh run list --workflow "$WORKFLOW" --limit 1 --json databaseId -q '.[0].databaseId')
  echo "watching run $run_id …"
  local status
  while true; do
    status=$(gh run view "$run_id" --json status -q '.status')
    [ "$status" = "completed" ] && break
    sleep "$POLL"
  done
  gh run view "$run_id" --json conclusion -q '.conclusion'
}

attempt=0
while :; do
  conclusion=$(run_once | tail -1)
  echo "run conclusion: $conclusion"
  [ "$conclusion" = "success" ] && break

  gh_actions=$(actions_status)
  if [ "$gh_actions" != "operational" ]; then
    echo "NOTE: GitHub Actions status is '$gh_actions' — likely their outage, not our workflow." >&2
    echo "      https://www.githubstatus.com — retry when Actions recovers." >&2
  fi

  attempt=$((attempt + 1))
  if [ "$attempt" -gt "$retries" ]; then
    echo "deploy FAILED after $attempt attempt(s)" >&2
    exit 1
  fi
  echo "retrying ($attempt/$retries) …"
  trigger=1 # a retry always re-triggers, even in --watch mode
done

sleep "$PROPAGATION_WAIT"
live=$(curl -sf "$LIVE_URL" | grep -o 'assets/index-[^"]*\.js' | head -1 || true)
local_hash=$(grep -o 'assets/index-[^"]*\.js' "$LOCAL_INDEX" | head -1 || true)
echo "live:  ${live:-<none>}"
echo "local: ${local_hash:-<none>}"
if [ -n "$live" ] && [ "$live" = "$local_hash" ]; then
  echo "VERIFIED: entangible.org serves the local build."
  exit 0
fi
echo "HASH MISMATCH — the workflow succeeded but the live bundle differs (CDN lag? stale local dist? run 'npm run build' in pocket-app and compare again)." >&2
exit 2
