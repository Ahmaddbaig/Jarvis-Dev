# Jarvis Local AI installation

Jarvis can use OpenAI, ElevenLabs, or a completely local voice pipeline. Local
mode sends microphone audio only to LocalAI on your own Mac at `127.0.0.1`; it
does not need an API key or a paid AI subscription.

## Install the model for each Mac

Run only the command that matches the Mac you are currently using:

```bash
# M5 Mac with 24 GB RAM (this Mac)
./scripts/local-ai/install-macos.zsh m5

# M3 Mac with 16 GB RAM (run this later, on that M3)
./scripts/local-ai/install-macos.zsh m3

# M2 Mac with 8 GB RAM (run this later, on that M2)
./scripts/local-ai/install-macos.zsh m2
```

Do not run all three installers on one computer. Choosing M2, M3, or M5 in the
Jarvis Settings screen never downloads a model. The installer downloads only
the selected computer's language model plus the small speech components shared
by every profile.

| Jarvis profile | Intended Mac | Local language model | Why |
| --- | --- | --- | --- |
| M2 Local | M2, 8 GB | Qwen3.5 2B, quantized | Lowest memory and fastest response |
| M3 Local | M3, 16 GB | Qwen3.5 4B, quantized | Balanced quality and speed |
| M5 Local | M5, 24 GB | Qwen3.5 9B, quantized | Best local quality on this Mac |

The M2 profile uses the lightweight streaming 120M Parakeet recognizer. The M3
and M5 profiles use the higher-accuracy, prompt-conditioned Nemotron 3.5 ASR
Streaming 0.6B recognizer. Every profile uses Silero voice activity detection
and the Kokoro 82M British male voice (speaker 26). The voice is a calm,
synthetic Jarvis-inspired preset—not a clone of an actor. Reasoning/thinking is
disabled for conversation, semantic end-of-turn detection is set to high
eagerness, and speech is synthesized clause-by-clause to reduce time to the
first spoken response.

## Start and select Local AI

Double-click `RUN-JARVIS-DEV.command`. If LocalAI is installed, that launcher
starts it, loads the selected model into memory before opening Jarvis, and keeps
it warm while Jarvis is running.

In Jarvis:

1. Open Settings.
2. Under **Voice Engine**, choose **Local AI**.
3. Choose the profile installed on that computer.
4. Leave **Local AI Server** as `http://127.0.0.1:8080`.
5. Add important names, artists, applications, devices, acronyms, and project
   terms under **Speech Vocabulary**.
6. Save.

If recognition is worse while wearing Bluetooth headphones, choose the
MacBook microphone under **Microphone Input**. Many headsets switch their own
microphone into a lower-bandwidth call mode; using the headphones only for
output often gives clearer transcription while still preventing speaker echo.

For mouse/keyboard control and Computer Use on macOS, open **Settings → System
→ macOS Permissions** in Jarvis and grant Accessibility, Screen Recording, and
Microphone. macOS requires you to approve these switches yourself. The
development app may appear as **Jarvis Dev** or **Electron**. If it is not in
the Accessibility list, use **Reveal App in Finder** in Jarvis and add
`node_modules/electron/dist/Electron.app` with the macOS `+` button.

The initial launcher warm-up can take a little longer after a reboot. Once it is
loaded, normal questions use the already-warm model and stream the answer as it
is generated. Local model quality will differ from hosted OpenAI models, but no
per-question AI charge is incurred.

To return to the existing paid service, choose **OpenAI** in the same Voice
Engine setting. Your OpenAI key remains stored and is not deleted.
