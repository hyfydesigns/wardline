import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, tokenStore, type Parent } from './api';

interface AuthState {
  parent: Parent | null;
  ready: boolean;
  login: (email: string, password: string, code?: string) => Promise<void>;
  signup: (input: { name: string; email: string; password: string; householdName?: string; childName: string; childLimitMin?: number }) => Promise<void>;
  logout: () => void;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [parent, setParent] = useState<Parent | null>(null);
  const [ready, setReady] = useState(false);

  // Restore a session from a stored token on load.
  useEffect(() => {
    const token = tokenStore.get();
    if (!token) { setReady(true); return; }
    api.me()
      .then((res) => setParent(res.parent))
      .catch(() => tokenStore.clear())
      .finally(() => setReady(true));
  }, []);

  async function login(email: string, password: string, code?: string) {
    const res = await api.login(email, password, code);
    tokenStore.set(res.token);
    setParent(res.parent);
  }

  async function signup(input: Parameters<AuthState['signup']>[0]) {
    const res = await api.signup(input);
    tokenStore.set(res.token);
    setParent(res.parent);
  }

  function logout() {
    tokenStore.clear();
    setParent(null);
  }

  /** Re-read the parent (e.g. after enabling/disabling 2FA). */
  async function refresh() {
    const res = await api.me();
    setParent(res.parent);
  }

  return <AuthContext.Provider value={{ parent, ready, login, signup, logout, refresh }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
