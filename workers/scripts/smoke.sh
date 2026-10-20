#!/usr/bin/env bash
# Curl examples for the exclusions Worker.
# Without WORKER_URL, this prints the examples and exits 0.
# With WORKER_URL, it runs a public round-trip and deletes the smoke rows.
# Admin calls also need WRITE_SECRET.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

cat <<'EOF'
Public browser contract (no write secret). POST stays text/plain so the
current frontend does not preflight.

  export WORKER_URL="https://grocery-restock-exclusions.<subdomain>.workers.dev"

  curl -fsS "$WORKER_URL"
  curl -fsS "$WORKER_URL?callback=onExclusions"

  curl -fsS -X POST "$WORKER_URL" \
    -H "Content-Type: text/plain;charset=utf-8" \
    --data '{"action":"exclude","type":"煙霧測試","name":"剔除","note":"smoke"}'

  curl -fsS -X POST "$WORKER_URL" \
    -H "Content-Type: text/plain;charset=utf-8" \
    --data '{"action":"restore","type":"煙霧測試","name":"剔除"}'

  curl -fsS -X POST "$WORKER_URL" \
    -H "Content-Type: text/plain;charset=utf-8" \
    --data '{"action":"hold","type":"煙霧測試","name":"暫緩","note":"smoke"}'

  curl -fsS -X POST "$WORKER_URL" \
    -H "Content-Type: text/plain;charset=utf-8" \
    --data '{"action":"unhold","type":"煙霧測試","name":"暫緩"}'

  curl -fsS -X POST "$WORKER_URL" \
    -H "Content-Type: text/plain;charset=utf-8" \
    --data '{"action":"reclass","type":"煙霧測試","name":"改類","newType":"煙霧測試","newSubtype":"子類"}'

  curl -fsS -X POST "$WORKER_URL" \
    -H "Content-Type: text/plain;charset=utf-8" \
    --data '{"action":"reclass_clear","type":"煙霧測試","name":"改類"}'

Admin (WRITE_SECRET). Either header works. These are not called by the website.

  curl -fsS -X POST "$WORKER_URL/admin/seed" \
    -H "Authorization: Bearer $WRITE_SECRET"

  curl -fsSL "$GAS_URL" -o /tmp/gas-snapshot.json
  node -e 'const fs=require("fs"); const s=JSON.parse(fs.readFileSync("/tmp/gas-snapshot.json","utf8")); s.replace=true; fs.writeFileSync("/tmp/gas-import.json", JSON.stringify(s));'
  curl -fsS -X POST "$WORKER_URL/admin/import" \
    -H "X-Write-Secret: $WRITE_SECRET" \
    -H "Content-Type: application/json" \
    --data-binary @/tmp/gas-import.json
EOF

if [[ -z "${WORKER_URL:-}" ]]; then
  echo
  echo "WORKER_URL is not set. Examples only. Contract tests: (cd \"$ROOT\" && npm test)"
  exit 0
fi

WORKER_URL="${WORKER_URL%/}"
tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT

echo
echo "GET $WORKER_URL"
curl -fsS "$WORKER_URL" | tee "$tmp" >/dev/null
node -e 'const s=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")); if(!Array.isArray(s.items)||!Array.isArray(s.held)||!Array.isArray(s.overrides)) process.exit(1);' "$tmp"

echo "JSONP"
curl -fsS "$WORKER_URL?callback=onExclusions" | tee "$tmp" >/dev/null
node -e 'const t=require("fs").readFileSync(process.argv[1],"utf8"); if(!t.startsWith("onExclusions(")||!t.endsWith(");")) process.exit(1); JSON.parse(t.slice("onExclusions(".length,-2));' "$tmp"

post() {
  curl -fsS -X POST "$WORKER_URL" \
    -H "Content-Type: text/plain;charset=utf-8" \
    --data "$1" | tee "$tmp" >/dev/null
  node -e 'const s=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")); if(s.error){ console.error(s.error); process.exit(1);} ' "$tmp"
}

echo "exclude / restore"
post '{"action":"exclude","type":"煙霧測試","name":"剔除","note":"smoke"}'
post '{"action":"restore","type":"煙霧測試","name":"剔除"}'

echo "hold / unhold"
post '{"action":"hold","type":"煙霧測試","name":"暫緩","note":"smoke"}'
post '{"action":"unhold","type":"煙霧測試","name":"暫緩"}'

echo "reclass / clear"
post '{"action":"reclass","type":"煙霧測試","name":"改類","newType":"煙霧測試","newSubtype":"子類"}'
post '{"action":"reclass_clear","type":"煙霧測試","name":"改類"}'

if [[ -n "${WRITE_SECRET:-}" ]]; then
  echo "admin seed (idempotent)"
  curl -fsS -X POST "$WORKER_URL/admin/seed" \
    -H "Authorization: Bearer $WRITE_SECRET" | tee "$tmp" >/dev/null
  node -e 'const s=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")); if(typeof s.added!=="number"||!Array.isArray(s.overrides)) process.exit(1);' "$tmp"
else
  echo "WRITE_SECRET is not set. Skipped /admin/seed."
fi

echo "smoke ok"
