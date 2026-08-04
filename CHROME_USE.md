# Jarvis Chrome Control

Jarvis Chrome Control lets the full Jarvis application search the web and work
inside the user's existing Google Chrome profile. It can use websites where the
user is already signed in, but only after the user pairs the local extension and
approves each website.

Chrome and the full Jarvis app must currently run on the same computer. This
extension does not require macOS Accessibility permission and does not control
other desktop applications. Chrome control is available only in the Electron
desktop window; LAN browser clients cannot issue Chrome commands.

## What Jarvis can do

- Search Google in a new tab
- Open, close, select, reload, and navigate tabs
- Read the visible text on an approved page
- List visible links, buttons, and form controls with stable selectors
- Find text within a page
- Read selected text
- Click links and buttons
- Type into ordinary text fields and text areas
- Press a limited set of keyboard keys
- Scroll the page
- Capture the visible part of an approved tab for a vision-capable model

It can search public websites and work in signed-in sites such as Gmail or an
internal web application after that site's permission is approved. It cannot
bypass a login, paywall, CAPTCHA, website authorization, or Chrome security
boundary.

## 1. Start this Jarvis branch

```bash
git fetch origin
git switch chrome-use/feature
git pull
./RUN-JARVIS-DEV.command
```

The development launcher serves Jarvis on `http://127.0.0.1:3100`. A packaged
Jarvis application uses port `3000`. Packaged builds copy the extension outside
the application archive, and Settings displays that real unpacked directory.

## 2. Load the local Chrome extension

1. In Jarvis, open **Settings → System → Chrome Control Extension**.
2. Copy the extension folder path shown there.
3. Open `chrome://extensions` in Google Chrome.
4. Turn on **Developer mode**.
5. Select **Load unpacked**.
6. Choose this repository's `chrome-extension` folder.
7. Pin **Jarvis Chrome Control** to the Chrome toolbar if desired.

The extension uses Manifest V3 and contains no remotely hosted code. Chrome
grants it permanent network access only to Jarvis on localhost. Access to normal
websites is declared as optional and is requested one site at a time.

## 3. Pair Chrome with Jarvis

1. In Jarvis's Chrome Control settings card, select **Generate pairing code**.
2. Open the JARVIS extension from the Chrome toolbar.
3. Select **Development — port 3100** when using `RUN-JARVIS-DEV.command`.
4. Enter the six-digit code and select **Pair Extension**.
5. Return to Jarvis and select **Refresh status**. It should report
   **Connected**.

The code expires after ten minutes and permits no more than eight incorrect
attempts. Successful pairing creates a random token. Chrome stores the token in
extension-local storage; Jarvis stores only its SHA-256 hash in
`jarvis-chrome-control.json`, which is excluded from Git.

## 4. Approve websites

Jarvis receives no blanket access to browsing data.

1. Open the website Jarvis should use.
2. Open the JARVIS extension while that tab is active.
3. Select **Allow This Site** when Chrome displays its permission prompt.
4. Repeat for each website Jarvis should use.

Use **Remove Site Access** to revoke a site's permission. Use **Pause** to stop
the extension from accepting commands without deleting its pairing.

Chrome internal pages such as `chrome://settings`, extension pages, file URLs,
and browser password screens are never controllable.

## 5. Enable the Jarvis ability

Open **Jarvis → Settings → Abilities**, enable **Chrome Use**, and save the
configuration. Reconnect Jarvis if the active voice session was already open so
the new tool is added to that session.

The ability works with OpenAI voice and Local AI. A larger local profile is
more reliable for long multi-step browser workflows, while the M2 2B profile is
best used for short direct instructions.

## 6. Test in small steps

Try these commands in order:

1. “Jarvis, check the Chrome extension status.”
2. “List my Chrome tabs.”
3. “Search Chrome for the latest NVIDIA driver for an RTX 3060 Ti.”
4. Approve `google.com` from the extension popup.
5. “Read the current Chrome page and summarize the results.”
6. Open another approved site and say, “Find the words account settings on this
   page.”
7. “Click account settings in Chrome.”
8. “Type hello from Jarvis into the search field, but do not submit it.”

After a search, navigation, or scroll, Jarvis reads the page again before
choosing an element. Page selectors can change when a website rerenders.

## Confirmation and safety behavior

The extension offers a fixed action list; Jarvis cannot send arbitrary
JavaScript or shell commands through it.

Jarvis displays a confirmation before:

- Clicking elements that appear to buy, send, submit, delete, publish, transfer,
  subscribe, accept, book, or confirm something
- Pressing Enter, because it may submit a form
- Closing a tab, because unsaved work could be lost

The extension refuses to type into password and file-upload fields. Enter
passwords, one-time codes, payment information, and file selections yourself.
Page summaries omit all form-control values, including ordinary text, telephone,
and number inputs. Keyboard commands perform only the documented explicit page
effect; browser and operating-system shortcuts are not emulated.

Webpage text is treated as untrusted content. A page may contain prompt
injection telling Jarvis to reveal secrets or perform an unrelated action.
Jarvis is explicitly instructed to ignore those requests and remain bound to
the user's original task, but the user should still review consequential
confirmations.

## Stop or revoke Chrome control

- Select **Pause** in the extension to stop polling immediately.
- Select **Remove Site Access** to revoke the active website.
- Select **Revoke** in **Jarvis → Settings → System** to invalidate the paired
  token.
- Select **Forget Local Pairing** in the extension to remove its local copy.
- Remove the extension from `chrome://extensions` to uninstall it.

Revoking in Jarvis is the authoritative step because it invalidates the token
even if a copied extension storage profile still exists.

## Troubleshooting

### Jarvis says the extension is offline

- Keep Chrome running.
- Open the extension popup once to wake its Manifest V3 service worker.
- Confirm the popup uses port `3100` for development or `3000` for a packaged
  application.
- Generate a new pairing code and pair again if Jarvis rejected the old token.

### Jarvis says site access is not approved

Open the target tab, open the extension, and select **Allow This Site**. Chrome
requires optional host permission to be requested from a user gesture, so
Jarvis cannot approve a website for itself.

### A click or field selector stopped working

Ask Jarvis to read the page again. Modern sites frequently replace their DOM
elements after navigation, search, or scrolling.

### Search works but Jarvis cannot read the results

Searching can open Google without page access. Reading or clicking Google
requires separately approving `google.com` in the extension popup.

### The extension changed after a Git pull

Open `chrome://extensions` and select the reload icon on the Jarvis extension.
Then reopen its popup.

## Design references

- [Chrome optional permissions](https://developer.chrome.com/docs/extensions/reference/api/permissions)
- [Chrome scripting API](https://developer.chrome.com/docs/extensions/reference/api/scripting)
- [Chrome tabs API](https://developer.chrome.com/docs/extensions/reference/api/tabs)
- [Manifest V3 overview](https://developer.chrome.com/docs/extensions/develop/migrate/what-is-mv3)
