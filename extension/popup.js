// Renders the extension popup from stored sync stats.
(async () => {
  const s = await chrome.storage.local.get(['sent', 'lastFlush', 'lastOk']);
  const ok = s.lastOk !== false;
  document.getElementById('dot').className = 'dot' + (ok ? '' : ' off');
  document.getElementById('status').textContent = ok ? 'Active' : 'Reconnecting';
  document.getElementById('sent').textContent = String(s.sent || 0);
  document.getElementById('last').textContent = s.lastFlush
    ? new Date(s.lastFlush).toLocaleTimeString()
    : 'never';
})();
