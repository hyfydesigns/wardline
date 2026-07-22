import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

/**
 * Load a .env file into process.env before any config is read. Uses Node's
 * built-in loader (no dependency). Looks in the repo root first, then the
 * server package dir. Real shell environment variables still win — this only
 * fills in ones that aren't already set.
 *
 * Import this module for its side effect *before* anything that reads env.
 */
const here = dirname(fileURLToPath(import.meta.url)); // server/src
const candidates = [
  resolve(here, '..', '..', '.env'), // repo root  (WinGuard/.env)
  resolve(here, '..', '.env'), // server/.env
];

// Snapshot the real environment so file values can't clobber shell-set ones.
const originalEnv = new Map(Object.entries(process.env));

for (const path of candidates) {
  try {
    process.loadEnvFile(path);
  } catch {
    // File absent or unreadable — that's fine, .env is optional.
  }
}

// Restore any keys that were already set in the real environment.
for (const [key, value] of originalEnv) {
  process.env[key] = value;
}
