/**
 * Pluggable outbound mail. Mirrors the classifier's graceful-degradation
 * pattern: with no provider configured, "sending" logs the message instead of
 * failing — so email verification and password reset work end-to-end in dev
 * without any account, and light up for real the moment RESEND_API_KEY is set.
 *
 * Resend (https://resend.com) is used because its API is a single JSON POST —
 * no SDK, no new dependency, consistent with the rest of this codebase
 * (node:sqlite, node:crypto TOTP, node's built-in .env loader).
 */

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

export type MailerProvider = 'resend' | 'console';

export function resolveMailerProvider(): MailerProvider {
  return process.env.RESEND_API_KEY ? 'resend' : 'console';
}

// Test-only capture: when enabled, sendMail pushes here instead of logging or
// calling out over the network, so tests can assert on email content deterministically.
let testInbox: MailMessage[] | null = null;

export function _enableTestInbox(): MailMessage[] {
  testInbox = [];
  return testInbox;
}
export function _disableTestInbox(): void {
  testInbox = null;
}

/**
 * Send an email. Never throws — a failed or unconfigured send must not break
 * the request that triggered it (signup, password reset, an invite). Errors
 * are logged server-side instead.
 */
export async function sendMail(msg: MailMessage): Promise<void> {
  if (testInbox) {
    testInbox.push(msg);
    return;
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    // eslint-disable-next-line no-console
    console.log(`[mailer] RESEND_API_KEY not set — logging instead of sending.\nTo: ${msg.to}\nSubject: ${msg.subject}\n\n${msg.text}`);
    return;
  }

  const from = process.env.MAIL_FROM ?? 'Wardline <onboarding@resend.dev>';
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from, to: [msg.to], subject: msg.subject, text: msg.text }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      // eslint-disable-next-line no-console
      console.error(`[mailer] Resend API error ${res.status}: ${body}`);
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[mailer] send failed:', (err as Error).message);
  }
}
