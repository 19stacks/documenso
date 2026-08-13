#!/usr/bin/env bash
set -euo pipefail

# Pull the latest prod image, replace the running container, and clean up
# the old image. Run this on the prod server.
# Requires a .env.docker file in the same directory.

IMAGE="registry.gitlab.com/rl-onboard-crm/onboard-crm-documenso"
TAG="Prod"
CONTAINER_NAME="documenso-prod"
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

info "Stopping old prod container (if any)"

if docker ps -aq -f "name=^${CONTAINER_NAME}\$" | grep -q .; then
  docker stop "${CONTAINER_NAME}"
  docker rm "${CONTAINER_NAME}"
else
  warn "No existing container named ${CONTAINER_NAME}"
fi

# Capture the current image ID before pulling so we can remove it afterwards
# if the image has changed.
OLD_IMAGE_ID=$(docker images -q "${IMAGE}:${TAG}")

info "Pulling ${IMAGE}:${TAG}"
docker pull "${IMAGE}:${TAG}"

NEW_IMAGE_ID=$(docker images -q "${IMAGE}:${TAG}")

if [ -n "${OLD_IMAGE_ID}" ] && [ "${OLD_IMAGE_ID}" != "${NEW_IMAGE_ID}" ]; then
  warn "Removing old image ${OLD_IMAGE_ID}"
  docker rmi "${OLD_IMAGE_ID}" || true
fi

info "Starting ${CONTAINER_NAME} from ${IMAGE}:${TAG}"

docker run -d \
  --name "${CONTAINER_NAME}" \
  --restart unless-stopped \
  --env-file "${ENV_FILE}" \
  -p "${PORT}:${PORT}" \
  --log-driver json-file \
  --log-opt max-size=10m \
  --log-opt max-file=3 \
  "${IMAGE}:${TAG}"

ok "Done. Tailing prod logs (ctrl+c to stop watching, container keeps running):"

docker logs -f "${CONTAINER_NAME}"