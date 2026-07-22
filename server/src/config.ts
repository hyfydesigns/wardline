import './env.js'; // load .env before reading any environment variable
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** The built-in development signing key. Never acceptable in production. */
export const DEV_JWT_SECRET = 'dev-only-secret-change-me';

export const config = {
  port: Number(process.env.PORT ?? 4000),
  host: process.env.HOST ?? '127.0.0.1',
  jwtSecret: process.env.JWT_SECRET ?? DEV_JWT_SECRET,
  /** SQLite file lives next to the server package. */
  dbPath: process.env.DB_PATH ?? resolve(__dirname, '..', 'wardline.db'),
  /**
   * Origins allowed to call the API from a browser. Defaults cover the Vite dev
   * server and the production dashboard; override with CORS_ORIGINS in other
   * deployments (comma-separated).
   */
  corsOrigins: (process.env.CORS_ORIGINS ?? 'http://localhost:5173,http://127.0.0.1:5173,https://wardline.app').split(','),
};
