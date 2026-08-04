const elements = {
  badge: document.getElementById('connectionBadge'),
  pairSection: document.getElementById('pairSection'),
  controlSection: document.getElementById('controlSection'),
  baseUrl: document.getElementById('baseUrl'),
  pairCode: document.getElementById('pairCode'),
  pairButton: document.getElementById('pairButton'),
  endpointText: document.getElementById('endpointText'),
  pauseButton: document.getElementById('pauseButton'),
  siteText: document.getElementById('siteText'),
  permissionText: document.getElementById('permissionText'),
  allowSiteButton: document.getElementById('allowSiteButton'),
  removeSiteButton: document.getElementById('removeSiteButton'),
  forgetButton: document.getElementById('forgetButton'),
  message: document.getElementById('message'),
};

let extensionState = null;
let currentPattern = null;

function setMessage(message, type = '') {
  elements.message.textContent = message || '';
  elements.message.className = type;
}

function sendMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
      if (!response?.ok) return reject(new Error(response?.error || 'The extension service worker did not respond.'));
      resolve(response);
    });
  });
}

function patternFor(urlValue) {
  try {
    const url = new URL(urlValue);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    return `${url.protocol}//${url.host}/*`;
  } catch {
    return null;
  }
}

async function currentSite() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  currentPattern = patternFor(tab?.url || '');
  if (!currentPattern) {
    elements.siteText.textContent = 'Open a normal HTTP or HTTPS website.';
    elements.permissionText.textContent = 'Chrome internal pages cannot be controlled.';
    elements.allowSiteButton.disabled = true;
    elements.removeSiteButton.hidden = true;
    return;
  }
  const url = new URL(tab.url);
  const granted = await chrome.permissions.contains({ origins: [currentPattern] });
  elements.siteText.textContent = url.host;
  elements.permissionText.textContent = granted
    ? 'Jarvis may read and control this site.'
    : 'Jarvis has no access to this site.';
  elements.allowSiteButton.hidden = granted;
  elements.allowSiteButton.disabled = false;
  elements.removeSiteButton.hidden = !granted;
}

function renderState(state) {
  extensionState = state;
  const paired = Boolean(state?.token);
  const recentlyPolled = Date.now() - Number(state?.lastPollAt || 0) < 40_000;
  elements.pairSection.hidden = paired;
  elements.controlSection.hidden = !paired;
  elements.baseUrl.value = state?.baseUrl || 'http://127.0.0.1:3100';
  elements.endpointText.textContent = state?.baseUrl || '';
  elements.pauseButton.textContent = state?.paused ? 'RESUME' : 'PAUSE';

  elements.badge.className = `badge ${state?.paused ? 'paused' : recentlyPolled ? 'online' : 'offline'}`;
  elements.badge.textContent = state?.paused ? 'PAUSED' : recentlyPolled ? 'CONNECTED' : paired ? 'WAITING' : 'OFFLINE';
  if (state?.lastError) setMessage(state.lastError, 'error');
}

async function refresh() {
  try {
    const response = await sendMessage({ type: 'get_status' });
    renderState(response.state);
    if (response.state?.token) await currentSite();
  } catch (error) {
    setMessage(error.message, 'error');
  }
}

elements.pairButton.addEventListener('click', async () => {
  const code = elements.pairCode.value.trim();
  if (!/^\d{6}$/.test(code)) return setMessage('Enter the six-digit code shown in Jarvis Settings.', 'error');
  elements.pairButton.disabled = true;
  setMessage('Pairing…');
  try {
    const response = await sendMessage({ type: 'pair', code, baseUrl: elements.baseUrl.value });
    renderState(response.state);
    await currentSite();
    setMessage('Chrome is paired with local Jarvis.', 'success');
  } catch (error) {
    setMessage(error.message, 'error');
  } finally {
    elements.pairButton.disabled = false;
  }
});

elements.pauseButton.addEventListener('click', async () => {
  try {
    const response = await sendMessage({ type: 'set_paused', paused: !extensionState?.paused });
    renderState(response.state);
    setMessage(response.state.paused ? 'Chrome control is paused.' : 'Chrome control resumed.', 'success');
  } catch (error) {
    setMessage(error.message, 'error');
  }
});

elements.allowSiteButton.addEventListener('click', async () => {
  if (!currentPattern) return;
  try {
    const granted = await chrome.permissions.request({ origins: [currentPattern] });
    if (!granted) return setMessage('Chrome did not grant access to this site.', 'error');
    await currentSite();
    setMessage('Site access granted.', 'success');
  } catch (error) {
    setMessage(error.message, 'error');
  }
});

elements.removeSiteButton.addEventListener('click', async () => {
  if (!currentPattern) return;
  try {
    await chrome.permissions.remove({ origins: [currentPattern] });
    await currentSite();
    setMessage('Site access removed.', 'success');
  } catch (error) {
    setMessage(error.message, 'error');
  }
});

elements.forgetButton.addEventListener('click', async () => {
  try {
    const response = await sendMessage({ type: 'forget_pairing' });
    renderState(response.state);
    setMessage('Local token removed. Revoke the pairing in Jarvis Settings too.', 'success');
  } catch (error) {
    setMessage(error.message, 'error');
  }
});

void refresh();
