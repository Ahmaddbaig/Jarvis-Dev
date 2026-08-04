const STORAGE_DEFAULTS = {
  baseUrl: 'http://127.0.0.1:3100',
  token: '',
  paused: false,
  pairedAt: '',
  lastPollAt: 0,
  lastError: '',
};

let pollLoopRunning = false;
let currentPollController = null;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readState() {
  return { ...STORAGE_DEFAULTS, ...(await chrome.storage.local.get(STORAGE_DEFAULTS)) };
}

async function updateState(patch) {
  await chrome.storage.local.set(patch);
  return readState();
}

function normalizeBaseUrl(value) {
  const parsed = new URL(String(value || '').trim());
  if (parsed.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(parsed.hostname)) {
    throw new Error('Jarvis address must use http://127.0.0.1 or http://localhost.');
  }
  if (!['3000', '3100'].includes(parsed.port)) {
    throw new Error('Jarvis Chrome control supports local port 3000 or 3100.');
  }
  return `${parsed.protocol}//${parsed.host}`;
}

function originPattern(urlValue) {
  try {
    const url = new URL(urlValue);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return `${url.protocol}//${url.host}/*`;
  } catch {
    return null;
  }
}

async function hasTabAccess(tab) {
  const pattern = originPattern(tab?.url);
  if (!pattern) return false;
  return chrome.permissions.contains({ origins: [pattern] });
}

async function activeTab(tabId) {
  if (Number.isInteger(tabId)) {
    const tab = await chrome.tabs.get(tabId);
    if (!tab) throw new Error(`Chrome tab ${tabId} was not found.`);
    return tab;
  }
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab?.id) throw new Error('Chrome has no active webpage tab.');
  return tab;
}

async function requireTabAccess(tab) {
  if (!tab?.id) throw new Error('Chrome tab is unavailable.');
  if (!originPattern(tab.url || '')) {
    throw new Error('Chrome internal pages and file URLs cannot be controlled. Open an http:// or https:// page.');
  }
  if (!(await hasTabAccess(tab))) {
    const host = new URL(tab.url).host;
    throw new Error(`Site access is not approved for ${host}. Open the Jarvis extension on that tab and select Allow this site.`);
  }
}

async function waitForTabReady(tabId, timeoutMs = 15_000) {
  const current = await chrome.tabs.get(tabId);
  if (current.status === 'complete') return current;
  return new Promise((resolve) => {
    let finished = false;
    const finish = async () => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      chrome.tabs.onUpdated.removeListener(listener);
      try {
        resolve(await chrome.tabs.get(tabId));
      } catch {
        resolve(null);
      }
    };
    const listener = (updatedId, changeInfo) => {
      if (updatedId === tabId && changeInfo.status === 'complete') void finish();
    };
    const timeout = setTimeout(finish, timeoutMs);
    chrome.tabs.onUpdated.addListener(listener);
  });
}

