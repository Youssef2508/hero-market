#!/bin/bash
# Update the HeroMarket cloud to an approved release, and go back by itself if it fails
# (architecture §14.1, D-105). Run on the server from the repository: deploy/cloud/update.sh v1.6.0
#
#   1. stop the cloud service (the proxy stays; phones see "unreachable" for a minute or two)
#   2. a plain copy of the database for going back, kept here only (root-only, the last 3), and the
#      owner's encrypted copy
#   3. build and start the release's image, tagged by version; it migrates its database at start
#   4. wait until it reports healthy
#   5. if it does not: put the copy back, start the previous image again, and say so
#
# The shop is not touched. While the database versions differ, the cloud refuses the shop's link and
# both sides work apart; the shop's own update (the installer) brings them together again.
set -euo pipefail
# git checkout replaces this file while it runs: run from a copy of it.
if [ -z "${HM_UPDATE_REPO:-}" ]; then
  self=$(mktemp)
  cp "$0" "$self"
  HM_UPDATE_REPO="$(cd "$(dirname "$0")/../.." && pwd)" exec bash "$self" "$@"
fi
cd "$HM_UPDATE_REPO"
tag="${1:?usage: deploy/cloud/update.sh <release tag, e.g. v1.6.0>}"
env_file=deploy/cloud/.env
dc() { docker compose -f deploy/cloud/docker-compose.yml "$@"; }
prev=$(grep -E '^HEROMARKET_IMAGE_TAG=' "$env_file" | cut -d= -f2- || true)
prev_ref=$(git rev-parse HEAD)
set_tag() {
  if grep -qE '^HEROMARKET_IMAGE_TAG=' "$env_file"; then
    sed -i "s/^HEROMARKET_IMAGE_TAG=.*/HEROMARKET_IMAGE_TAG=$1/" "$env_file"
  else
    echo "HEROMARKET_IMAGE_TAG=$1" >> "$env_file"
  fi
}
healthy() {
  for _ in $(seq 1 60); do
    id=$(dc ps -q cloud)
    if [ -n "$id" ] && [ "$(docker inspect --format '{{.State.Health.Status}}' "$id")" = "healthy" ]; then
      return 0
    fi
    sleep 3
  done
  return 1
}

git fetch --tags --quiet
git rev-parse --verify --quiet "$tag^{commit}" > /dev/null || { echo "no such release: $tag" >&2; exit 2; }

echo "== 1. stopping the cloud service (was ${prev:-untagged})"
dc stop cloud

echo "== 2. copies"
mkdir -p deploy/cloud/pre-update && chmod 700 deploy/cloud/pre-update
copy="deploy/cloud/pre-update/before-$tag-$(date +%Y%m%d-%H%M%S).dump"
dc exec -T db pg_dump -U heromarket -d heromarket --format=custom > "$copy"
chmod 600 "$copy"
ls -1t deploy/cloud/pre-update/*.dump | tail -n +4 | xargs -r rm -f
dc run --rm -e BACKUP_NOW=1 backup || echo "warning: the encrypted copy failed (the plain copy is kept)"

echo "== 3. starting $tag"
git checkout --quiet "$tag"
set_tag "$tag"
dc build cloud
dc up -d cloud

echo "== 4. waiting for it to report healthy"
if healthy; then
  echo "updated to $tag. Next: update the shop PC with the installer of the same release."
  exit 0
fi

echo "== 5. $tag did not become healthy: going back to ${prev:-the previous version}" >&2
dc logs --tail 50 cloud >&2 || true
dc stop cloud
dc exec -T db psql -U heromarket -d postgres -v ON_ERROR_STOP=1 \
  -c 'DROP DATABASE heromarket WITH (FORCE)' \
  -c "CREATE DATABASE heromarket TEMPLATE template0 ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C'"
dc exec -T db pg_restore -U heromarket -d heromarket --no-owner --exit-on-error < "$copy"
git checkout --quiet "$prev_ref"
set_tag "${prev:-local}"
dc up -d --no-build cloud
if healthy; then
  echo "back on ${prev:-the previous version}, with the database as it was before the update." >&2
else
  echo "the previous version did not start either: see .docs/CLOUD_DEPLOYMENT.md (restore)." >&2
fi
exit 1
