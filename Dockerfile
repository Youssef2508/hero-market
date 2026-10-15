# syntax=docker/dockerfile:1
# ─────────────────────────────────────────────────────────────
# HeroMarket POS – reproducible Linux VALIDATION image.
#
# The desktop app (Electron, PowerShell printing) is NOT run inside this container.
# The image gives every developer and CI the same toolchain to run lint, the
# production build of main/preload/renderer and every test suite. The service and
# migration suites need PostgreSQL, which docker-compose.test.yml provides:
#
#   docker compose -f docker-compose.test.yml run --rm --build tests
#
# The multi-till server image is Dockerfile.server. See .docs/DOCKER.md.
# ─────────────────────────────────────────────────────────────
FROM node:22-bookworm-slim@sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392

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
# npm test fails (rather than skipping) when HEROMARKET_TEST_DATABASE_URL is not set.
CMD ["sh", "-c", "npm run lint && npm run format:check && npm run build && npm test"]