function inspectPage(action, args) {
  const isVisible = (element) => {
    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
  };

  const compact = (value, max = 300) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);

  const selectorFor = (element) => {
    if (element.id) return `#${CSS.escape(element.id)}`;
    for (const attr of ['data-testid', 'aria-label', 'name']) {
      const value = element.getAttribute(attr);
      if (value) return `${element.tagName.toLowerCase()}[${attr}="${CSS.escape(value)}"]`;
    }
    const parts = [];
    let current = element;
    while (current && current.nodeType === Node.ELEMENT_NODE && current !== document.body && parts.length < 5) {
      let part = current.tagName.toLowerCase();
      const siblings = current.parentElement
        ? Array.from(current.parentElement.children).filter((candidate) => candidate.tagName === current.tagName)
        : [];
      if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(current) + 1})`;
      parts.unshift(part);
      current = current.parentElement;
    }
    return `body > ${parts.join(' > ')}`;
  };

  const interactiveElements = () => Array.from(document.querySelectorAll(
    'a[href], button, input:not([type="hidden"]), textarea, select, [role="button"], [role="link"], [contenteditable="true"]'
  )).filter(isVisible);

  const summarizeElement = (element, index) => {
    const input = element instanceof HTMLInputElement ? element : null;
    return {
      index,
      tag: element.tagName.toLowerCase(),
      type: input?.type || undefined,
      text: compact(element.innerText || (input?.type === 'password' ? '' : input?.value) || element.getAttribute('aria-label') || element.getAttribute('title') || element.getAttribute('placeholder')),
      ariaLabel: compact(element.getAttribute('aria-label')) || undefined,
      placeholder: compact(element.getAttribute('placeholder')) || undefined,
      selector: selectorFor(element),
    };
  };

  const locate = () => {
    if (args.selector) {
      try {
        const selected = document.querySelector(args.selector);
        if (selected && isVisible(selected)) return selected;
      } catch {
        throw new Error('The supplied CSS selector is invalid. Read the page again for current selectors.');
      }
    }
    if (args.text) {
      const wanted = compact(args.text).toLocaleLowerCase();
      const candidates = interactiveElements();
      return candidates.find((element) => compact(
        element.innerText || element.value || element.getAttribute('aria-label') || element.getAttribute('title')
      ).toLocaleLowerCase() === wanted) || candidates.find((element) => compact(
        element.innerText || element.value || element.getAttribute('aria-label') || element.getAttribute('title')
      ).toLocaleLowerCase().includes(wanted));
    }
    return null;
  };

  if (action === 'read_page') {
    const all = interactiveElements().slice(0, 120);
    return {
      title: document.title,
      url: location.href,
      text: compact(document.body?.innerText || '', 20_000),
      elements: all.map(summarizeElement),
    };
  }

  if (action === 'get_selected_text') {
    return { title: document.title, url: location.href, selectedText: compact(window.getSelection()?.toString(), 8_000) };
  }

  if (action === 'find') {
    const query = compact(args.query).toLocaleLowerCase();
    const bodyText = compact(document.body?.innerText || '', 50_000);
    const lower = bodyText.toLocaleLowerCase();
    const matches = [];
    let from = 0;
    while (matches.length < 12) {
      const index = lower.indexOf(query, from);
      if (index < 0) break;
      matches.push(bodyText.slice(Math.max(0, index - 120), Math.min(bodyText.length, index + query.length + 180)));
      from = index + query.length;
    }
    return { title: document.title, url: location.href, count: matches.length, matches };
  }

  if (action === 'scroll') {
    const amount = Number(args.amount) || Math.round(window.innerHeight * 0.8);
    if (args.direction === 'top') window.scrollTo({ top: 0, behavior: 'smooth' });
    else if (args.direction === 'bottom') window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' });
    else window.scrollBy({ top: args.direction === 'up' ? -amount : amount, behavior: 'smooth' });
    return { scrolled: args.direction, scrollY: Math.round(window.scrollY) };
  }

  if (action === 'click') {
    const target = locate();
    if (!target) throw new Error('No matching visible element was found. Read the page again and use a returned selector.');
    const description = compact(
      target.innerText || target.value || target.getAttribute('aria-label') || target.getAttribute('title') || target.getAttribute('name')
    );
    const destination = compact(
      target.getAttribute('href') || target.closest('form')?.getAttribute('action') || '',
      500
    );
    const inputType = target instanceof HTMLInputElement ? target.type : '';
    const isSubmit = (target instanceof HTMLButtonElement && target.type === 'submit') || inputType === 'submit';
    const risky = isSubmit || /\b(?:buy|checkout|purchase|place order|pay|transfer|send|delete|remove|confirm|submit|publish|post|subscribe|unsubscribe|sign|accept|book|reserve)\b/i.test(`${description} ${destination}`);
    if (risky && args.confirmed !== true) {
      return {
        confirmationRequired: true,
        confirmationMessage: `Allow Jarvis to click “${description || target.tagName.toLowerCase()}” on ${location.host}?`,
      };
    }
    target.scrollIntoView({ block: 'center', inline: 'center' });
    target.click();
    return { clicked: description || target.tagName.toLowerCase(), selector: selectorFor(target) };
  }

  if (action === 'type') {
    const target = locate();
    if (!target) throw new Error('The typing target was not found. Read the page again and use a returned selector.');
    if (target instanceof HTMLInputElement && ['password', 'file'].includes(target.type)) {
      throw new Error('Jarvis Chrome Control never types into password or file-upload fields.');
    }
    if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target.isContentEditable)) {
      throw new Error('The selected element is not editable.');
    }
    target.focus();
    if (target.isContentEditable) {
      if (args.replace !== false) target.textContent = '';
      target.textContent = `${target.textContent || ''}${args.text}`;
    } else {
      const nextValue = args.replace === false ? `${target.value}${args.text}` : String(args.text);
      const prototype = target instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
      if (setter) setter.call(target, nextValue);
      else target.value = nextValue;
    }
    target.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: String(args.text) }));
    target.dispatchEvent(new Event('change', { bubbles: true }));
    return { typed: String(args.text).length, selector: selectorFor(target) };
  }

  if (action === 'press_key') {
    const key = String(args.key);
    if (key === 'Enter' && args.confirmed !== true) {
      return {
        confirmationRequired: true,
        confirmationMessage: `Allow Jarvis to press Enter on ${location.host}? This may submit the current form.`,
      };
    }
    const target = document.activeElement || document.body;
    const options = {
      key,
      code: key.length === 1 ? `Key${key.toUpperCase()}` : key,
      bubbles: true,
      cancelable: true,
      ctrlKey: args.ctrl === true,
      altKey: args.alt === true,
      shiftKey: args.shift === true,
      metaKey: args.meta === true,
    };
    target.dispatchEvent(new KeyboardEvent('keydown', options));
    if (key === 'Enter' && args.confirmed === true && target instanceof HTMLElement) {
      const form = target.closest('form');
      if (form instanceof HTMLFormElement) form.requestSubmit();
    }
    target.dispatchEvent(new KeyboardEvent('keyup', options));
    return { pressed: key };
  }

  throw new Error(`Unsupported page action: ${action}`);
}

async function runPageAction(tab, action, args) {
  await requireTabAccess(tab);
  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: inspectPage,
    args: [action, args],
  });
  return results[0]?.result;
}

async function executeCommand(command) {
  const action = command.action;
  const args = command.args || {};

  if (action === 'status') {
    const state = await readState();
    const tabs = await chrome.tabs.query({});
    return { connected: true, paused: state.paused, extensionId: chrome.runtime.id, tabCount: tabs.length };
  }

  if (action === 'list_tabs') {
    const tabs = await chrome.tabs.query({});
    return {
      tabs: tabs.map((tab) => ({
        id: tab.id,
        title: tab.title || 'Site access not granted',
        url: tab.url || null,
        active: tab.active,
        windowId: tab.windowId,
      })),
    };
  }

  if (action === 'search') {
    const tab = await chrome.tabs.create({
      url: `https://www.google.com/search?q=${encodeURIComponent(args.query)}`,
      active: true,
    });
    if (tab.id) await waitForTabReady(tab.id);
    return { searched: args.query, tabId: tab.id, url: tab.url };
  }

  if (action === 'open_tab') {
    const tab = await chrome.tabs.create({ url: args.url, active: true });
    if (tab.id) await waitForTabReady(tab.id);
    return { opened: args.url, tabId: tab.id };
  }

  if (action === 'switch_tab') {
    const tab = await chrome.tabs.update(args.tabId, { active: true });
    if (tab?.windowId) await chrome.windows.update(tab.windowId, { focused: true });
    return { activeTabId: tab?.id, title: tab?.title, url: tab?.url };
  }

  if (action === 'close_tab') {
    if (args.confirmed !== true) {
      const tab = await chrome.tabs.get(args.tabId);
      return {
        confirmationRequired: true,
        confirmationMessage: `Allow Jarvis to close “${tab.title || `tab ${args.tabId}`}”? Unsaved page changes may be lost.`,
      };
    }
    await chrome.tabs.remove(args.tabId);
    return { closedTabId: args.tabId };
  }

  const tab = await activeTab(args.tabId);

  if (action === 'navigate') {
    const updated = await chrome.tabs.update(tab.id, { url: args.url, active: true });
    if (updated?.id) await waitForTabReady(updated.id);
    return { navigated: args.url, tabId: updated?.id };
  }
  if (action === 'back') {
    await chrome.tabs.goBack(tab.id);
    await waitForTabReady(tab.id);
    return { wentBack: true, tabId: tab.id };
  }
  if (action === 'forward') {
    await chrome.tabs.goForward(tab.id);
    await waitForTabReady(tab.id);
    return { wentForward: true, tabId: tab.id };
  }
  if (action === 'reload') {
    await chrome.tabs.reload(tab.id);
    await waitForTabReady(tab.id);
    return { reloaded: true, tabId: tab.id };
  }
  if (action === 'screenshot') {
    await requireTabAccess(tab);
    if (!tab.active) await chrome.tabs.update(tab.id, { active: true });
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'jpeg', quality: 70 });
    return { title: tab.title, url: tab.url, screenshotDataUrl: dataUrl };
  }

  return runPageAction(tab, action, args);
}

