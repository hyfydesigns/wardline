import { useState } from 'react';
import { useAuth } from '../lib/auth';
import { Logo, IconLock } from '../components/icons';

const LIMITS = [
  { label: '2 hours', min: 120 },
  { label: '3 hours', min: 180 },
  { label: '4 hours', min: 240 },
  { label: '6 hours', min: 360 },
];

/** Public "Create your household" flow — creates a household, its owner, and a first child. */
export function Signup({ onSignIn }: { onSignIn: () => void }) {
  const { signup } = useAuth();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [householdName, setHouseholdName] = useState('');
  const [childName, setChildName] = useState('');
  const [childLimitMin, setChildLimitMin] = useState(240);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const ready = name.trim() && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && password.length >= 8 && childName.trim();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await signup({ name: name.trim(), email: email.trim(), password, householdName: householdName.trim() || undefined, childName: childName.trim(), childLimitMin });
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
        <h1>Create your household</h1>
        <p className="login-sub">Set up monitoring for your family. You can add more children and invite a co-parent later.</p>
        {error && <div className="login-error">{error}</div>}
        <form onSubmit={submit}>
          <div className="field">
            <label htmlFor="su-name">Your name</label>
            <input id="su-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Renee" autoFocus />
          </div>
          <div className="field">
            <label htmlFor="su-email">Email address</label>
            <input id="su-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" />
          </div>
          <div className="field">
            <label htmlFor="su-pw">Choose a password</label>
            <input id="su-pw" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" placeholder="At least 8 characters" />
          </div>
          <div className="field">
            <label htmlFor="su-hh">Household name <span style={{ color: 'var(--faint)', fontWeight: 400 }}>(optional)</span></label>
            <input id="su-hh" value={householdName} onChange={(e) => setHouseholdName(e.target.value)} placeholder={name ? `${name}’s household` : 'Our household'} />
          </div>
          <div className="field">
            <label htmlFor="su-child">First child’s name</label>
            <input id="su-child" value={childName} onChange={(e) => setChildName(e.target.value)} placeholder="e.g. Marcus" />
          </div>
          <div className="field">
            <label htmlFor="su-limit">Daily screen-time limit</label>
            <select
              id="su-limit" value={childLimitMin} onChange={(e) => setChildLimitMin(Number(e.target.value))}
              style={{ width: '100%', padding: '.62rem .75rem', border: '1px solid var(--line-strong)', borderRadius: 6, background: 'var(--surface)', color: 'var(--ink)', fontSize: '.92rem' }}
            >
              {LIMITS.map((l) => <option key={l.min} value={l.min}>{l.label}</option>)}
            </select>
          </div>
          <button type="submit" className="btn btn-primary" style={{ width: '100%', marginTop: '.4rem' }} disabled={busy || !ready}>
            {busy ? 'Creating your household…' : 'Create household'}
          </button>
        </form>
        <p className="login-foot">
          Already have an account? <a href="#" onClick={(e) => { e.preventDefault(); onSignIn(); }}>Sign in</a>
        </p>
        <div className="login-note">
          <IconLock />
          <span>You’ll be the household owner. Invite a co-parent from Settings once you’re in.</span>
        </div>
      </div>
    </div>
  );
}
