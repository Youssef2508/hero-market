# syntax=docker/dockerfile:1
# ─────────────────────────────────────────────────────────────
# HeroMarket POS – reproducible Linux VALIDATION image.
#
# HeroMarket POS is a Windows desktop (Electron) application that depends on
# Windows-only binaries (sqlite3.exe, typst.exe, PowerShell printing). It is NOT
# run inside this container. The image gives every developer and CI the same
# toolchain to run lint, the production build of main/preload/renderer and the
# SQL simulation tests (against a freshly bootstrapped SQLite database).
#
#   docker build -t heromarket-ci .
#   docker run --rm heromarket-ci              # lint + format + build + tests
#
# See .docs/DOCKER.md.
# ─────────────────────────────────────────────────────────────
FROM node:22-bookworm-slim@sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392

# sqlite3 CLI for the SQL simulation tests (Linux replacement for the bundled sqlite3.exe).
RUN apt-get update \
  && apt-get install -y --no-install-recommends sqlite3 \
  && rm -rf /var/lib/apt/lists/*

ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1 \
    npm_config_fund=false \
    npm_config_update_notifier=false \
    CI=true

WORKDIR /app
RUN chown node:node /app
USER node

# Dependencies first for layer caching; install scripts are skipped (no Electron binary needed).
COPY --chown=node:node package.json package-lock.json ./
RUN npm ci --ignore-scripts

COPY --chown=node:node . .

HEALTHCHECK NONE
CMD ["sh", "-c", "npm run lint && npm run format:check && npm run build && npm run test:fresh"]