async function postResult(baseUrl, token, payload) {
  const response = await fetch(`${baseUrl}/api/chrome-control/extension`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok && response.status !== 404) {
    throw new Error(`Jarvis rejected the Chrome result with HTTP ${response.status}.`);
  }
}

async function runPollLoop() {
  if (pollLoopRunning) return;
  pollLoopRunning = true;
  try {
    while (true) {
      const state = await readState();
      if (!state.token || state.paused) return;

      try {
        currentPollController = new AbortController();
        const response = await fetch(`${state.baseUrl}/api/chrome-control/extension`, {
          headers: { Authorization: `Bearer ${state.token}` },
          cache: 'no-store',
          signal: currentPollController.signal,
        });
        currentPollController = null;
        await updateState({ lastPollAt: Date.now(), lastError: '' });
        if (response.status === 204) continue;
        if (response.status === 403) {
          await updateState({ token: '', pairedAt: '', lastError: 'Jarvis rejected this pairing. Pair again.' });
          return;
        }
        if (!response.ok) throw new Error(`Jarvis returned HTTP ${response.status}.`);

        const payload = await response.json();
        const command = payload.command;
        if (!command?.id || !command?.action) continue;

        let result;
        try {
          result = { commandId: command.id, ok: true, result: await executeCommand(command) };
        } catch (error) {
          result = { commandId: command.id, ok: false, error: error instanceof Error ? error.message : String(error) };
        }
        await postResult(state.baseUrl, state.token, result);
      } catch (error) {
        currentPollController = null;
        if (error instanceof DOMException && error.name === 'AbortError') continue;
        await updateState({ lastError: error instanceof Error ? error.message : String(error) });
        await delay(2_500);
      }
    }
  } finally {
    pollLoopRunning = false;
  }
}

