#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "[mock-skill] install root=$ROOT"

NODE_MAJOR="$(node -p "process.versions.node.split('.')[0]" 2>/dev/null || echo 0)"
if [[ "$NODE_MAJOR" -lt 18 ]]; then
  echo "[mock-skill] Node >= 18 required (found $(node -v 2>/dev/null || echo none))"
  exit 1
fi

npm install

# Sanity: materialize path depends on json-schema-faker
node -e "require('json-schema-faker'); require('./lib/infer/shape-json-schema'); require('./lib/materialize');" \
  || { echo "[mock-skill] dependency check failed"; exit 1; }

echo "[mock-skill] npm link..."
npm link

SKILL_LINK="${HOME}/.agents/skills/api-mock-orchestrator"
mkdir -p "${HOME}/.agents/skills"
ln -sfn "$ROOT" "$SKILL_LINK"
echo "[mock-skill] skill symlink (optional Agent orchestration): $SKILL_LINK -> $ROOT"

echo ""
echo "[mock-skill] done. Primary track (0 backend dependency):"
echo "  mock-skill --help"
echo "  cd <your-frontend-project> && mock-skill init --name=<slug>"
echo "  mock-skill start --name=<slug>"
echo "  mock-skill scenario e2e-happy   # or e2e-fault / e2e-slow"
echo "  mock-skill smoke --ci"
echo "  mock-skill stop --name=<slug>"
echo ""
echo "Optional fidelity upgrade (needs real upstream; not for E2E):"
echo "  mock-skill start --name=<slug> --record"
echo "  mock-skill stop --auto-merge --name=<slug>"
echo ""
if command -v mock-skill >/dev/null; then
  mock-skill --help | head -n 30
else
  echo "  (mock-skill not on PATH yet — use: node $ROOT/bin/mock-skill.js)"
fi
