#!/bin/zsh
set -e

cd -- "$(dirname "$0")"

electron_app="$PWD/node_modules/electron/dist/Electron.app"
electron_binary="$electron_app/Contents/MacOS/Electron"
local_ai_pid=""
jarvis_next_pid=""

cleanup() {
  if [[ -n "$jarvis_next_pid" ]]; then
    next_pid_to_stop="$jarvis_next_pid"
    jarvis_next_pid=""
    kill -TERM "$next_pid_to_stop" 2>/dev/null || true
  fi
  if [[ -n "$local_ai_pid" ]]; then
    echo "Stopping the Jarvis Local AI server..."
    local_ai_pid_to_stop="$local_ai_pid"
    local_ai_pid=""
    kill -TERM "$local_ai_pid_to_stop" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

if [[ ! -x node_modules/.bin/electron ]]; then
  echo "Jarvis Dev dependencies are missing. Installing them now..."
  npm install --include=dev
fi

if [[ ! -x "$electron_binary" ]]; then
  echo "The Electron application payload is missing. Repairing it now..."
  npm rebuild electron || true
fi

if [[ ! -x "$electron_binary" ]]; then
  echo "Electron's npm extractor did not finish. Using the verified Electron archive..."
  electron_archive=$(node <<'NODE'
const { downloadArtifact } = require('@electron/get');
const electronPackage = require('./node_modules/electron/package.json');
const projectPackage = require('./package.json');
const approval = `electron@${electronPackage.version}`;

if (projectPackage.allowScripts?.[approval] !== true && projectPackage.allowScripts?.electron !== true) {
  throw new Error(`${approval} is not approved in package.json#allowScripts`);
}

downloadArtifact({
  version: electronPackage.version,
  artifactName: 'electron',
  platform: 'darwin',
  arch: process.arch,
  checksums: require('./node_modules/electron/checksums.json'),
}).then(console.log).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
NODE
  )
  /usr/bin/ditto -x -k "$electron_archive" "$PWD/node_modules/electron/dist"
  print -rn -- 'Electron.app/Contents/MacOS/Electron' > "$PWD/node_modules/electron/path.txt"
fi

if [[ ! -x "$electron_binary" ]]; then
  echo "Jarvis Dev could not install Electron. See the npm output above for details."
  exit 1
fi

local_ai_binary="$PWD/.local-ai/bin/local-ai"
local_ai_profile_file="$PWD/.local-ai/installed-profile"
local_ai_launcher="$PWD/scripts/local-ai/start.zsh"

if [[ -x "$local_ai_binary" && -f "$local_ai_profile_file" && -x "$local_ai_launcher" ]]; then
  installed_profile=$(tr -d '[:space:]' < "$local_ai_profile_file")
  case "$installed_profile" in
    m2|m3|m5)
      if ! curl --max-time 1 -fsS http://127.0.0.1:8080/readyz >/dev/null 2>&1; then
        echo "Starting the installed ${installed_profile:u} Local AI server..."
        "$local_ai_launcher" > "$PWD/.local-ai/run/local-ai.log" 2>&1 &
        local_ai_pid=$!

        for local_ai_check in {1..120}; do
          if curl --max-time 1 -fsS http://127.0.0.1:8080/readyz >/dev/null 2>&1; then
            break
          fi
          if ! kill -0 "$local_ai_pid" 2>/dev/null; then
            echo "Local AI stopped during startup. Recent log output:"
            tail -n 20 "$PWD/.local-ai/run/local-ai.log" 2>/dev/null || true
            local_ai_pid=""
            break
          fi
          sleep 1
        done
      fi

      if curl --max-time 1 -fsS http://127.0.0.1:8080/readyz >/dev/null 2>&1; then
        echo "Warming jarvis-local-${installed_profile} for quick first responses..."
        if ! curl --fail --silent --show-error --max-time 300 \
          -X POST http://127.0.0.1:8080/backend/load \
          -H 'Content-Type: application/json' \
          -d "{\"model\":\"jarvis-local-${installed_profile}\"}" >/dev/null; then
          echo "Local AI warm-up did not complete. Jarvis will still open; see .local-ai/run/local-ai.log."
        fi

        echo "Warming the Local AI realtime audio connection..."
        if ! JARVIS_LOCAL_AI_MODEL="jarvis-local-${installed_profile}" \
          "$electron_binary" "$PWD/scripts/local-ai/smoke-webrtc.cjs" >/dev/null; then
          echo "Local AI audio warm-up did not complete. Jarvis will still open; see .local-ai/run/local-ai.log."
        fi
      fi
      ;;
    *)
      echo "Ignoring invalid Local AI installed profile '$installed_profile'."
      ;;
  esac
fi

echo "Starting Jarvis Dev from the editable source code..."
echo "Close this Terminal window or press Control-C to stop it."

next_binary="$PWD/node_modules/next/dist/bin/next"
jarvis_chrome_ui_token="$(/usr/bin/openssl rand -hex 32)"

JARVIS_CHROME_UI_TOKEN="$jarvis_chrome_ui_token" ELECTRON_RUN_AS_NODE=1 "$electron_binary" "$next_binary" dev --webpack -H 127.0.0.1 -p 3100 &
jarvis_next_pid=$!

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
  --env JARVIS_CHROME_UI_TOKEN="$jarvis_chrome_ui_token" \
  --env JARVIS_PROJECT_DIR="$PWD" \
  --args "$PWD"

wait "$jarvis_next_pid"
