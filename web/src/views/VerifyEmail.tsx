import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { Logo } from '../components/icons';

/** Landing screen for an email-verification link (?verify=<token>). */
export function VerifyEmail({ token, onDone }: { token: string; onDone: () => void }) {
  const [status, setStatus] = useState<'checking' | 'ok' | 'error'>('checking');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.verifyEmail(token)
      .then(() => setStatus('ok'))
      .catch((e: Error) => { setError(e.message); setStatus('error'); });
  }, [token]);

  return (
    <div className="login-screen">
      <div className="login-card">
        <div className="login-brand"><Logo /><span>Wardline</span></div>
        {status === 'checking' && <p className="loading">Verifying your email…</p>}
        {status === 'ok' && (
          <>
            <h1>Email verified</h1>
            <p className="login-sub">Thanks — your email address is confirmed.</p>
          </>
        )}
        {status === 'error' && (
          <>
            <h1>That link isn't valid</h1>
            <p className="login-sub">{error}</p>
          </>
        )}
        {status !== 'checking' && (
          <button className="btn btn-primary" style={{ width: '100%' }} onClick={onDone}>Continue</button>
        )}
      </div>
    </div>
  );
}
