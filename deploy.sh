#!/usr/bin/env bash
set -euo pipefail

# Unique tag per deploy → forces Swarm to see a new digest and roll services.
TAG="$(date +%Y%m%d-%H%M%S)"

echo "▶ Building images with tag :${TAG}"
docker build -t "cr_backend:${TAG}"  -t cr_backend:latest  ./backend
docker build \
  --build-arg NEXT_PUBLIC_WS_URL=wss://cr.ipk-labs.com/ws \
  -t "cr_frontend:${TAG}" -t cr_frontend:latest ./frontend

echo "▶ Rendering stack file with pinned tag"
sed \
  -e "s|image: cr_backend$|image: cr_backend:${TAG}|" \
  -e "s|image: cr_frontend$|image: cr_frontend:${TAG}|" \
  stack.resolved.yml > stack.deploy.yml

echo "▶ Deploying"
docker stack deploy -c stack.deploy.yml --resolve-image never cr

echo "✓ Deployed cr_backend:${TAG} / cr_frontend:${TAG}"
