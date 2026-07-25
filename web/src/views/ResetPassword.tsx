import { useState } from 'react';
import { api, tokenStore } from '../lib/api';
import { Logo, IconLock } from '../components/icons';

/**
 * Landing screen for a password-reset link (?reset=<token>).
 *
 * If the account has 2FA off, a successful reset signs the parent straight in
 * (mirrors AcceptInvite). If 2FA is on, the server deliberately withholds a
 * session token — resetting a password via an emailed link must not be a way
 * to skip the authenticator step — so this shows a "sign in normally" prompt.
 */
export function ResetPassword({ token, onDone }: { token: string; onDone: () => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [needsLogin, setNeedsLogin] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api.resetPassword(token, password);
      if (res.token) {
        tokenStore.set(res.token);
        onDone();
      } else {
        setNeedsLogin(true);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (needsLogin) {
    return (
      <div className="login-screen">
        <div className="login-card">
          <div className="login-brand"><Logo /><span>Wardline</span></div>
          <h1>Password updated</h1>
          <p className="login-sub">
            Your account has two-factor authentication on, so sign in with your new password and your authenticator code.
          </p>
          <button className="btn btn-primary" style={{ width: '100%' }} onClick={onDone}>Continue to sign in</button>
        </div>
      </div>
    );
  }

  return (
    <div className="login-screen">
      <div className="login-card">
        <div className="login-brand"><Logo /><span>Wardline</span></div>
        <h1>Choose a new password</h1>
        <p className="login-sub">Pick a new password for your Wardline account.</p>
        {error && <div className="login-error">{error}</div>}
        <form onSubmit={submit}>
          <div className="field">
            <label htmlFor="rp-pw">New password</label>
            <input
              id="rp-pw" type="password" value={password} autoComplete="new-password" autoFocus
              onChange={(e) => setPassword(e.target.value)} placeholder="At least 8 characters"
            />
          </div>
          <button type="submit" className="btn btn-primary" style={{ width: '100%', marginTop: '.4rem' }} disabled={busy || password.length < 8}>
            {busy ? 'Updating…' : 'Update password'}
          </button>
        </form>
        <div className="login-note">
          <IconLock />
          <span>This link works once. If it's expired, request a new one from the sign-in screen.</span>
        </div>
      </div>
    </div>
  );
}
