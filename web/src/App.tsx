import { useState } from 'react';
import { AuthProvider, useAuth } from './lib/auth';
import { Login } from './views/Login';
import { Signup } from './views/Signup';
import { AcceptInvite } from './views/AcceptInvite';
import { Dashboard } from './Dashboard';

/** Read a one-off invite token from the URL (?invite=…). */
function inviteTokenFromUrl(): string | null {
  return new URLSearchParams(window.location.search).get('invite');
}

function Gate() {
  const { parent, ready, refresh } = useAuth();
  const [invite, setInvite] = useState<string | null>(inviteTokenFromUrl);
  const [mode, setMode] = useState<'login' | 'signup'>('login');

  function clearInvite() {
    // Drop the token from the address bar so a refresh doesn't re-trigger it.
    window.history.replaceState({}, '', window.location.pathname);
    setInvite(null);
  }

  if (!ready) return <div className="login-screen"><p className="loading">Loading…</p></div>;

  // An invitation link takes priority until it's used or dismissed.
  if (invite && !parent) {
    return <AcceptInvite token={invite} onDone={() => { clearInvite(); void refresh().catch(() => {}); }} />;
  }

  if (parent) return <Dashboard />;
  return mode === 'signup'
    ? <Signup onSignIn={() => setMode('login')} />
    : <Login onCreateAccount={() => setMode('signup')} />;
}

export default function App() {
  return (
    <AuthProvider>
      <Gate />
    </AuthProvider>
  );
}
