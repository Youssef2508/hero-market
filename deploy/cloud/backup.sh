#!/bin/bash
# The nightly encrypted copy of the HeroMarket cloud database (D-105).
#
#   heromarket-cloud-YYYYMMDD-HHMMSS.dump.age pg_dump (custom format), encrypted with age to
#                                              BACKUP_RECIPIENT (the owner's public key)
#   ….dump.age.sha256                         its checksum
# Kept BACKUP_KEEP_DAYS days in the "backups" volume. The server cannot read its own copies: only
# the owner's private key can. Restore: deploy/cloud/restore.sh (see .docs/CLOUD_DEPLOYMENT.md).
#
# Off-server (optional): with BACKUP_OFFSITE set (an rclone remote and path, e.g. offsite:bucket/hm,
# configured by RCLONE_CONFIG_OFFSITE_* variables), each copy is also uploaded there. It is already
# encrypted, so the storage provider cannot read it either. Old copies there follow the bucket's
# own lifecycle rule.
#
# BACKUP_NOW=1 makes one copy and exits (used for the first check and before an update).
set -euo pipefail

: "${BACKUP_RECIPIENT:?BACKUP_RECIPIENT is required}"
case "$BACKUP_RECIPIENT" in age1*) ;; *) echo "BACKUP_RECIPIENT must be an age public key (age1…)" >&2; exit 2 ;; esac
KEEP="${BACKUP_KEEP_DAYS:-14}"
HOUR="${BACKUP_HOUR:-3}"
DIR=/backups

one_copy() {
  local name tmp
  name="heromarket-cloud-$(date +%Y%m%d-%H%M%S).dump.age"
  tmp="$DIR/.partial-$name"
  # A copy that fails half way is never left under a real name.
  if pg_dump --format=custom --no-owner --no-privileges | age --encrypt --recipient "$BACKUP_RECIPIENT" > "$tmp"; then
    mv "$tmp" "$DIR/$name"
    (cd "$DIR" && sha256sum "$name" > "$name.sha256")
    echo "$(date -Iseconds) backup: $name ($(stat -c %s "$DIR/$name") bytes)"
    if [ -n "${BACKUP_OFFSITE:-}" ]; then
      if rclone copy --no-traverse "$DIR/$name" "$BACKUP_OFFSITE" && rclone copy --no-traverse "$DIR/$name.sha256" "$BACKUP_OFFSITE"; then
        echo "$(date -Iseconds) backup: copied off the server to $BACKUP_OFFSITE"
      else
        echo "$(date -Iseconds) backup: off-server copy FAILED (the copy on this server is kept)" >&2
      fi
    fi
  else
    rm -f "$tmp"
    echo "$(date -Iseconds) backup: FAILED" >&2
    return 1
  fi
  find "$DIR" -maxdepth 1 -name 'heromarket-cloud-*.dump.age*' -mtime +"$KEEP" -delete
}

mkdir -p "$DIR"
if [ "${BACKUP_NOW:-0}" = "1" ]; then
  one_copy
  exit $?
fi

echo "$(date -Iseconds) backup: every day at ${HOUR}:00 ($TZ), kept ${KEEP} days"
while true; do
  now=$(date +%s)
  next=$(date -d "today ${HOUR}:00" +%s)
  [ "$next" -le "$now" ] && next=$(date -d "tomorrow ${HOUR}:00" +%s)
  sleep $((next - now))
  one_copy || true
done
