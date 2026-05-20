#!/usr/bin/env bash
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
cd "$ROOT"

if [[ -x "../.venv/bin/pytest" ]]; then
  VENV="../.venv"
elif [[ -x ".venv/bin/pytest" ]]; then
  VENV=".venv"
else
  echo "Bitte zuerst Dependencies installieren (siehe scripts/run.sh)."
  exit 1
fi

export PYTHONPATH="$ROOT/src:${PYTHONPATH:-}"
exec "$VENV/bin/pytest" tests/ "$@"
