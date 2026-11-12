# The nightly encrypted copy of the cloud database: PostgreSQL's own pg_dump (same major version as
# the database), age (https://age-encryption.org) and rclone for the optional off-server copy, from
# Debian's packages.
FROM postgres:17-bookworm
RUN apt-get update \
 && apt-get install -y --no-install-recommends age rclone ca-certificates \
 && rm -rf /var/lib/apt/lists/*
