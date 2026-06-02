#!/usr/bin/env bash
# ============================================================================
# Pulse Hesias — interactive setup
#
# Generates a production-grade .env (and matching garage.toml) by prompting
# for each setting. Secrets default to freshly generated strong values, so
# pressing Enter is always a safe choice.
#
#   ./setup.sh           interactive
#   ./setup.sh -y         non-interactive, accept all generated defaults
#   ./setup.sh -f         overwrite an existing .env without asking
# ============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

ENV_FILE="$ROOT/.env"
GARAGE_TPL="$ROOT/garage.toml.example"
GARAGE_OUT="$ROOT/garage.toml"

ASSUME_YES=0
FORCE=0
for arg in "$@"; do
  case "$arg" in
    -y|--yes)   ASSUME_YES=1 ;;
    -f|--force) FORCE=1 ;;
    -h|--help)
      grep '^#' "$0" | sed 's/^# \{0,1\}//' | head -n 13
      exit 0 ;;
    *) echo "Unknown option: $arg" >&2; exit 1 ;;
  esac
done

# ── Colors ─────────────────────────────────────────────────────────────────
if [ -t 1 ]; then
  B=$'\033[1m'; DIM=$'\033[2m'; GRN=$'\033[32m'; YLW=$'\033[33m'; CYN=$'\033[36m'; RST=$'\033[0m'
else
  B=""; DIM=""; GRN=""; YLW=""; CYN=""; RST=""
fi

info()  { echo "${CYN}▸${RST} $*"; }
ok()    { echo "${GRN}✓${RST} $*"; }
warn()  { echo "${YLW}!${RST} $*"; }

# ── Prerequisites ──────────────────────────────────────────────────────────
command -v openssl >/dev/null 2>&1 || { echo "openssl is required" >&2; exit 1; }

gen_hex()   { openssl rand -hex "${1:-32}"; }
gen_key_id(){ echo "GK$(openssl rand -hex 12)"; }   # Garage access-key format

# ask <var> <prompt> <default>
# Echoes the chosen value. With -y, always uses the default.
ask() {
  local _prompt="$2" _default="$3" _reply
  if [ "$ASSUME_YES" -eq 1 ]; then
    printf '%s' "$_default"
    return
  fi
  printf '%s%s%s %s[%s]%s: ' "$B" "$_prompt" "$RST" "$DIM" "${_default:-empty}" "$RST" >&2
  read -r _reply || true
  printf '%s' "${_reply:-$_default}"
}

echo
echo "${B}Pulse Hesias — configuration${RST}"
echo "${DIM}Press Enter to accept the [default]. Generated secrets are unique per run.${RST}"
echo

# ── Existing .env guard ────────────────────────────────────────────────────
if [ -f "$ENV_FILE" ] && [ "$FORCE" -eq 0 ]; then
  if [ "$ASSUME_YES" -eq 1 ]; then
    warn ".env already exists — backing it up"
  else
    printf '%s.env already exists. Overwrite?%s [y/N]: ' "$YLW" "$RST"
    read -r confirm || true
    case "${confirm:-N}" in
      y|Y) ;;
      *) echo "Aborted."; exit 0 ;;
    esac
  fi
  cp "$ENV_FILE" "$ENV_FILE.bak.$(date +%Y%m%d%H%M%S)"
  ok "Backup written next to .env"
fi

# ── Prompts ────────────────────────────────────────────────────────────────
PORT=$(ask PORT "App port" "3000")
NODE_ENV=$(ask NODE_ENV "Node environment (production/development)" "production")
CORS_ORIGINS=$(ask CORS_ORIGINS "Allowed CORS origins (comma-separated, * ok)" "https://pulse.hesias.fr,https://*.hesias.fr,https://*.hesias.net,http://localhost:3000")

echo
info "Authentication tokens"
PULSE_API_TOKEN=$(ask PULSE_API_TOKEN "API token (extension → server)" "$(gen_hex 32)")
PULSE_DASHBOARD_TOKEN=$(ask PULSE_DASHBOARD_TOKEN "Dashboard token (surveillant UI)" "$(gen_hex 32)")

echo
info "PostgreSQL"
DATABASE_URL=$(ask DATABASE_URL "Database URL" "postgres://pulse:pulse@postgres:5432/pulse")

