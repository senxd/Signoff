#!/usr/bin/env bash
set -euo pipefail

CONTROL_ENV="${SIGNOFF_CONTROL_ENV:-/opt/signoff/secrets/control.env}"
APP_DIR="${SIGNOFF_APP_DIR:-/opt/signoff/app}"
VENV="${SIGNOFF_VENV:-/opt/signoff/agentverse/.venv/bin/python}"
AGENT_MAILBOX="${AGENT_MAILBOX:-true}"

set -a
# shellcheck disable=SC1090
source "$CONTROL_ENV"
set +a

wait_for_tunnel_url() {
  local log_path=$1
  local timeout=${2:-60}
  local started
  started=$(date +%s)
  while (( $(date +%s) - started < timeout )); do
    if [[ -f "$log_path" ]]; then
      local url
      url=$(rg -o 'https://[-a-z0-9]+(?:-[-a-z0-9]+)*\.trycloudflare\.com' "$log_path" | head -1 || true)
      if [[ -n "$url" ]]; then
        echo "$url"
        return 0
      fi
    fi
    sleep 1
  done
  return 1
}

start_tunnel() {
  local session=$1
  local port=$2
  local log_path=$3
  tmux kill-session -t "$session" 2>/dev/null || true
  : >"$log_path"
  tmux new-session -d -s "$session" \
    "cloudflared tunnel --url http://127.0.0.1:${port} --protocol http2 --no-autoupdate 2>&1 | tee -a ${log_path}"
}

update_env_var() {
  local key=$1
  local value=$2
  if rg -q "^${key}=" "$CONTROL_ENV"; then
    sed -i "s|^${key}=.*|${key}=${value}|" "$CONTROL_ENV"
  else
    echo "${key}=${value}" >>"$CONTROL_ENV"
  fi
}

mkdir -p /opt/signoff/logs

start_tunnel signoff-tunnel 8787 /opt/signoff/logs/orchestrator-tunnel.log
if [[ "$AGENT_MAILBOX" == "false" || "$AGENT_MAILBOX" == "0" || "$AGENT_MAILBOX" == "no" ]]; then
  start_tunnel signoff-agent-tunnel 8001 /opt/signoff/logs/agent-tunnel.log
else
  tmux kill-session -t signoff-agent-tunnel 2>/dev/null || true
fi

PUBLIC_BASE_URL="$(wait_for_tunnel_url /opt/signoff/logs/orchestrator-tunnel.log 90)"

update_env_var ORCHESTRATOR_URL "http://127.0.0.1:8787"
update_env_var PUBLIC_BASE_URL "$PUBLIC_BASE_URL"
update_env_var AGENT_MAILBOX "$AGENT_MAILBOX"
if [[ "$AGENT_MAILBOX" == "false" || "$AGENT_MAILBOX" == "0" || "$AGENT_MAILBOX" == "no" ]]; then
  AGENT_BASE_URL="$(wait_for_tunnel_url /opt/signoff/logs/agent-tunnel.log 90)"
  update_env_var AGENT_ENDPOINT "${AGENT_BASE_URL}/submit"
fi

chmod 640 "$CONTROL_ENV"

tmux kill-session -t signoff-app 2>/dev/null || true
tmux kill-session -t signoff-agent 2>/dev/null || true

tmux new-session -d -s signoff-app \
  "bash -lc 'set -a; source ${CONTROL_ENV}; set +a; cd ${APP_DIR} && bun index.ts'"

sleep 2

tmux new-session -d -s signoff-agent \
  "bash -lc 'set -a; source ${CONTROL_ENV}; set +a; cd ${APP_DIR} && ${VENV} agentverse/signoff_agent.py'"

sleep 4

cd "$APP_DIR"
if [[ "$AGENT_MAILBOX" == "false" || "$AGENT_MAILBOX" == "0" || "$AGENT_MAILBOX" == "no" ]]; then
  "$VENV" scripts/register_chat_agent.py
fi

curl -sf "http://127.0.0.1:8787/health"
if [[ "$AGENT_MAILBOX" == "false" || "$AGENT_MAILBOX" == "0" || "$AGENT_MAILBOX" == "no" ]]; then
  agent_status="$(curl -s -o /dev/null -w "%{http_code}" "${AGENT_BASE_URL}/submit" -X POST -H "content-type: application/json" -d '{}')"
  if [[ "$agent_status" != "400" && "$agent_status" != "200" && "$agent_status" != "422" ]]; then
    echo "agent tunnel check failed with HTTP ${agent_status}" >&2
    exit 1
  fi
fi

echo
echo "PUBLIC_BASE_URL=${PUBLIC_BASE_URL}"
echo "AGENT_MAILBOX=${AGENT_MAILBOX}"
if [[ "$AGENT_MAILBOX" == "false" || "$AGENT_MAILBOX" == "0" || "$AGENT_MAILBOX" == "no" ]]; then
  echo "AGENT_ENDPOINT=${AGENT_BASE_URL}/submit"
fi
