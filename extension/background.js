// Wardline background service worker (MV3).
//
// Receives events from content scripts, batches them, and POSTs to the ingest
// endpoint. By default that endpoint is the local Windows-agent bridge, so the
// agent can apply its on-device pre-filter before anything leaves the machine;
// it can also point straight at the cloud API. Config comes from managed
// policy (set by the installer) with local fallbacks for development.
//
// IMPORTANT (MV3): the queue lives in chrome.storage.session, NOT a module
// variable. A service worker is torn down after ~30s idle, which would drop an
// in-memory queue before it flushes. Session storage survives worker restarts
// (and clears when the browser closes), so no capture is lost.

// Pure enforcement decision logic (sets globalThis.WardlineEnforce).
importScripts('enforcement.js');

const DEFAULTS = {
  ApiUrl: 'http://127.0.0.1:4000',
  DeviceToken: 'wl-dev-marcus-pc',
};

const FLUSH_ALARM = 'wardline-flush';
const QUEUE_KEY = 'queue';
const POLICY_KEY = 'policy';
const FLUSH_DEBOUNCE_MS = 1500;

async function getConfig() {
  // Managed policy wins; fall back to local storage, then dev defaults.
  const managed = await chrome.storage.managed.get(['ApiUrl', 'DeviceToken']).catch(() => ({}));
  const local = await chrome.storage.local.get(['ApiUrl', 'DeviceToken']).catch(() => ({}));
  return {
    ApiUrl: managed.ApiUrl || local.ApiUrl || DEFAULTS.ApiUrl,
    DeviceToken: managed.DeviceToken || local.DeviceToken || DEFAULTS.DeviceToken,
  };
}

async function enqueue(event) {
  const { [QUEUE_KEY]: q = [] } = await chrome.storage.session.get(QUEUE_KEY);
  q.push({ eventId: crypto.randomUUID(), occurredAt: new Date().toISOString(), ...event });
  await chrome.storage.session.set({ [QUEUE_KEY]: q });
}

let flushTimer = null;
function scheduleFlush() {
  if (flushTimer) return;
  // A short debounce keeps latency low and, because setTimeout keeps the worker
  // alive until it fires, guarantees the flush runs without depending on the
  // (coarser) alarm backstop.
  flushTimer = setTimeout(() => { flushTimer = null; flush(); }, FLUSH_DEBOUNCE_MS);
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === 'wardline:event' && msg.event) {
    enqueue(msg.event).then(scheduleFlush);
  }
});

async function flush() {
  const { [QUEUE_KEY]: batch = [] } = await chrome.storage.session.get(QUEUE_KEY);
  if (batch.length === 0) return;
  await chrome.storage.session.set({ [QUEUE_KEY]: [] });

  const { ApiUrl, DeviceToken } = await getConfig();
  const requeue = async () => {
    const { [QUEUE_KEY]: cur = [] } = await chrome.storage.session.get(QUEUE_KEY);
    await chrome.storage.session.set({ [QUEUE_KEY]: batch.concat(cur) });
  };

  try {
    const res = await fetch(`${ApiUrl}/api/ingest`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${DeviceToken}` },
      body: JSON.stringify({ events: batch }),
    });
    if (!res.ok) {
      await requeue();
      await chrome.storage.local.set({ lastOk: false, lastError: `HTTP ${res.status}` });
      return;
    }
    const stats = await chrome.storage.local.get('sent');
    await chrome.storage.local.set({
      sent: (stats.sent || 0) + batch.length,
      lastFlush: new Date().toISOString(),
      lastOk: true,
    });
  } catch (e) {
    // Offline: put the batch back so nothing is lost. The agent/dashboard show
    // honest "last seen" rather than implying live coverage.
    await requeue();
    await chrome.storage.local.set({ lastOk: false, lastError: String(e) });
  }
}

// ---- Enforcement downlink -------------------------------------------------

/** Pull the household's effective policy from the server into session storage. */
async function refreshPolicy() {
  const { ApiUrl, DeviceToken } = await getConfig();
  try {
    const res = await fetch(`${ApiUrl}/api/policy`, {
      headers: { authorization: `Bearer ${DeviceToken}` },
    });
    if (res.ok) {
      await chrome.storage.session.set({ [POLICY_KEY]: await res.json() });
    }
  } catch {
    // Offline: keep the last policy so enforcement continues from cache.
  }
}

async function getPolicy() {
  const { [POLICY_KEY]: policy } = await chrome.storage.session.get(POLICY_KEY);
  return policy || null;
}

// Enforce on every top-frame navigation: block, or rewrite a search to SafeSearch.
chrome.webNavigation.onBeforeNavigate.addListener(async (details) => {
  if (details.frameId !== 0) return; // top frame only
  if (!/^https?:/i.test(details.url)) return;
  const policy = await getPolicy();
  if (!policy) return;

  const verdict = globalThis.WardlineEnforce.evaluate(policy, details.url);
  if (verdict.block) {
    const blockedPage =
      chrome.runtime.getURL('blocked.html') +
      `?reason=${encodeURIComponent(verdict.reason || 'Blocked')}&url=${encodeURIComponent(details.url)}`;
    chrome.tabs.update(details.tabId, { url: blockedPage }).catch(() => {});
    enqueue({ source: 'extension', kind: 'blocked', url: details.url });
    scheduleFlush();
    return;
  }

  const safeUrl = globalThis.WardlineEnforce.enforceSafeSearch(policy, details.url);
  if (safeUrl && safeUrl !== details.url) {
    chrome.tabs.update(details.tabId, { url: safeUrl }).catch(() => {});
  }
});

// Backstop: a periodic alarm drains anything left queued and refreshes policy.
chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(FLUSH_ALARM, { periodInMinutes: 0.25 });
  refreshPolicy();
});
chrome.runtime.onStartup.addListener(() => {
  refreshPolicy();
  flush();
});
chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === FLUSH_ALARM) {
    flush();
    refreshPolicy();
  }
});
