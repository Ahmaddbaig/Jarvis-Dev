const STORAGE_DEFAULTS = {
  baseUrl: 'http://127.0.0.1:3100',
  token: '',
  paused: false,
  pairedAt: '',
  lastPollAt: 0,
  lastError: '',
  approvedOrigins: [],
};

const PENDING_RESULT_KEY = 'pendingChromeResult';
const CLICK_APPROVALS_KEY = 'pendingClickApprovals';
const CLICK_APPROVAL_TTL_MS = 60_000;

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

async function readPendingResult() {
  const stored = await chrome.storage.session.get(PENDING_RESULT_KEY);
  return stored[PENDING_RESULT_KEY] || null;
}

async function storePendingResult(result) {
  await chrome.storage.session.set({ [PENDING_RESULT_KEY]: result });
}

async function clearPendingResult() {
  await chrome.storage.session.remove(PENDING_RESULT_KEY);
}

async function createClickApproval(tabId, fingerprint) {
  const now = Date.now();
  const stored = await chrome.storage.session.get(CLICK_APPROVALS_KEY);
  const existing = stored[CLICK_APPROVALS_KEY];
  const approvals = existing && typeof existing === 'object' ? existing : {};
  for (const [id, approval] of Object.entries(approvals)) {
    if (!approval || Number(approval.expiresAt) <= now) delete approvals[id];
  }
  const confirmationId = crypto.randomUUID();
  approvals[confirmationId] = { tabId, fingerprint, expiresAt: now + CLICK_APPROVAL_TTL_MS };
  const newest = Object.fromEntries(Object.entries(approvals).slice(-20));
  await chrome.storage.session.set({ [CLICK_APPROVALS_KEY]: newest });
  return confirmationId;
}

async function consumeClickApproval(confirmationId, tabId) {
  if (typeof confirmationId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(confirmationId)) {
    throw new Error('The click confirmation is missing or invalid. Read the page and confirm the action again.');
  }
  const stored = await chrome.storage.session.get(CLICK_APPROVALS_KEY);
  const existing = stored[CLICK_APPROVALS_KEY];
  const approvals = existing && typeof existing === 'object' ? existing : {};
  const approval = approvals[confirmationId];
  delete approvals[confirmationId];
  await chrome.storage.session.set({ [CLICK_APPROVALS_KEY]: approvals });
  if (!approval || Number(approval.expiresAt) <= Date.now() || approval.tabId !== tabId || typeof approval.fingerprint !== 'string') {
    throw new Error('The click confirmation expired or belongs to a different tab. Read the page and confirm the action again.');
  }
  return approval.fingerprint;
}

