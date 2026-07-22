// Wardline content script.
//
// Runs in the page and extracts a *minimal* signal: the URL, a short reduced
// text window, and any search query. It deliberately does NOT stream full page
// content — data minimisation starts here, on-device. Per-site adapters (for
// chat apps etc.) would extend `extractText` in a full build.

(() => {
  'use strict';

  const MAX_TEXT = 280; // hard cap on the text window we ever emit

  function reduce(text) {
    return text.replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT);
  }

  function searchQuery() {
    try {
      const u = new URL(location.href);
      if (/(^|\.)(google|bing|duckduckgo|yahoo)\./i.test(u.host)) {
        return u.searchParams.get('q') || u.searchParams.get('p') || '';
      }
    } catch { /* ignore */ }
    return '';
  }

  function extractText() {
    // Prefer the main heading + first chunk of visible body text.
    const parts = [document.title];
    const main = document.querySelector('main, article, [role="main"]') || document.body;
    if (main) parts.push(main.innerText || '');
    return reduce(parts.join('. '));
  }

  function capture() {
    const q = searchQuery();
    const event = q
      ? { source: browserName(), kind: 'search', url: location.href, text: q }
      : { source: browserName(), kind: 'page', url: location.href, text: extractText() };
    chrome.runtime.sendMessage({ type: 'wardline:event', event }).catch(() => {});
  }

  function browserName() {
    const ua = navigator.userAgent;
    if (/Edg\//.test(ua)) return 'edge';
    if (/OPR\//.test(ua)) return 'opera';
    if (/Firefox\//.test(ua)) return 'firefox';
    if (/Brave/.test(ua)) return 'brave';
    return 'chrome';
  }

  // Capture once the page settles, and again on SPA navigations.
  let last = '';
  const maybeCapture = () => {
    if (location.href === last) return;
    last = location.href;
    capture();
  };
  window.addEventListener('load', maybeCapture);
  setInterval(maybeCapture, 3000);
})();
