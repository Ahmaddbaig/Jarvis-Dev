# Install Jarvis Local AI on M2 Mac and RTX 3060 Ti Windows PC

Updated for the profile-aware speech-recognition and Speech Vocabulary system.

The first part of this guide is for the **Apple M2 Mac with 8 GB of RAM**. It
installs the lightweight M2 model and runs Jarvis without an OpenAI API key or
per-question AI charges. A separate Windows section below covers a PC with an
**NVIDIA RTX 3060 Ti Founders Edition and 16 GB of DDR4 RAM**.

> **Important:** Install only the M2 profile on this Mac. Do not run the M3 or
> M5 installers and do not copy another Mac's `.local-ai` folder. The installer
> checks the chip and refuses a mismatched profile.

## What the M2 profile installs

- LocalAI 4.7.1 for Apple silicon
- Qwen3.5 2B quantized language model (`qwen_qwen3.5-2b`)
- Parakeet EOU 120M streaming speech recognition
- Silero voice activity detection
- Kokoro local speech with British male speaker 26
- Metal-enabled LocalAI backends
- Global speech correction and a user-editable vocabulary for every ability

The M2 deliberately uses the 120M recognizer to remain responsive with 8 GB of
RAM. The M3 and M5 profiles use a larger Nemotron 3.5 ASR Streaming 0.6B model,
but that model is not downloaded on the M2.

The files are stored inside this repository at `.local-ai/`. Keep several GB
of free disk space available before starting.

## 1. Get the correct Jarvis branch

Open Terminal and go to the Jarvis repository. Change the path below if the
project is stored somewhere else on the M2:

```bash
cd ~/Desktop/Project
git switch LocalLLM/Feature
git pull
```

Confirm that this guide and the installer exist:

```bash
ls localllm.md scripts/local-ai/install-macos.zsh RUN-JARVIS-DEV.command
```

## 2. Confirm that this is the M2 Mac

```bash
system_profiler SPHardwareDataType | grep -E "Chip|Memory"
```

The output should report an Apple M2 chip. This guide expects 8 GB of memory.

## 3. Install only the M2 Local AI profile

From the repository root, run:

```bash
chmod +x scripts/local-ai/install-macos.zsh scripts/local-ai/start.zsh RUN-JARVIS-DEV.command
./scripts/local-ai/install-macos.zsh m2
```

The installer downloads only the M2 language model, the lightweight M2 speech
recognizer, and the shared voice components. It does **not** download the M3 or
M5 language models or their larger speech recognizer. Downloads can take a
while, so keep the Mac awake and leave Terminal open.

The final output should include:

```text
Jarvis Local AI M2 / 8 GB is installed.
```

Confirm the recorded profile:

```bash
cat .local-ai/installed-profile
```

It must print:

```text
m2
```

Confirm that the lightweight M2 speech model is selected:

```bash
grep transcription .local-ai/models/jarvis-local-m2.yaml
```

Expected result:

```text
transcription: parakeet-cpp-realtime_eou_120m-v1
```

## 4. Start Jarvis

Double-click `RUN-JARVIS-DEV.command` in Finder, or run:

```bash
./RUN-JARVIS-DEV.command
```

The launcher automatically:

1. Installs missing npm dependencies.
2. Repairs Electron if its application payload is missing.
3. Starts the installed M2 LocalAI server.
4. Loads the M2 voice pipeline into memory.
5. Warms the realtime audio connection before opening Jarvis.

The first startup after a reboot or installation is slower because the model
must be loaded. Keep the launcher Terminal window open while using Jarvis.

## 5. Select the M2 profile in Jarvis

In **Jarvis → Settings → Jarvis**:

1. Choose **Local AI** under Voice Engine.
2. Choose **M2 Local — 8 GB RAM**.
3. Leave Local AI Server as `http://127.0.0.1:8080`.
4. Under Microphone Input, choose **MacBook Microphone** if a Bluetooth headset
   is mishearing words.
5. Add important names, artists, applications, devices, acronyms, and project
   terms under **Speech Vocabulary**, separated by commas or new lines.
6. Select **Save Configuration**.

Selecting a profile in Settings never downloads anything. The installer in
step 3 is what places the M2 model on the computer.

## How general speech correction works

Speech Vocabulary is shared by the complete Local AI assistant, not only by
Spotify. Jarvis supplies it to speech recognition and instructs the local
language model to repair likely phonetic mistakes and missing word boundaries
before calling any ability.

It helps with:

- People and company names
- Artists, songs, albums, and playlists
- Applications and smart-home devices
- Project names and technical vocabulary
- Acronyms that ordinary speech recognition often spells incorrectly

Enter the correct spelling of each term. A useful starter list might look like:

