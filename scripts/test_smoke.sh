#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
LOG_FILE="${ROOT_DIR}/.run/wrangler-test.log"
export XDG_CONFIG_HOME="${ROOT_DIR}/.run/config"

mkdir -p "${ROOT_DIR}/.run"

cd "${ROOT_DIR}"

npx wrangler d1 execute furni-platform --local --file=./deploy/cloudflare/schema.sql >/dev/null
npx wrangler d1 execute furni-platform --local --file=./deploy/cloudflare/seed.sql >/dev/null

npx wrangler dev --local --port 8000 >"${LOG_FILE}" 2>&1 &
SERVER_PID=$!

cleanup() {
  if kill -0 "${SERVER_PID}" >/dev/null 2>&1; then
    kill "${SERVER_PID}" >/dev/null 2>&1 || true
    wait "${SERVER_PID}" >/dev/null 2>&1 || true
  fi
}

trap cleanup EXIT

for _ in $(seq 1 60); do
  if curl -fsS http://127.0.0.1:8000/health >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

curl -fsS http://127.0.0.1:8000/health | node -e 'const d=JSON.parse(require("fs").readFileSync(0,"utf8")); if(d.status!=="ok") process.exit(1)'
curl -fsS "http://127.0.0.1:8000/api/v1/feed?cursor=0&limit=5" | node -e 'const d=JSON.parse(require("fs").readFileSync(0,"utf8")); if(!Array.isArray(d.items)||d.items.length===0) process.exit(1)'
curl -fsS http://127.0.0.1:8000/api/v1/products/1 | node -e 'const d=JSON.parse(require("fs").readFileSync(0,"utf8")); if(d.id!==1||!Array.isArray(d.variants)||d.variants.length===0) process.exit(1)'

LOGIN_JSON="$(curl -fsS -X POST http://127.0.0.1:8000/api/v1/auth/login \
  -H 'content-type: application/json' \
  -d '{"display_name":"Smoke Tester","email":"smoke@example.com"}')"

TOKEN="$(printf '%s' "${LOGIN_JSON}" | node -e 'const d=JSON.parse(require("fs").readFileSync(0,"utf8")); if(!d.token) process.exit(1); process.stdout.write(d.token)')"
USER_ID="$(printf '%s' "${LOGIN_JSON}" | node -e 'const d=JSON.parse(require("fs").readFileSync(0,"utf8")); if(!d.user_id) process.exit(1); process.stdout.write(String(d.user_id))')"

curl -fsS http://127.0.0.1:8000/api/v1/auth/me \
  -H "authorization: Bearer ${TOKEN}" | node -e 'const d=JSON.parse(require("fs").readFileSync(0,"utf8")); if(!d.user_id||!d.token) process.exit(1)'

curl -fsS -X POST http://127.0.0.1:8000/api/v1/wishlist/items \
  -H 'content-type: application/json' \
  -d "{\"user_id\":${USER_ID},\"product_id\":1}" | node -e 'const d=JSON.parse(require("fs").readFileSync(0,"utf8")); if(d.ok!==true) process.exit(1)'

curl -fsS "http://127.0.0.1:8000/api/v1/users/${USER_ID}/wishlist" | node -e 'const d=JSON.parse(require("fs").readFileSync(0,"utf8")); if(!Array.isArray(d.items)||d.items.length===0) process.exit(1)'