echo
info "Object storage (Garage / S3)"
S3_ENDPOINT=$(ask S3_ENDPOINT "S3 endpoint" "http://garage:3900")
S3_REGION=$(ask S3_REGION "S3 region" "garage")
S3_BUCKET=$(ask S3_BUCKET "S3 bucket" "pulse-evidence")
S3_ACCESS_KEY_ID=$(ask S3_ACCESS_KEY_ID "S3 access key id" "$(gen_key_id)")
S3_SECRET_ACCESS_KEY=$(ask S3_SECRET_ACCESS_KEY "S3 secret access key" "$(gen_hex 32)")
S3_FORCE_PATH_STYLE=$(ask S3_FORCE_PATH_STYLE "Force path-style addressing" "true")
S3_PUBLIC_BASE_URL=$(ask S3_PUBLIC_BASE_URL "Public base URL for evidence (blank = proxy via API)" "")
GARAGE_KEY_NAME=$(ask GARAGE_KEY_NAME "Garage key name" "pulse-app")

echo
info "Garage cluster secrets"
GARAGE_RPC_SECRET=$(ask GARAGE_RPC_SECRET "Garage RPC secret" "$(gen_hex 32)")
GARAGE_ADMIN_TOKEN=$(ask GARAGE_ADMIN_TOKEN "Garage admin token" "$(gen_hex 24)")
GARAGE_METRICS_TOKEN=$(ask GARAGE_METRICS_TOKEN "Garage metrics token" "$(gen_hex 24)")

echo
info "Optional: Mistral AI session analysis (leave blank to disable)"
MISTRAL_API_KEY=$(ask MISTRAL_API_KEY "Mistral API key" "")
MISTRAL_MODEL=$(ask MISTRAL_MODEL "Mistral model" "mistral-small-latest")

echo
info "Extension build (npm run build:ext / release:ext)"
PULSE_BACKEND_URL=$(ask PULSE_BACKEND_URL "Public backend URL the extension sends to" "http://localhost:3000")
PULSE_EXAM_ORIGINS=$(ask PULSE_EXAM_ORIGINS "Exam origins (match patterns, comma-separated)" "https://*.hesias.fr/*,https://*.hesias.net/*")
PULSE_WHITELIST_URLS=$(ask PULSE_WHITELIST_URLS "Extra whitelisted hosts during exam (comma-separated, optional)" "")

# ── Write .env ─────────────────────────────────────────────────────────────
umask 077
cat > "$ENV_FILE" <<EOF
PORT=$PORT
NODE_ENV=$NODE_ENV
PULSE_API_TOKEN=$PULSE_API_TOKEN
PULSE_DASHBOARD_TOKEN=$PULSE_DASHBOARD_TOKEN
CORS_ORIGINS=$CORS_ORIGINS

DATABASE_URL=$DATABASE_URL

S3_ENDPOINT=$S3_ENDPOINT
S3_REGION=$S3_REGION
S3_BUCKET=$S3_BUCKET
S3_ACCESS_KEY_ID=$S3_ACCESS_KEY_ID
S3_SECRET_ACCESS_KEY=$S3_SECRET_ACCESS_KEY
S3_FORCE_PATH_STYLE=$S3_FORCE_PATH_STYLE
S3_PUBLIC_BASE_URL=$S3_PUBLIC_BASE_URL

GARAGE_KEY_NAME=$GARAGE_KEY_NAME
GARAGE_RPC_SECRET=$GARAGE_RPC_SECRET
GARAGE_ADMIN_TOKEN=$GARAGE_ADMIN_TOKEN
GARAGE_METRICS_TOKEN=$GARAGE_METRICS_TOKEN

MISTRAL_API_KEY=$MISTRAL_API_KEY
MISTRAL_MODEL=$MISTRAL_MODEL

PULSE_BACKEND_URL=$PULSE_BACKEND_URL
PULSE_EXAM_ORIGINS=$PULSE_EXAM_ORIGINS
PULSE_WHITELIST_URLS=$PULSE_WHITELIST_URLS
EOF
chmod 600 "$ENV_FILE"
ok "Wrote $ENV_FILE (chmod 600)"

# ── Render garage.toml from template ───────────────────────────────────────
if [ -f "$GARAGE_TPL" ]; then
  sed \
    -e "s|__GARAGE_RPC_SECRET__|$GARAGE_RPC_SECRET|g" \
    -e "s|__GARAGE_ADMIN_TOKEN__|$GARAGE_ADMIN_TOKEN|g" \
    -e "s|__GARAGE_METRICS_TOKEN__|$GARAGE_METRICS_TOKEN|g" \
    "$GARAGE_TPL" > "$GARAGE_OUT"
  ok "Wrote $GARAGE_OUT with generated secrets"
else
  warn "garage.toml.example missing — skipped garage.toml render"
fi

echo
ok "Setup complete."
echo
echo "Next:"
echo "  ${B}docker compose up -d --build${RST}     # start postgres + garage + app"
echo "  ${B}curl http://localhost:$PORT/health${RST}"
echo "  Dashboard: ${B}http://localhost:$PORT${RST}  (token: PULSE_DASHBOARD_TOKEN)"
echo
warn "Keep .env and garage.toml private. They are git-ignored by default."