```text
Ahmad, Skillet, Bambu Lab, Home Assistant, Jarvis, Spotify
```

Jarvis includes built-in hints for Jarvis, Spotify, Skillet, Home Assistant,
Bambu Lab, OpenAI, and LocalAI. Add terms that are specific to the person using
this M2. Saving the configuration reconnects the voice session with the updated
hints.

The correction layer preserves exact URLs, file paths, identifiers, codes, and
numbers instead of trying to rewrite them.

## 6. Grant macOS permissions

Open **Jarvis → Settings → System → macOS Permissions** and grant:

- **Accessibility** for mouse, keyboard, Spotify, and Computer Use control
- **Screen & System Audio Recording** so Computer Use can see the screen
- **Microphone** so Jarvis can hear you

The development application can appear in macOS as **Electron** or
**Jarvis Dev**. If it is missing from Accessibility, use **Reveal App in
Finder** in Jarvis, click the macOS `+` button, and add:

```text
node_modules/electron/dist/Electron.app
```

macOS requires the user to enable these switches manually. If macOS asks to
quit and reopen the app after granting a permission, close Jarvis and run
`RUN-JARVIS-DEV.command` again.

## 7. Check that LocalAI is running

With Jarvis open, run this in another Terminal window:

```bash
curl -fsS http://127.0.0.1:8080/readyz && echo "LocalAI is ready"
```

Expected result:

```text
LocalAI is ready
```

## M2 performance tips

- Use **M2 Local**, not the larger M3 or M5 profiles.
- Close memory-heavy applications when possible; an 8 GB Mac can start using
  slower disk swap when many applications are open.
- Keep reasoning disabled for fast conversational responses. The supplied M2
  pipeline already does this.
- Use the MacBook microphone for recognition and Bluetooth headphones only for
  listening if the headset microphone produces inaccurate words.
- Put commonly misheard proper nouns in Speech Vocabulary rather than adding
  one-off corrections to individual tools.
- Speak a short pause between the request and surrounding conversation so the
  end-of-utterance detector receives a clean command.
- The local model is smaller than hosted OpenAI models, so answers may be less
  capable, but voice requests do not incur API charges.

## Windows: RTX 3060 Ti Founders Edition and 16 GB DDR4

The RTX 3060 Ti Founders Edition has 8 GB of dedicated VRAM. The recommended
Jarvis setup therefore favors a responsive 4B language model and lightweight
streaming voice components instead of trying to fill the card with a 9B model.

### First decide what the Windows computer is doing

- **Jarvis Companion only:** do not install LocalAI or any voice models. The
  main Jarvis computer performs speech recognition, language-model inference,
  and speech generation; the companion only receives authenticated commands.
- **Full Jarvis or a LocalAI server:** follow the steps below. This is the setup
  that uses the RTX 3060 Ti.

The current one-command `install-macos.zsh` installer is only for Apple
silicon. Do not run it in Windows or WSL. The Windows setup uses LocalAI's
NVIDIA CUDA 12 Docker image instead.

### Recommended Windows models

| Job | Recommended model | Why |
| --- | --- | --- |
| Language model | `qwen_qwen3.5-4b` | Best balance of tool use, answer quality, and low latency within 8 GB VRAM |
| Speech recognition | `parakeet-cpp-nemotron-3.5-asr-streaming-0.6b` | The existing M3-compatible streaming recognizer with better accuracy than the smallest M2 recognizer |
| Voice activity detection | `silero-vad-sherpa` | Small and fast; it does not consume meaningful GPU memory |
| Text to speech | `kokoro-multi-lang-v1.0-sherpa` | Fast streaming local speech; Jarvis currently selects British male speaker `26` |
| Realtime pipeline | `jarvis-local-m3` | Already matches the 4B/16 GB stack and works with Jarvis's current profile selector |

Choose **M3 Local — 16 GB RAM** in Jarvis on this Windows computer. The label
says M3 because this Windows-specific label has not been added to the settings
screen yet; it is also the correct 4B compatibility profile for this PC.

### Can Jarvis also use the 16 GB of DDR4 RAM?

Yes. LocalAI's llama.cpp backend can keep some model layers in normal DDR4 RAM
and offload as many layers as possible to the 3060 Ti. The GPU's 8 GB VRAM and
the PC's 16 GB system RAM are therefore both useful, but they are not one
equally fast 24 GB memory pool:

- VRAM is the fast memory directly attached to the GPU.
- Layers left in DDR4 are processed by the CPU or moved across PCIe, which is
  much slower than keeping the complete active model on the GPU.
- Windows, Jarvis, WSL 2, Docker, and the voice services also consume part of
  the 16 GB of DDR4. It is not all available to the language model.
