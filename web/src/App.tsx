import { useState } from 'react';
import { AuthProvider, useAuth } from './lib/auth';
import { Login } from './views/Login';
import { Signup } from './views/Signup';
import { ForgotPassword } from './views/ForgotPassword';
import { ResetPassword } from './views/ResetPassword';
import { VerifyEmail } from './views/VerifyEmail';
import { AcceptInvite } from './views/AcceptInvite';
import { Dashboard } from './Dashboard';

/** Read a one-off token from the URL (?invite=…, ?reset=…, ?verify=…). */
function tokenFromUrl(param: string): string | null {
  return new URLSearchParams(window.location.search).get(param);
}

function Gate() {
  const { parent, ready, refresh } = useAuth();
  const [invite, setInvite] = useState<string | null>(() => tokenFromUrl('invite'));
  const [resetToken, setResetToken] = useState<string | null>(() => tokenFromUrl('reset'));
  const [verifyToken, setVerifyToken] = useState<string | null>(() => tokenFromUrl('verify'));
  const [mode, setMode] = useState<'login' | 'signup' | 'forgot'>('login');

  // Drop the token from the address bar so a refresh doesn't re-trigger it.
  function clearInvite() { window.history.replaceState({}, '', window.location.pathname); setInvite(null); }
  function clearReset() { window.history.replaceState({}, '', window.location.pathname); setResetToken(null); }
  function clearVerify() { window.history.replaceState({}, '', window.location.pathname); setVerifyToken(null); }

  if (!ready) return <div className="login-screen"><p className="loading">Loading…</p></div>;

  // Link-driven screens take priority until they're used or dismissed.
  if (invite && !parent) {
    return <AcceptInvite token={invite} onDone={() => { clearInvite(); void refresh().catch(() => {}); }} />;
  }
  if (resetToken) {
    return <ResetPassword token={resetToken} onDone={() => { clearReset(); void refresh().catch(() => {}); }} />;
  }
  if (verifyToken) {
    return <VerifyEmail token={verifyToken} onDone={() => { clearVerify(); void refresh().catch(() => {}); }} />;
  }

  if (parent) return <Dashboard />;
  if (mode === 'signup') return <Signup onSignIn={() => setMode('login')} />;
  if (mode === 'forgot') return <ForgotPassword onBack={() => setMode('login')} />;
  return <Login onCreateAccount={() => setMode('signup')} onForgotPassword={() => setMode('forgot')} />;
}

export default function App() {
  return (
    <AuthProvider>
      <Gate />
    </AuthProvider>
  );
}
