#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root/blueplate-dashboard"
npm ci --include=dev --include=optional --no-audit --no-fund
node --experimental-strip-types scripts/check-dashboard.mjs
node --experimental-strip-types scripts/check-orders.mjs
BLUEPLATE_EC2_EXPORT=1 NEXT_TELEMETRY_DISABLED=1 node node_modules/next/dist/bin/next build
test -s out/index.html
test -s out/data/blueplate.json
test -s out/data/orders.json
mkdir -p "$repo_root/deploy/site"
cp -R out/. "$repo_root/deploy/site/"