- If Windows starts using its page file, response time can become dramatically
  slower because model data is being moved to the SSD.

This makes two useful operating modes possible:

| Mode | Model | Expected behavior |
| --- | --- | --- |
| Fast voice, recommended | Qwen3.5 4B | Keeps substantially more work on the GPU and leaves headroom for ASR, TTS, context, and the desktop |
| Higher-quality experiment | Qwen3.5 9B, partially offloaded | Can use both VRAM and DDR4, but takes longer to begin and generate answers and may encounter memory pressure |

The M5 9B profile is therefore possible as an experiment, but it is not the
default for an always-listening, quick-response Jarvis on this PC. Start with a
small context, close games and memory-heavy applications, and watch both
`nvidia-smi` and Windows Task Manager while testing it. Switch back to the 4B
M3-compatible profile if memory usage approaches the limit, Windows starts
paging, or voice replies no longer feel immediate.

A 7B/8B Q4 model is another middle ground for text-only use, but the supplied
Jarvis profiles currently provide 4B and 9B choices. The 4B model remains the
best default when the language model, speech recognizer, and voice generator
must all run together.

### 1. Prepare Windows, WSL 2, and the NVIDIA GPU

Use an up-to-date Windows 11 installation if possible. Install the latest
NVIDIA Windows driver for the RTX 3060 Ti, then open **PowerShell as
Administrator** and run:

```powershell
wsl --install
wsl --update
```

Restart Windows if requested. Install Docker Desktop for Windows, open
**Docker Desktop → Settings → General**, and make sure **Use the WSL 2 based
engine** is enabled. Docker's GPU support on Windows requires this WSL 2
backend.

Confirm that Docker can see the 3060 Ti:

```powershell
docker run --rm --gpus all nvidia/cuda:12.8.0-base-ubuntu24.04 nvidia-smi
```

The output must list an NVIDIA GeForce RTX 3060 Ti. Fix the driver, WSL, or
Docker configuration before continuing if it does not.

### 2. Start the CUDA 12 LocalAI server

Run these commands in PowerShell. Named Docker volumes preserve downloaded
models and backends when the container is restarted or replaced:

```powershell
docker volume create jarvis-localai-models
docker volume create jarvis-localai-backends

docker run -d --name jarvis-localai --restart unless-stopped `
  --gpus all `
  -p 127.0.0.1:8080:8080 `
  -e LOCALAI_FORCE_META_BACKEND_CAPABILITY=nvidia `
  -e LOCALAI_VRAM_BUDGET=7GB `
  -v jarvis-localai-models:/models `
  -v jarvis-localai-backends:/backends `
  localai/localai:v4.7.1-gpu-nvidia-cuda-12
```

The 7 GB LocalAI budget leaves some VRAM for Windows display use. Keep the
server bound to `127.0.0.1` when Jarvis runs on the same PC; this avoids exposing
an unauthenticated AI endpoint to the network.

Wait for the server to start, then check it:

```powershell
curl.exe -f http://127.0.0.1:8080/readyz
docker logs --tail 100 jarvis-localai
```

### 3. Install only the Windows 3060 Ti model set

Open the LocalAI model gallery at
[`http://127.0.0.1:8080`](http://127.0.0.1:8080), go to **Models**, and install
only these four entries:

```text
qwen_qwen3.5-4b
parakeet-cpp-nemotron-3.5-asr-streaming-0.6b
silero-vad-sherpa
kokoro-multi-lang-v1.0-sherpa
```

Do not also download the M2 2B or M5 9B language model. Keep at least 15 GB of
SSD space free for the Docker image, backends, model downloads, and temporary
files.

From the Jarvis repository root in PowerShell, copy the matching realtime
pipeline into the persistent model volume and restart LocalAI:

```powershell
docker cp .\scripts\local-ai\pipelines\jarvis-local-m3.yaml jarvis-localai:/models/jarvis-local-m3.yaml
docker restart jarvis-localai
```

Confirm that all five entries, including the pipeline, are visible:

```powershell
curl.exe -s http://127.0.0.1:8080/v1/models
```

### 4. Connect Jarvis

In **Jarvis → Settings → Jarvis**:

1. Choose **Local AI**.
2. Choose **M3 Local — 16 GB RAM**.
3. Leave Local AI Server as `http://127.0.0.1:8080`.
4. Choose the physical microphone you want Jarvis to use.
5. Add frequently misheard names and commands under **Speech Vocabulary**.
6. Save the configuration.

The first question after LocalAI starts can be slower while the models load.
Later questions should return more quickly because the models remain warm.

### Windows voice choices

