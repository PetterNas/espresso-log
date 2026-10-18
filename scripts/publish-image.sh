#!/usr/bin/env bash
# Builds the Docker image and pushes it to the Forgejo container registry.
#
#   ./scripts/publish-image.sh                         # linux/amd64, tag :latest
#   PLATFORM=linux/arm64 ./scripts/publish-image.sh    # e.g. a Raspberry Pi
#
# One-time: docker login git.petternet.net  (password = a Forgejo token with package write access)
set -euo pipefail

IMAGE="${IMAGE:-git.petternet.net/p1er/espresso-log}"
PLATFORM="${PLATFORM:-linux/amd64}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

docker buildx build "$ROOT" --platform "$PLATFORM" -t "$IMAGE:latest" --push
echo "Pushed $IMAGE:latest. On the server: docker compose pull espresso && docker compose up -d espresso"
