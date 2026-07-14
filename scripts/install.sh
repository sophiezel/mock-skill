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

echo "[mock-skill] npm link..."
npm link

SKILL_LINK="${HOME}/.agents/skills/api-mock-orchestrator"
mkdir -p "${HOME}/.agents/skills"
ln -sfn "$ROOT" "$SKILL_LINK"
echo "[mock-skill] skill symlink: $SKILL_LINK -> $ROOT"

echo ""
echo "[mock-skill] done. Try:"
echo "  mock-skill --help"
echo "  cd <your-frontend-project> && mock-skill init"
echo ""
command -v mock-skill >/dev/null && mock-skill --help | head -n 20 || echo "  (mock-skill not on PATH yet — use: node $ROOT/bin/mock-skill.js)"
