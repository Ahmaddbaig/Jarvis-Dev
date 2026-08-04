#!/bin/zsh
set -e

cd -- "$(dirname "$0")"

if [[ ! -x node_modules/.bin/electron ]]; then
  echo "Jarvis Dev dependencies are missing. Installing them now..."
  npm install --include=dev
fi

echo "Starting Jarvis Dev from the editable source code..."
echo "Close this Terminal window or press Control-C to stop it."

electron_app="$PWD/node_modules/electron/dist/Electron.app"
electron_binary="$electron_app/Contents/MacOS/Electron"
next_binary="$PWD/node_modules/next/dist/bin/next"

ELECTRON_RUN_AS_NODE=1 "$electron_binary" "$next_binary" dev --webpack -H 127.0.0.1 -p 3100 &
jarvis_next_pid=$!

cleanup() {
  kill -TERM "$jarvis_next_pid" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

for jarvis_check in {1..60}; do
  if curl --max-time 1 -fsS http://127.0.0.1:3100/ >/dev/null 2>&1; then
    break
  fi
  if ! kill -0 "$jarvis_next_pid" 2>/dev/null; then
    wait "$jarvis_next_pid"
    exit $?
  fi
  sleep 1
done

open -n -a "$electron_app" \
  --env JARVIS_PORT=3100 \
  --env JARVIS_HTTPS_PORT=3543 \
  --args "$PWD"

wait "$jarvis_next_pid"
