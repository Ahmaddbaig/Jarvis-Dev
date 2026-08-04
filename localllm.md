# Install Jarvis Local AI on the M2 Mac

Updated for the profile-aware speech-recognition and Speech Vocabulary system.

This guide is for the **Apple M2 Mac with 8 GB of RAM**. It installs the
lightweight M2 model and runs Jarvis without an OpenAI API key or per-question
AI charges.

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
