#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "[mock-skill] uninstall"

npm unlink -g mock-skill 2>/dev/null || true
npm unlink 2>/dev/null || true

SKILL_LINK="${HOME}/.agents/skills/api-mock-orchestrator"
if [[ -L "$SKILL_LINK" ]]; then
  rm -f "$SKILL_LINK"
  echo "[mock-skill] removed symlink $SKILL_LINK"
fi

echo "[mock-skill] uninstall done (data under .data/ kept)"
