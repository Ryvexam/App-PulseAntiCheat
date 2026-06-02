set -eu

GARAGE=/garage
BUCKET="${S3_BUCKET:-pulse-evidence}"
KEY_ID="${S3_ACCESS_KEY_ID:-GK0123456789abcdef01234567}"
SECRET="${S3_SECRET_ACCESS_KEY:-0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef}"
KEY_NAME="${GARAGE_KEY_NAME:-pulse-app}"
NODE_ID="$($GARAGE node id -q | cut -d'@' -f1)"

$GARAGE layout assign -z dc1 -c 1G "$NODE_ID" || true
$GARAGE layout apply --version 1 || true
$GARAGE bucket create "$BUCKET" || true
$GARAGE key import --yes -n "$KEY_NAME" "$KEY_ID" "$SECRET" || true
$GARAGE bucket allow --read --write --owner "$BUCKET" --key "$KEY_NAME" || true

echo "Garage bucket ready: $BUCKET"