async function pairWithJarvis(message) {
  const baseUrl = normalizeBaseUrl(message.baseUrl);
  const response = await fetch(`${baseUrl}/api/chrome-control/pair`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      code: String(message.code || '').trim(),
      extensionId: chrome.runtime.id,
      extensionName: 'Jarvis Chrome Control',
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.token) throw new Error(payload.error || `Pairing failed with HTTP ${response.status}.`);
  await updateState({
    baseUrl,
    token: payload.token,
    paused: false,
    pairedAt: new Date().toISOString(),
    lastError: '',
  });
  void runPollLoop();
  return readState();
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const handle = async () => {
    if (message?.type === 'pair') return { ok: true, state: await pairWithJarvis(message) };
    if (message?.type === 'get_status') return { ok: true, state: await readState(), extensionId: chrome.runtime.id };
    if (message?.type === 'set_paused') {
      const state = await updateState({ paused: message.paused === true });
      if (state.paused) currentPollController?.abort();
      if (!state.paused) void runPollLoop();
      return { ok: true, state };
    }
    if (message?.type === 'forget_pairing') {
      const state = await updateState({ token: '', pairedAt: '', lastPollAt: 0, lastError: '' });
      currentPollController?.abort();
      return { ok: true, state };
    }
    throw new Error('Unknown extension message.');
  };
  handle().then(sendResponse).catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
  return true;
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create('jarvis-poll', { periodInMinutes: 0.5 });
  void runPollLoop();
});
chrome.runtime.onStartup.addListener(() => void runPollLoop());
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'jarvis-poll') void runPollLoop();
});

void runPollLoop();
