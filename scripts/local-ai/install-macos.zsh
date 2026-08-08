#!/bin/zsh
set -euo pipefail

script_dir=${0:A:h}
repo_root=${script_dir:h:h}
localai_root="$repo_root/.local-ai"
localai_binary="$localai_root/bin/local-ai"
models_dir="$localai_root/models"
backends_dir="$localai_root/backends"
run_dir="$localai_root/run"
localai_version="4.7.1"
release_name="local-ai-v${localai_version}-darwin-arm64"
release_base="https://github.com/mudler/LocalAI/releases/download/v${localai_version}"

if [[ "$(uname -s)" != "Darwin" || "$(uname -m)" != "arm64" ]]; then
  echo "Jarvis Local AI currently supports Apple-silicon Macs only."
  exit 1
fi

detected_chip=$(system_profiler SPHardwareDataType 2>/dev/null | awk -F': ' '/^[[:space:]]*Chip:/{print $2; exit}')
requested_profile=${1:-}
detected_profile=""

case "$detected_chip" in
  *M2*) detected_profile="m2" ;;
  *M3*) detected_profile="m3" ;;
  *M5*) detected_profile="m5" ;;
esac

if [[ -z "$detected_profile" ]]; then
  echo "The detected chip '$detected_chip' does not have a supported Jarvis Local AI profile."
  echo "Supported profiles are Apple M2, M3, and M5."
  exit 1
fi

if [[ -z "$requested_profile" ]]; then
  requested_profile="$detected_profile"
fi

if [[ "$requested_profile" != "$detected_profile" ]]; then
  echo "This is an $detected_chip Mac, but the '$requested_profile' profile was requested."
  echo "Refusing to download a different Mac's model. Use '$detected_profile' on this computer."
  exit 1
fi

case "$requested_profile" in
  m2)
    llm_model="qwen_qwen3.5-2b"
    transcription_model="parakeet-cpp-realtime_eou_120m-v1"
    profile_description="M2 / 8 GB"
    ;;
  m3)
    llm_model="qwen_qwen3.5-4b"
    transcription_model="parakeet-cpp-nemotron-3.5-asr-streaming-0.6b"
    profile_description="M3 / 16 GB"
    ;;
  m5)
    llm_model="qwen3.5-9b"
    transcription_model="parakeet-cpp-nemotron-3.5-asr-streaming-0.6b"
    profile_description="M5 / 24 GB"
    ;;
  *)
    echo "Unknown profile '$requested_profile'. Use m2, m3, or m5."
    exit 1
    ;;
esac

pipeline_model="jarvis-local-${requested_profile}"
pipeline_source="$script_dir/pipelines/${pipeline_model}.yaml"

echo "Installing only the $profile_description Local AI profile."
echo "The other Mac profiles will not be downloaded."

mkdir -p "$localai_root/bin" "$models_dir" "$backends_dir" "$run_dir"

needs_binary=true
if [[ -x "$localai_binary" ]] && [[ "$($localai_binary --version 2>/dev/null)" == "v${localai_version}" ]]; then
  needs_binary=false
fi

if [[ "$needs_binary" == true ]]; then
  checksum_file="$run_dir/LocalAI-v${localai_version}-checksums.txt"
  binary_download="$run_dir/$release_name"
  curl --fail --location --progress-bar "$release_base/checksums.txt" --output "$checksum_file"
  curl --fail --location --progress-bar "$release_base/$release_name" --output "$binary_download"

  expected_checksum=$(awk -v filename="$release_name" '$2 == filename { print $1; exit }' "$checksum_file")
  actual_checksum=$(shasum -a 256 "$binary_download" | awk '{ print $1 }')
  if [[ -z "$expected_checksum" || "$actual_checksum" != "$expected_checksum" ]]; then
    echo "LocalAI checksum verification failed. Nothing was installed."
    exit 1
  fi

  mv "$binary_download" "$localai_binary"
  chmod +x "$localai_binary"
fi

export LOCALAI_MODELS_PATH="$models_dir"
export LOCALAI_BACKENDS_PATH="$backends_dir"

for backend_name in metal-llama-cpp metal-parakeet-cpp metal-sherpa-onnx metal-opus; do
  if [[ ! -d "$backends_dir/$backend_name" ]]; then
    "$localai_binary" backends install "$backend_name"
  fi
done

# These speech pipeline models are shared by every profile. Only one LLM is
# selected above, so running this on an M5 never downloads the M2 or M3 LLM.
for model_name in \
  silero-vad-sherpa \
  "$transcription_model" \
  kokoro-multi-lang-v1.0-sherpa \
  "$llm_model"; do
  "$localai_binary" models install "$model_name"
done

cp "$pipeline_source" "$models_dir/${pipeline_model}.yaml"
print -r -- "$requested_profile" > "$localai_root/installed-profile"

echo "Hashing the selected profile and writing its activation manifest..."
python3 "$repo_root/services/ai-engine/generate_manifest.py" "$localai_root" "$requested_profile"

echo
echo "Jarvis Local AI $profile_description is installed."
echo "Start Jarvis with RUN-JARVIS-DEV.command, then choose Local AI > ${requested_profile:u} Local in Settings."
