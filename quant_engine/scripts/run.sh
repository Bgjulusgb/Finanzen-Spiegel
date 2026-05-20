#!/usr/bin/env bash
set -euo pipefail

# Quant Engine Launcher.
# Erkennt automatisch venv und startet uvicorn.

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
cd "$ROOT"

if [[ -d "../.venv" ]] && [[ -x "../.venv/bin/uvicorn" ]]; then
  VENV="../.venv"
elif [[ -d ".venv" ]] && [[ -x ".venv/bin/uvicorn" ]]; then
  VENV=".venv"
else
  echo ">> Erzeuge virtuelles Environment ..."
  python3 -m venv .venv
  VENV=".venv"
  "$VENV/bin/pip" install --upgrade pip setuptools wheel
  "$VENV/bin/pip" install -r requirements.txt
fi

HOST="${QUANT_HOST:-0.0.0.0}"
PORT="${QUANT_PORT:-8080}"

export PYTHONPATH="$ROOT/src:${PYTHONPATH:-}"
echo ">> Starte Quant Engine auf http://$HOST:$PORT"
exec "$VENV/bin/uvicorn" quant_engine.api.app:app --host "$HOST" --port "$PORT" "$@"
