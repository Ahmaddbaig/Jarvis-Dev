# Jarvis Companion setup

Jarvis Companion lets the full Jarvis app see and control another Mac or Windows computer on the same private network. Deskflow is optional: Deskflow is useful for moving your own keyboard and mouse between computers, while the companion supplies screenshots and executes Jarvis actions on the remote computer.

The design works in either direction:

- Jarvis on Mac, companion on Windows.
- Jarvis on Windows, companion on Mac.
- Jarvis and a companion on two Macs or two Windows PCs.

Only run the full Jarvis app on one computer at a time. Run the small companion tray process on every other computer Jarvis should control.

## 1. Put this branch on the companion computer

The companion computer needs Git and the current Node.js LTS release. Clone this repository, or pull this branch in an existing clone:

```bash
git fetch origin
git switch desktopflows/feature-maybe
git pull
```

For this development version, the companion is launched from the repository. A standalone signed installer can be produced later; it is not required for testing.

## 2A. Start the companion on Windows

1. Double-click `RUN-JARVIS-COMPANION-WINDOWS.cmd`.
2. The first run installs dependencies and can take several minutes.
3. If Windows Firewall asks, allow Node.js/Electron on **Private networks only**. Do not enable Public networks.
4. Look for the Jarvis icon in the notification area. It may be inside the `^` hidden-icons menu.
5. Open the tray menu and choose **Copy pairing information**.

If the copied text shows more than one address, use the address for the physical Wi-Fi or Ethernet adapter shared with the Jarvis computer. VPN, Hyper-V, WSL, and virtual-machine adapters can also appear in this list.

Windows does not normally require Accessibility or Screen Recording permission. Jarvis cannot control an administrator/UAC window from a non-administrator companion; keep both at the normal user level for testing.

## 2B. Start the companion on macOS

1. Double-click `RUN-JARVIS-COMPANION.command`. If macOS blocks it, right-click it and choose **Open** once.
2. Look for the Jarvis icon in the menu bar and choose **Copy pairing information**.
3. If the macOS firewall asks, allow incoming connections for Jarvis Companion/Electron on your private network.
4. Grant **Electron** (the development companion) access in:
   - System Settings → Privacy & Security → Accessibility
   - System Settings → Privacy & Security → Screen & System Audio Recording
5. Turn Electron off and back on if it was already listed, then quit and restart the companion.

The permission belongs to the process running the companion. During development that process is named Electron, which is separate from the Electron entry used by a different copy/path. A future packaged build will appear as Jarvis Companion instead.

Keep the companion Terminal window open. Closing it stops remote control.

## 3. Pair it in Jarvis

On the computer running the full Jarvis app:

1. Open Jarvis → Settings → **Computers**.
2. Enter the `https://...:45831` address shown by the companion.
3. Enter the six-digit pairing code.
4. Carefully compare and enter the displayed TLS fingerprint.
5. Select **Pair Computer**. The computer should appear as **Ready**.

The code changes after successful pairing. Jarvis stores its controller token locally in `jarvis-companions.json`, which is excluded from Git. The fingerprint prevents another computer from impersonating the companion during pairing.

## 4. Enable the abilities and test

In Settings → Abilities, enable:

- **Companion Computers** for direct commands such as launching an app, typing, pressing keys, and clicking.
- **Computer Use** for tasks where Jarvis must inspect the remote screen and decide what to click.

Example requests:

- “List my companion computers.”
- “Open Notepad on the Windows computer.”
- “Type hello from Jarvis on Windows.”
- “Use the Windows computer to open Settings.”
- “Open Notepad on Windows and type hello from Jarvis.”
- “Use monitor 1 on the Windows computer to open Chrome.”

Monitor numbers start at `0` for the primary monitor. Ask “List my companion computers” to see the detected displays and their `jarvisScreen` numbers. Windows app launching understands friendly names including Chrome, Edge, Spotify, Discord, Notepad, Calculator, Settings, File Explorer, Command Prompt, and PowerShell. Jarvis launches the app, waits briefly, and attempts to focus its window before typing.

Direct companion commands work with the free Local AI voice option. The current visual Computer Use reasoning loop still requires an OpenAI API key; replacing that vision/reasoning model with a fast local model is a separate step.

## Safety controls

- Open the companion tray menu and choose **Emergency stop / pause control** to immediately reject control and end the active lease.
- Choose **Resume control** when ready.
- Remove a pairing from Jarvis → Settings → Computers when it is no longer needed. Jarvis attempts to revoke the remote token, but an offline or lost computer can still be forgotten locally.
- Remote Computer Use pauses before model-reported consequential actions and asks for a one-time confirmation bound to that exact task and computer.
- The companion accepts HTTPS connections on port `45831`, uses certificate pinning and bearer-token authentication, and limits each controller to a short exclusive lease.
- It has no arbitrary shell-command endpoint.

## If pairing does not work

- Confirm both computers are on the same home/private network and not isolated by a guest Wi-Fi network.
- Use one of the numerical LAN addresses printed by the companion, not `127.0.0.1` unless Jarvis and the companion run on the same computer. If several are shown, try the Wi-Fi/Ethernet address rather than a VPN or virtual adapter address.
- On Windows, confirm the firewall rule is enabled for Private networks.
- Turn off a VPN temporarily if it blocks local-network traffic.
- Confirm the companion window is still running and its tray status is not paused.
- Re-copy the current code and fingerprint from the tray; the code changes after pairing.

Deskflow is not required for these tests. If Deskflow is also running, Jarvis can still use its separate Deskflow ability to move your physical keyboard and mouse between machines.
