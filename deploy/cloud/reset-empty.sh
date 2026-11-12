#!/bin/bash
# Empty the cloud's database, for the real shop's first pairing (ROLLOUT_GUIDE.md) or after trials.
# Asks you to type the store's address to confirm, takes an encrypted copy first (only the owner's
# key opens it), then starts the cloud on a new, empty database. The shop PC is not touched.
#
#   sudo deploy/cloud/reset-empty.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
dc() { docker compose -f deploy/cloud/docker-compose.yml "$@"; }
domain=$(grep -E '^HEROMARKET_DOMAIN=' deploy/cloud/.env | cut -d= -f2-)
echo "This empties the HeroMarket cloud at https://$domain: every record, user and pairing on it."
read -r -p "Type the address ($domain) to continue: " typed
[ "$typed" = "$domain" ] || { echo "not confirmed: nothing changed"; exit 1; }

echo "== an encrypted copy of what is there now"
dc run --rm -T -e BACKUP_NOW=1 backup </dev/null
echo "== emptying"
dc stop cloud
dc exec -T db psql -U heromarket -d postgres -v ON_ERROR_STOP=1 \
  -c 'DROP DATABASE heromarket WITH (FORCE)' \
  -c "CREATE DATABASE heromarket TEMPLATE template0 ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C'" </dev/null
dc up -d cloud
for _ in $(seq 1 60); do
  [ "$(docker inspect --format '{{.State.Health.Status}}' "$(dc ps -q cloud)")" = healthy ] && break
  sleep 3
done
echo "== the cloud is empty and running. Next: make a pairing code (cloud-pair) and pair the shop PC."
