#!/bin/bash
# Restore an encrypted cloud copy into an EMPTY database (D-105). Run where the private key is (the
# owner's computer or a new server), never with the key stored on the cloud server.
#
#   deploy/cloud/restore.sh <copy.dump.age> <age-identity-file> <postgres://…/empty-database>
#
# Checks the copy against its .sha256 when present, decrypts it in memory and restores it. The
# target must be empty: restoring over a live cloud is refused. Afterwards start the cloud on it with
# the same HEROMARKET_SECRET; the shop's link then brings it up to date.
set -euo pipefail
copy="${1:?copy file (.dump.age)}"
key="${2:?age identity file (the private key)}"
target="${3:?target database URL}"

if [ -f "$copy.sha256" ]; then
  (cd "$(dirname "$copy")" && sha256sum --check --status "$(basename "$copy").sha256") \
    || { echo "checksum does not match: the copy is damaged" >&2; exit 3; }
  echo "checksum: ok"
fi
tables=$(psql "$target" -Atc "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'")
if [ "$tables" != "0" ]; then
  echo "the target database is not empty ($tables tables): refused" >&2
  exit 4
fi
age --decrypt --identity "$key" "$copy" | pg_restore --no-owner --no-privileges --exit-on-error --dbname "$target"
echo "restored: $(psql "$target" -Atc "SELECT count(*) FROM users") users, $(psql "$target" -Atc "SELECT count(*) FROM sales") sales, schema $(psql "$target" -Atc "SELECT max(version) FROM schema_migrations")"
