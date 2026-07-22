import { useState } from 'react';
import { useAuth } from '../lib/auth';
import { Logo, IconLock } from '../components/icons';

export function Login() {
  const { login } = useAuth();
  const [email, setEmail] = useState('renee@family.wardline.app');
  const [password, setPassword] = useState('wardline-demo');
  const [code, setCode] = useState('');
  const [needsCode, setNeedsCode] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email, password, needsCode ? code : undefined);
    } catch (err) {
      // The server tells us when a second factor is needed; only then do we ask.
      if ((err as { mfaRequired?: boolean }).mfaRequired) {
        setNeedsCode(true);
        setError(code ? (err as Error).message : 'Enter the code from your authenticator app.');
      } else {
        setError((err as Error).message);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-screen">
      <div className="login-card">
        <div className="login-brand"><Logo /><span>Wardline</span></div>
        <h1>Welcome back</h1>
        <p className="login-sub">Sign in to see how things are going.</p>
        {error && <div className="login-error">{error}</div>}
        <form onSubmit={submit}>
          <div className="field">
            <label htmlFor="email">Email address</label>
            <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" />
          </div>
          <div className="field">
            <label htmlFor="pw">Password</label>
            <input id="pw" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
          </div>
          {needsCode && (
            <div className="field">
              <label htmlFor="mfa">Authentication code</label>
              <input
                id="mfa" className="mono" maxLength={6} inputMode="numeric" autoFocus
                placeholder="000000" value={code} onChange={(e) => setCode(e.target.value)}
              />
            </div>
          )}
          <button type="submit" className="btn btn-primary" style={{ width: '100%', marginTop: '.4rem' }} disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
        <p className="login-foot"><a href="#" onClick={(e) => e.preventDefault()}>Forgot password?</a></p>
        <div className="login-note">
          <IconLock />
          <span>Supports authenticator-app two-factor sign-in. Your child's activity data stays encrypted end to end.</span>
        </div>
        <div className="demo-hint">Demo login is pre-filled — just press <strong>Sign in</strong>. Turn on 2FA in Settings.</div>
      </div>
    </div>
  );
}
