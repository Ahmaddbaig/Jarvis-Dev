#!/bin/zsh
set -euo pipefail

script_dir=${0:A:h}
repo_root=${script_dir:h:h}
localai_root="$repo_root/.local-ai"
localai_binary="$localai_root/bin/local-ai"
profile_file="$localai_root/installed-profile"

if [[ ! -x "$localai_binary" || ! -f "$profile_file" ]]; then
  echo "Jarvis Local AI is not installed. Run scripts/local-ai/install-macos.zsh first."
  exit 1
fi

installed_profile=$(tr -d '[:space:]' < "$profile_file")
case "$installed_profile" in
  m2|m3|m5) ;;
  *)
    echo "Invalid installed Local AI profile: '$installed_profile'."
    exit 1
    ;;
esac

mkdir -p "$localai_root/data" "$localai_root/generated" "$localai_root/run"

export LOCALAI_MODELS_PATH="$localai_root/models"
export LOCALAI_BACKENDS_PATH="$localai_root/backends"
export LOCALAI_DATA_PATH="$localai_root/data"
export LOCALAI_GENERATED_CONTENT_PATH="$localai_root/generated"

exec "$localai_binary" run \
  --address=127.0.0.1:8080 \
  --cors \
  --cors-allow-origins='http://127.0.0.1:3000,http://localhost:3000,http://127.0.0.1:3100,http://localhost:3100' \
  --disable-web-ui \
  --disable-local-ai-assistant \
  --disable-agents \
  --disable-mcp \
  --f16 \
  --threads=8 \
  --context-size=8192 \
  --max-active-backends=6 \
  --log-level=info
