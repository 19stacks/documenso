#!/usr/bin/env bash
set -euo pipefail

# Build the staging image, smoke-test it, then push to GitLab Container Registry.
# Run from the repo root. Requires: `docker login registry.gitlab.com` already done.
#
# Migrations run at container startup (docker/start.sh), so the build
# itself does not need DB credentials or a --secret mount.

IMAGE="registry.gitlab.com/rl-onboard-crm/onboard-crm-documenso"
TAG="Staging"
PORT="3020"
ENV_FILE=".env.docker"

BLUE='\033[1;34m'
GREEN='\033[1;32m'
YELLOW='\033[1;33m'
RED='\033[1;31m'
NC='\033[0m'

info() { echo -e "${BLUE}>> $1${NC}"; }
ok()   { echo -e "${GREEN}>> $1${NC}"; }
warn() { echo -e "${YELLOW}>> $1${NC}"; }
err()  { echo -e "${RED}>> $1${NC}" >&2; }

info "Building ${IMAGE}:${TAG}"

DOCKER_BUILDKIT=1 docker build \
  -t "${IMAGE}:${TAG}" \
  .

# TODO: replace with real checks (npm test, e2e, etc). For now this just
# confirms the container boots and serves a response before we push it.
info "Smoke testing ${IMAGE}:${TAG}"

CID=$(docker run -d \
  --env-file "${ENV_FILE}" \
  -p "${PORT}:${PORT}" \
  "${IMAGE}:${TAG}")

trap 'docker rm -f "$CID" >/dev/null 2>&1 || true' EXIT

for i in $(seq 1 15); do
  if curl -fsS "http://localhost:${PORT}/api/health" >/dev/null 2>&1; then
    ok "Smoke test passed"
    break
  fi

  if [ "$i" -eq 15 ]; then
    err "Smoke test failed: container did not respond in time"
    docker logs "$CID" >&2
    exit 1
  fi

  sleep 2
done

docker rm -f "$CID" >/dev/null 2>&1
trap - EXIT

info "Pushing ${IMAGE}:${TAG}"

docker push "${IMAGE}:${TAG}"

ok "Done: ${IMAGE}:${TAG} pushed to GitLab Container Registry"