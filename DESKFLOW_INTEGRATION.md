# Jarvis + Deskflow

Jarvis can use an existing Deskflow installation to move the shared keyboard and mouse between the Mac server and one connected computer. This integration does not copy or bundle Deskflow source code.

## What works now

- Detects Deskflow on macOS, Windows, and Linux.
- Reads the existing Deskflow server topology and computer names.
- Reports whether Deskflow is running in server mode and whether its peer is connected.
- Lets Jarvis switch to `Mac`, `Windows`, or an exact Deskflow screen name.
- Refuses ambiguous layouts instead of moving the pointer to an unsafe edge.
- Accepts switching requests only from the loopback-hosted Jarvis desktop UI. The LAN HTTPS proxy blocks this endpoint, so phones and other computers cannot seize input routing.

On this Mac, Deskflow 1.26.0 is the server and the Windows computer is directly below it. Jarvis therefore switches to Windows through the bottom edge and returns to the Mac through the top edge. Repeating the same target is safe because that edge has no outgoing link on the target computer.

Enable **Deskflow Control** under **Settings → Abilities** on the Mac running Jarvis. It is intentionally off by default because it moves system input. Example requests:

- “Jarvis, which Deskflow computers are connected?”
- “Jarvis, switch control to Windows.”
- “Jarvis, bring control back to the Mac.”

To use a nonstandard configuration path, start Jarvis with `JARVIS_DESKFLOW_CONFIG` set to the full `deskflow-server.conf` path.

## Screen-aware remote control

Deskflow transports keyboard, mouse, and clipboard events. It does not stream the remote display back to Jarvis. The existing `computer_use` agent takes screenshots only on the computer where Jarvis is running. After switching to Windows, it would still see the Mac screen and would operate the Windows computer blindly.

Voice-driven switching is safe to use on its own. For screen-aware work, run the separate Jarvis Companion on the remote computer and follow [COMPANION_SETUP.md](COMPANION_SETUP.md).

## Jarvis Companion

The implemented companion remains separate from Deskflow and provides the missing capabilities:

1. Capture the Windows desktop locally.
2. Execute mouse and keyboard actions locally.
3. Return screenshots and action results to the Mac Jarvis instance.
4. Pair over TLS using a short-lived code and a manually verified certificate fingerprint.
5. Authenticate each request, enforce short exclusive control leases, and validate inputs.
6. Show a tray status with a local emergency stop/pause control.

Deskflow can continue handling the human keyboard/mouse transition while the companion handles machine perception and controlled automation. This avoids injecting commands into Deskflow's encrypted wire protocol and keeps Jarvis-specific code outside Deskflow's GPL-2.0-only codebase.

## Deskflow upstream improvement

Deskflow already implements `switchToScreen(...)` internally, but version 1.26.0 exposes only `stop` through its local core IPC command handler. A useful upstream contribution would add authenticated local IPC commands for:

- querying the active screen;
- listing connected screens; and
- switching to an exact connected screen.

That contribution should live in a Deskflow fork or upstream pull request under Deskflow's GPL-2.0-only license. Jarvis should consume the released IPC interface as a separate program instead of copying Deskflow code into this repository.
