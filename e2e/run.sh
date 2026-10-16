#!/usr/bin/env bash
# End to end in Docker, without a Sync Box: builds the integration image,
# starts the fake box (e2e/fake-syncbox.mjs, HTTPS with a test certificate)
# on a Docker network, and runs e2e/in-image.mjs inside the image under the
# Gladys sandbox limits (read-only rootfs, 256 MB, 0.5 CPU, non-root, /data
# volume). Then checks that the entry point starts read-only (it stops at
# once without the Gladys environment variables, as expected).
set -euo pipefail
cd "$(dirname "$0")/.."
NET=hue-sync-e2e
docker build -q -t gladys-hue-sync-box:e2e . >/dev/null
docker image ls gladys-hue-sync-box:e2e --format 'image size: {{.Size}}'
docker network create "$NET" >/dev/null 2>&1 || true
docker rm -f syncbox-fake >/dev/null 2>&1 || true
docker run -d --rm --name syncbox-fake --network "$NET" -v "$PWD:/repo:ro" -w /repo \
  node:24-alpine node e2e/fake-syncbox.mjs >/dev/null
trap 'docker rm -f syncbox-fake >/dev/null 2>&1 || true; docker network rm "$NET" >/dev/null 2>&1 || true' EXIT
sleep 1
docker volume create hue-sync-e2e-data >/dev/null
docker run --rm --read-only --memory 256m --cpus 0.5 --network "$NET" \
  -v hue-sync-e2e-data:/data -v "$PWD/e2e:/app/e2e:ro" \
  -v "$PWD/test/fixtures/tls:/app/e2e-tls:ro" gladys-hue-sync-box:e2e \
  node /app/e2e/in-image.mjs
echo '--- the entry point, read-only, without Gladys (expected: the SDK asks for its env)'
docker run --rm --read-only --memory 256m --cpus 0.5 -v hue-sync-e2e-data:/data \
  gladys-hue-sync-box:e2e 2>&1 | tail -3 || true
docker volume rm hue-sync-e2e-data >/dev/null
