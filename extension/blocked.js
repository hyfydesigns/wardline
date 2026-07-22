// Populate the block page from query params (extension-page CSP forbids inline JS).
const params = new URLSearchParams(location.search);
const reason = params.get('reason');
const url = params.get('url');
if (reason) document.getElementById('reason').textContent = reason;
if (url) {
  try {
    document.getElementById('site').textContent = new URL(url).hostname;
  } catch {
    document.getElementById('site').textContent = url;
  }
}
