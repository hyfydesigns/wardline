import { useEffect, useState } from 'react';
import { api, tokenStore, type InvitePreview } from '../lib/api';
import { Logo, IconLock } from '../components/icons';

/**
 * Landing screen for an invited co-parent (reached via ?invite=<token>).
 * Creates their account inside the existing household and signs them in.
 */
export function AcceptInvite({ token, onDone }: { token: string; onDone: () => void }) {
  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.invitePreview(token).then(setPreview).catch((e: Error) => setLoadError(e.message));
  }, [token]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api.acceptInvite(token, name, password);
      tokenStore.set(res.token);
      onDone();
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

        {loadError && (
          <>
            <h1>Invitation not available</h1>
            <p className="login-sub">{loadError}</p>
            <button className="btn btn-ghost" style={{ width: '100%' }} onClick={onDone}>Go to sign in</button>
          </>
        )}

        {!loadError && !preview && <p className="loading">Checking your invitation…</p>}

        {preview && !preview.usable && (
          <>
            <h1>This invitation has expired</h1>
            <p className="login-sub">Ask {preview.invitedByName} to send you a new one.</p>
            <button className="btn btn-ghost" style={{ width: '100%' }} onClick={onDone}>Go to sign in</button>
          </>
        )}

        {preview && preview.usable && (
          <>
            <h1>Join {preview.householdName}</h1>
            <p className="login-sub">
              {preview.invitedByName} invited you to help look after the children in this household. Create your
              password to get started.
            </p>
            {error && <div className="login-error">{error}</div>}
            <form onSubmit={submit}>
              <div className="field">
                <label htmlFor="inv-email">Email address</label>
                <input id="inv-email" value={preview.email} disabled />
              </div>
              <div className="field">
                <label htmlFor="inv-name">Your name</label>
                <input id="inv-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Sam" autoFocus />
              </div>
              <div className="field">
                <label htmlFor="inv-pw">Choose a password</label>
                <input
                  id="inv-pw" type="password" value={password} autoComplete="new-password"
                  onChange={(e) => setPassword(e.target.value)} placeholder="At least 8 characters"
                />
              </div>
              <button
                type="submit" className="btn btn-primary" style={{ width: '100%', marginTop: '.4rem' }}
                disabled={busy || !name.trim() || password.length < 8}
              >
                {busy ? 'Creating your account…' : 'Join household'}
              </button>
            </form>
            <div className="login-note">
              <IconLock />
              <span>You'll see the same alerts and settings as the parent who invited you.</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
