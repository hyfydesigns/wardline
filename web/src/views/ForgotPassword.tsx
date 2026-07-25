import { useState } from 'react';
import { api } from '../lib/api';
import { Logo } from '../components/icons';

/**
 * "I forgot my password" — always shows the same confirmation message
 * regardless of whether the email has an account, so this screen can't be
 * used to discover who does.
 */
export function ForgotPassword({ onBack }: { onBack: () => void }) {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api.forgotPassword(email);
      setSent(res.message);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-screen">
      <div className="login-card">
        <div className="login-brand"><Logo /><span>Wardline</span></div>
        <h1>Reset your password</h1>
        <p className="login-sub">Enter your account email and we'll send a link to reset your password.</p>
        {error && <div className="login-error">{error}</div>}
        {sent ? (
          <div className="demo-hint">{sent}</div>
        ) : (
          <form onSubmit={submit}>
            <div className="field">
              <label htmlFor="fp-email">Email address</label>
              <input id="fp-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" autoFocus />
            </div>
            <button type="submit" className="btn btn-primary" style={{ width: '100%', marginTop: '.4rem' }} disabled={busy || !email.includes('@')}>
              {busy ? 'Sending…' : 'Send reset link'}
            </button>
          </form>
        )}
        <p className="login-foot"><a href="#" onClick={(e) => { e.preventDefault(); onBack(); }}>Back to sign in</a></p>
      </div>
    </div>
  );
}