async function clearTransientCommandState() {
  await chrome.storage.session.remove([PENDING_RESULT_KEY, CLICK_APPROVALS_KEY]);
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
  const state = await readState();
  if (!Array.isArray(state.approvedOrigins) || !state.approvedOrigins.includes(pattern)) return false;
  const granted = await chrome.permissions.contains({ origins: [pattern] });
  if (!granted) {
    await updateState({ approvedOrigins: state.approvedOrigins.filter((origin) => origin !== pattern) });
  }
  return granted;
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

  const isNearViewport = (element) => {
    const rect = element.getBoundingClientRect();
    return rect.bottom >= -window.innerHeight * 0.25 && rect.top <= window.innerHeight * 1.25;
  };

  const uniqueMatch = (selector, element) => {
    try {
      const matches = document.querySelectorAll(selector);
      return matches.length === 1 && matches[0] === element;
    } catch {
      return false;
    }
  };

  const attributeSelector = (element) => {
    if (element.id) {
      const candidate = `#${CSS.escape(element.id)}`;
      if (uniqueMatch(candidate, element)) return candidate;
    }
    for (const attr of ['data-testid', 'aria-label', 'name']) {
      const value = element.getAttribute(attr);
      if (!value) continue;
      const candidate = `${element.tagName.toLowerCase()}[${attr}="${CSS.escape(value)}"]`;
      if (uniqueMatch(candidate, element)) return candidate;
    }
    return null;
  };

  const positionalPart = (element) => {
    let part = element.tagName.toLowerCase();
    const siblings = element.parentElement
      ? Array.from(element.parentElement.children).filter((candidate) => candidate.tagName === element.tagName)
      : [];
    if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(element) + 1})`;
    return part;
  };

  const selectorFor = (element) => {
    const direct = attributeSelector(element);
    if (direct) return direct;

    const parts = [positionalPart(element)];
    let current = element;
    while (current.parentElement && current.parentElement !== document.body) {
      current = current.parentElement;
      const anchor = attributeSelector(current);
      if (anchor) {
        const candidate = `${anchor} > ${parts.join(' > ')}`;
        if (uniqueMatch(candidate, element)) return candidate;
      }
      parts.unshift(positionalPart(current));
    }
    const candidate = `body > ${parts.join(' > ')}`;
    if (uniqueMatch(candidate, element)) return candidate;
    throw new Error('Jarvis could not create a unique selector for this element. Use visible text or inspect the page again.');
  };

  const interactiveElements = () => Array.from(document.querySelectorAll(
    'a[href], button, input:not([type="hidden"]), textarea, select, [role="button"], [role="link"], [contenteditable="true"]'
  )).filter(isVisible);

  const labelFor = (element) => {
    const labels = 'labels' in element && element.labels
      ? Array.from(element.labels).map((label) => label.innerText).join(' ')
      : '';
    const ordinaryText = element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement || element.isContentEditable
      ? ''
      : element.innerText;
    return compact(
      ordinaryText || labels || element.getAttribute('aria-label') || element.getAttribute('title') || element.getAttribute('placeholder') || element.getAttribute('name')
    );
  };

  const isSensitiveField = (element) => {
    if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element.isContentEditable)) return false;
    if (element instanceof HTMLInputElement && ['password', 'file'].includes(element.type)) return true;
    const autocompleteTokens = String(element.getAttribute('autocomplete') || '')
      .toLocaleLowerCase()
      .split(/\s+/)
      .filter(Boolean);
    if (autocompleteTokens.some((token) =>
      ['current-password', 'new-password', 'one-time-code', 'webauthn'].includes(token) ||
      token.startsWith('cc-') ||
      token.startsWith('transaction-')
    )) return true;
    const labels = 'labels' in element && element.labels
      ? Array.from(element.labels).map((label) => label.innerText).join(' ')
      : '';
    const metadata = [
      element.id,
      element.getAttribute('name'),
      element.getAttribute('aria-label'),
      element.getAttribute('placeholder'),
      labels,
    ].filter(Boolean).join(' ');
    return /\b(?:password|passcode|otp|one[ -]?time|verification code|security code|cvv|cvc|card number|credit card|debit card|api[ _-]?key|access token|secret|routing number|account number|ssn|social security)\b/i.test(metadata);
  };

  const viewportText = () => {
    if (!document.body) return '';
    const pieces = [];
    let length = 0;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode() && length < 24_000) {
      const node = walker.currentNode;
      const parent = node.parentElement;
      const text = compact(node.textContent, 2_000);
      if (!parent || !text || ['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE'].includes(parent.tagName)) continue;
      if (parent.closest('input, textarea, select, [contenteditable="true"]')) continue;
      const style = window.getComputedStyle(parent);
      if (style.visibility === 'hidden' || style.display === 'none') continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      const intersects = Array.from(range.getClientRects()).some(
        (rect) => rect.bottom >= -window.innerHeight * 0.25 && rect.top <= window.innerHeight * 1.25 && rect.width > 0 && rect.height > 0
      );
      if (!intersects) continue;
      pieces.push(text);
      length += text.length + 1;
    }
    return compact(pieces.join(' '), 20_000);
  };

  const summarizeElement = (element, index) => {
    const input = element instanceof HTMLInputElement ? element : null;
    return {
      index,
      tag: element.tagName.toLowerCase(),
      type: input?.type || undefined,
      text: labelFor(element),
      ariaLabel: compact(element.getAttribute('aria-label')) || undefined,
      placeholder: compact(element.getAttribute('placeholder')) || undefined,
      sensitive: isSensitiveField(element) || undefined,
      selector: selectorFor(element),
    };
  };

  const locate = () => {
    if (args.selector) {
      try {
        const matches = document.querySelectorAll(args.selector);
        if (matches.length > 1) {
          throw new Error('The supplied selector matches more than one element. Read the page again for a unique selector.');
        }
        const selected = matches[0];
        if (selected && isVisible(selected)) return selected;
      } catch {
        throw new Error('The supplied CSS selector is invalid or ambiguous. Read the page again for current selectors.');
      }
    }
    if (args.text) {
      const wanted = compact(args.text).toLocaleLowerCase();
      const candidates = interactiveElements();
      const exact = candidates.filter((element) => labelFor(element).toLocaleLowerCase() === wanted);
      if (exact.length === 1) return exact[0];
      if (exact.length > 1) throw new Error('More than one visible control has that text. Read the page and use its unique selector.');
      const partial = candidates.filter((element) => labelFor(element).toLocaleLowerCase().includes(wanted));
      if (partial.length === 1) return partial[0];
      if (partial.length > 1) throw new Error('More than one visible control partially matches that text. Read the page and use its unique selector.');
    }
    return null;
  };

  if (action === 'read_page') {
    const all = interactiveElements().filter(isNearViewport).slice(0, 120);
    const pageHeight = Math.max(document.body?.scrollHeight || 0, document.documentElement.scrollHeight);
    return {
      title: document.title,
      url: location.href,
      text: viewportText(),
      viewport: {
        scrollY: Math.round(window.scrollY),
        height: window.innerHeight,
        pageHeight,
        atTop: window.scrollY <= 1,
        atBottom: window.scrollY + window.innerHeight >= pageHeight - 2,
      },
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
    if (args.direction === 'top') window.scrollTo({ top: 0, behavior: 'auto' });
    else if (args.direction === 'bottom') window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'auto' });
    else window.scrollBy({ top: args.direction === 'up' ? -amount : amount, behavior: 'auto' });
    return { scrolled: args.direction, scrollY: Math.round(window.scrollY) };
  }

  if (action === 'click') {
    const target = locate();
    if (!target) throw new Error('No matching visible element was found. Read the page again and use a returned selector.');
    const description = labelFor(target);
    const destination = compact(
      target.getAttribute('href') || target.closest('form')?.getAttribute('action') || '',
      500
    );
    const inputType = target instanceof HTMLInputElement ? target.type : '';
    const isSubmit = (target instanceof HTMLButtonElement && target.type === 'submit') || ['submit', 'image'].includes(inputType);
    const risky = isSubmit || /\b(?:buy|checkout|purchase|place order|pay|transfer|send|delete|remove|confirm|submit|publish|post|subscribe|unsubscribe|sign|accept|book|reserve)\b/i.test(`${description} ${destination}`);
    const confirmationFingerprint = JSON.stringify({
      description,
      destination,
      tag: target.tagName.toLowerCase(),
      inputType,
      url: location.href,
      selector: selectorFor(target),
    });
    if (args.confirmed === true && args.confirmationFingerprint !== confirmationFingerprint) {
      throw new Error('The page changed after confirmation. Jarvis did not click anything; read the page and confirm the current target again.');
    }
    if (risky && args.confirmed !== true) {
      return {
        confirmationRequired: true,
        confirmationMessage: `Allow Jarvis to click “${description || target.tagName.toLowerCase()}” on ${location.host}?`,
        confirmationFingerprint,
      };
    }
    target.scrollIntoView({ block: 'center', inline: 'center' });
    target.click();
    return { clicked: description || target.tagName.toLowerCase(), selector: selectorFor(target) };
  }

  if (action === 'type') {
    const target = locate();
    if (!target) throw new Error('The typing target was not found. Read the page again and use a returned selector.');
    if (isSensitiveField(target)) {
      throw new Error('Jarvis Chrome Control never types into password, one-time-code, payment, secret, or file-upload fields.');
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
    if (args.ctrl === true || args.alt === true || args.meta === true || (args.shift === true && key !== 'Tab')) {
      throw new Error('Jarvis does not emulate browser or operating-system keyboard shortcuts. Use a page control instead.');
    }
    if (key === 'Enter' && args.confirmed !== true) {
      return {
        confirmationRequired: true,
        confirmationMessage: `Allow Jarvis to press Enter on ${location.host}? This may submit the current form.`,
      };
    }
    const target = document.activeElement instanceof HTMLElement ? document.activeElement : document.body;

    if (key === 'Tab') {
      const focusable = interactiveElements().filter((element) => !element.hasAttribute('disabled') && element.tabIndex >= 0);
      if (!focusable.length) throw new Error('This page has no visible focusable controls.');
      const currentIndex = focusable.indexOf(target);
      const offset = args.shift === true ? -1 : 1;
      const nextIndex = currentIndex < 0
        ? (offset > 0 ? 0 : focusable.length - 1)
        : (currentIndex + offset + focusable.length) % focusable.length;
      const next = focusable[nextIndex];
      next.focus();
      return { pressed: key, effect: 'focus moved', selector: selectorFor(next), target: labelFor(next) };
    }

    if (key === 'Escape') {
      if (target === document.body) throw new Error('Escape has no supported effect because no page control is focused.');
      target.blur();
      return { pressed: key, effect: 'focused control blurred' };
    }

    if (isSensitiveField(target)) {
      throw new Error('Jarvis does not send key actions to sensitive fields.');
    }

    if (key === 'Enter') {
      if (target instanceof HTMLTextAreaElement) {
        const start = target.selectionStart ?? target.value.length;
        const end = target.selectionEnd ?? start;
        target.setRangeText('\n', start, end, 'end');
        target.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertLineBreak', data: null }));
        return { pressed: key, effect: 'line break inserted' };
      }
      const form = target.closest('form');
      if (form instanceof HTMLFormElement) {
        form.requestSubmit();
        return { pressed: key, effect: 'form submitted' };
      }
      if (target.matches('button, a[href], input[type="button"], input[type="submit"], input[type="image"]')) {
        target.click();
        return { pressed: key, effect: 'focused control activated' };
      }
      throw new Error('Enter has no supported effect on the focused element.');
    }

    if (target instanceof HTMLSelectElement && ['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(key)) {
      const previous = target.selectedIndex;
      if (key === 'ArrowUp') target.selectedIndex = Math.max(0, previous - 1);
      if (key === 'ArrowDown') target.selectedIndex = Math.min(target.options.length - 1, previous + 1);
      if (key === 'Home') target.selectedIndex = 0;
      if (key === 'End') target.selectedIndex = Math.max(0, target.options.length - 1);
      target.dispatchEvent(new Event('input', { bubbles: true }));
      target.dispatchEvent(new Event('change', { bubbles: true }));
      return { pressed: key, effect: 'selection changed', selectedIndex: target.selectedIndex };
    }

    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
      const start = target.selectionStart;
      const end = target.selectionEnd;
      if (start === null || end === null) throw new Error(`The focused field does not support ${key}.`);
      if (key === 'ArrowLeft' || key === 'ArrowRight' || key === 'Home' || key === 'End') {
        let position = start;
        if (key === 'ArrowLeft') position = Math.max(0, start - 1);
        if (key === 'ArrowRight') position = Math.min(target.value.length, end + 1);
        if (key === 'Home') position = 0;
        if (key === 'End') position = target.value.length;
        target.setSelectionRange(position, position);
        return { pressed: key, effect: 'caret moved', position };
      }
      if (key === 'Backspace' || key === 'Delete') {
        let deleteStart = start;
        let deleteEnd = end;
        if (start === end && key === 'Backspace') deleteStart = Math.max(0, start - 1);
        if (start === end && key === 'Delete') deleteEnd = Math.min(target.value.length, end + 1);
        target.setRangeText('', deleteStart, deleteEnd, 'end');
        target.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: key === 'Backspace' ? 'deleteContentBackward' : 'deleteContentForward', data: null }));
        return { pressed: key, effect: 'text deleted' };
      }
    }

    if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'].includes(key)) {
      if (key === 'Home') window.scrollTo({ top: 0, behavior: 'auto' });
      else if (key === 'End') window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'auto' });
      else {
        const direction = key === 'ArrowUp' || key === 'PageUp' ? -1 : 1;
        const amount = key.startsWith('Page') ? window.innerHeight * 0.8 : 80;
        window.scrollBy({ top: direction * amount, behavior: 'auto' });
      }
      return { pressed: key, effect: 'page scrolled', scrollY: Math.round(window.scrollY) };
    }

    throw new Error(`${key} has no supported effect on the focused element.`);
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
      tabs: await Promise.all(tabs.map(async (tab) => {
        const approved = await hasTabAccess(tab);
        return {
          id: tab.id,
          title: approved ? (tab.title || 'Untitled page') : 'Site access not granted',
          url: approved ? (tab.url || null) : null,
          active: tab.active,
          windowId: tab.windowId,
          approved,
        };
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
    const approved = await hasTabAccess(tab);
    return {
      activeTabId: tab?.id,
      title: approved ? tab?.title : 'Site access not granted',
      url: approved ? tab?.url : null,
      approved,
    };
  }

  if (action === 'close_tab') {
    if (args.confirmed !== true) {
      const tab = await chrome.tabs.get(args.tabId);
      const approved = await hasTabAccess(tab);
      return {
        confirmationRequired: true,
        confirmationMessage: `Allow Jarvis to close “${approved && tab.title ? tab.title : `tab ${args.tabId}`}”? Unsaved page changes may be lost.`,
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
    const [previouslyActive] = await chrome.tabs.query({ active: true, windowId: tab.windowId });
    const changedActiveTab = previouslyActive?.id !== tab.id;
    try {
      if (changedActiveTab) await chrome.tabs.update(tab.id, { active: true });
      const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'jpeg', quality: 70 });
      return { title: tab.title, url: tab.url, screenshotDataUrl: dataUrl };
    } finally {
      if (changedActiveTab && previouslyActive?.id) {
        try {
          await chrome.tabs.update(previouslyActive.id, { active: true });
        } catch {
          // The previous tab may have closed while the screenshot was captured.
        }
      }
    }
  }

  let pageArgs = args;
  if (action === 'click' && args.confirmed === true) {
    const confirmationFingerprint = await consumeClickApproval(args.confirmationId, tab.id);
    pageArgs = { ...args, confirmationFingerprint };
  }
  const pageResult = await runPageAction(tab, action, pageArgs);
  if (
    action === 'click' &&
    pageResult?.confirmationRequired === true &&
    typeof pageResult.confirmationFingerprint === 'string'
  ) {
    const confirmationId = await createClickApproval(tab.id, pageResult.confirmationFingerprint);
    const { confirmationFingerprint: _privateFingerprint, ...safeResult } = pageResult;
    void _privateFingerprint;
    return { ...safeResult, confirmationId };
  }
  return pageResult;
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
  if (response.status === 403) {
    const error = new Error('Jarvis rejected this Chrome pairing. Pair again.');
    error.authenticationFailed = true;
    throw error;
  }
  // A 404 means the command expired or Jarvis no longer recognizes it. Accepted
  // command IDs remain idempotently acknowledged for five minutes.
  if (response.status === 404) return;
  if (!response.ok) throw new Error(`Jarvis rejected the Chrome result with HTTP ${response.status}.`);
  const acknowledgement = await response.json();
  if (acknowledgement.accepted !== true) throw new Error('Jarvis did not acknowledge the Chrome result.');
}

async function runPollLoop() {
  if (pollLoopRunning) return;
  pollLoopRunning = true;
  try {
    while (true) {
      const state = await readState();
      if (!state.token || state.paused) return;

      try {
        const pendingResult = await readPendingResult();
        if (pendingResult) {
          try {
            await postResult(state.baseUrl, state.token, pendingResult);
            await clearPendingResult();
            await updateState({ lastError: '' });
          } catch (error) {
            if (error?.authenticationFailed === true) {
              await clearTransientCommandState();
              await updateState({ token: '', pairedAt: '', lastError: error.message });
              return;
            }
            await updateState({ lastError: `Retrying Chrome result delivery: ${error instanceof Error ? error.message : String(error)}` });
            await delay(2_500);
          }
          continue;
        }

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
        await storePendingResult(result);
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
  await clearTransientCommandState();
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
    if (message?.type === 'record_site_permission') {
      const pattern = originPattern(String(message.pattern || '').replace(/\*$/, ''));
      if (!pattern || pattern !== message.pattern) throw new Error('Invalid site permission pattern.');
      const state = await readState();
      const approvedOrigins = new Set(Array.isArray(state.approvedOrigins) ? state.approvedOrigins : []);
      if (message.granted === true) approvedOrigins.add(pattern);
      else approvedOrigins.delete(pattern);
      return { ok: true, state: await updateState({ approvedOrigins: Array.from(approvedOrigins).sort() }) };
    }
    if (message?.type === 'set_paused') {
      const state = await updateState({ paused: message.paused === true });
      if (state.paused) currentPollController?.abort();
      if (!state.paused) void runPollLoop();
      return { ok: true, state };
    }
    if (message?.type === 'forget_pairing') {
      await clearTransientCommandState();
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
chrome.permissions.onRemoved.addListener((permissions) => {
  if (!permissions.origins?.length) return;
  void readState().then((state) => updateState({
    approvedOrigins: (Array.isArray(state.approvedOrigins) ? state.approvedOrigins : [])
      .filter((origin) => !permissions.origins.includes(origin)),
  }));
});

void runPollLoop();
