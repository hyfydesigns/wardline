/**
 * Where the API lives.
 *
 * - Local dev: leave VITE_API_URL unset. Requests stay same-origin ("/api…")
 *   and Vite's dev-server proxy forwards them to the backend on :4000.
 * - Production: set VITE_API_URL to the deployed API origin
 *   (e.g. https://api.wardline.app) at build time. The dashboard is served from
 *   a different origin (wardline.app), so calls must be absolute.
 */
export const API_BASE = (import.meta.env.VITE_API_URL ?? '').replace(/\/+$/, '');

/** Build a full URL for an API path, honouring API_BASE. */
export function apiUrl(path: string): string {
  return API_BASE ? API_BASE + path : path;
}

/** Build a WebSocket URL for a path, on the API origin when configured. */
export function wsUrl(path: string): string {
  const host = API_BASE ? new URL(API_BASE) : window.location;
  const proto = host.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${host.host}${path}`;
}