For the quickest replies, keep **Kokoro**. Jarvis currently sends speaker ID
`26`, a British male preset. It is intended to feel Jarvis-like, but it is not
Paul Bettany's voice and is not an exact copy of the movie voice.

The RTX 3060 Ti can also experiment with these LocalAI gallery voices:

- `qwen3-tts-cpp-0.6b-base-q4`: approximately 0.6 GB, streaming, and supports
  voice cloning from a reference recording.
- `qwen3-tts-cpp-customvoice`: includes named English speakers such as Ryan and
  Aiden.
- `vits-piper-en_GB-vctk-medium-sherpa`: lightweight British multi-speaker
  voice with many speaker choices.

Installing an alternative TTS model does **not** automatically switch Jarvis
away from Kokoro; the realtime pipeline and Jarvis voice setting must also be
updated. Use only your own voice or a voice you have permission to clone. Do
not clone an actor or another real person without their consent.

For an always-on assistant, try the Qwen3-TTS 0.6B Q4 option before any 1.7B
voice model. The larger voice models reduce the VRAM available to the 4B
language model and can make responses begin more slowly.

### Windows maintenance and troubleshooting

Start, stop, restart, or inspect the server with:

```powershell
docker start jarvis-localai
docker stop jarvis-localai
docker restart jarvis-localai
docker logs --tail 100 jarvis-localai
```

If responses are slow or LocalAI reports CUDA out-of-memory errors:

1. Close games and other GPU-heavy applications.
2. Confirm that **M3 Local**, not M5 Local, is selected.
3. Restart `jarvis-localai` so an experimental model is unloaded.
4. Keep reasoning disabled and use the supplied streaming pipeline.
5. Check the logs for CUDA/NVIDIA initialization rather than a CPU fallback.

If the Windows PC is only running Jarvis Companion, stop and remove only the
unneeded LocalAI container; the named model volumes can be retained in case
the PC later becomes the main Jarvis computer:

```powershell
docker stop jarvis-localai
docker rm jarvis-localai
```

### Official references for the Windows setup

- [NVIDIA RTX 3060 Ti specifications](https://www.nvidia.com/en-us/geforce/graphics-cards/30-series/rtx-3060-3060ti/)
- [Docker Desktop GPU support on Windows](https://docs.docker.com/desktop/features/gpu/)
- [Docker Desktop WSL 2 setup](https://docs.docker.com/desktop/features/wsl/)
- [Microsoft WSL GPU acceleration setup](https://learn.microsoft.com/en-us/windows/wsl/tutorials/gpu-compute)
- [LocalAI NVIDIA containers and GPU configuration](https://localai.io/features/gpu-acceleration/)
- [LocalAI model gallery](https://localai.io/gallery.html)
- [LocalAI realtime voice pipeline](https://localai.io/features/openai-realtime/)

## Troubleshooting

### Jarvis says LocalAI is unavailable

Confirm the profile and inspect the latest server log:

```bash
cat .local-ai/installed-profile
tail -n 50 .local-ai/run/local-ai.log
```

If installation was interrupted, rerun the same M2 command. It is safe to run
again and reuses components that are already installed:

```bash
./scripts/local-ai/install-macos.zsh m2
```

### Port 8080 is already in use

Check which process owns it:

```bash
lsof -nP -iTCP:8080 -sTCP:LISTEN
```

Close the older Jarvis/LocalAI launcher before starting another copy.

### Electron does not start

Run the launcher from Terminal so its repair output remains visible:

```bash
./RUN-JARVIS-DEV.command
```

The launcher automatically rebuilds or restores Electron when its executable
payload is missing.

### Bluetooth headphones cause bad transcription

Keep the headphones connected for audio output, then choose **MacBook
Microphone** under Jarvis's Microphone Input setting. Bluetooth headsets can
switch to a lower-bandwidth call mode when their microphone is active.

### A name or technical term is repeatedly misheard

1. Open **Jarvis → Settings → Jarvis**.
2. Confirm **M2 Local** is selected.
3. Add the correct spelling under **Speech Vocabulary**.
4. Choose **MacBook Microphone** for input when possible.
5. Save the configuration and repeat the request.

This vocabulary applies to every local ability. Do not modify the Spotify,
calendar, smart-home, or Computer Use code for an ordinary recognition mistake.

### Words are joined together

The current Local AI code instructs the model to restore normal spaces in
human-language tool arguments. First pull the newest `LocalLLM/Feature` branch
and restart Jarvis. If a particular proper noun is still involved, add its
correct spelling to Speech Vocabulary.

## Return to OpenAI later

Open Jarvis Settings and choose **OpenAI** under Voice Engine. Switching engines
does not delete the local M2 installation or any saved OpenAI setting.
