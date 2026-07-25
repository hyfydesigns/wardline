import { useCallback, useState } from 'react';
import { api, type Child } from './lib/api';
import { useAuth } from './lib/auth';
import { useAsync } from './lib/useAsync';
import { useLiveAlerts, type LiveAlertMessage } from './lib/live';
import { Avatar } from './components/ui';
import {
  Logo, IconOverview, IconAlert, IconReports, IconDevices, IconSchedule, IconSettings, IconBell, IconSun, IconMoon,
} from './components/icons';
import { Overview } from './views/Overview';
import { Alerts } from './views/Alerts';
import { Reports } from './views/Reports';
import { Devices } from './views/Devices';
import { Schedules } from './views/Schedules';
import { Settings } from './views/Settings';

type View = 'overview' | 'alerts' | 'reports' | 'devices' | 'schedules' | 'settings';
type Theme = 'light' | 'dark' | null;

interface Toast { id: string; label: string; childName: string; }

const NAV: { key: View; label: string; Icon: typeof IconOverview }[] = [
  { key: 'overview', label: 'Overview', Icon: IconOverview },
  { key: 'alerts', label: 'Alerts', Icon: IconAlert },
  { key: 'reports', label: 'Reports', Icon: IconReports },
  { key: 'devices', label: 'Devices', Icon: IconDevices },
  { key: 'schedules', label: 'Schedules', Icon: IconSchedule },
  { key: 'settings', label: 'Settings', Icon: IconSettings },
];

const TITLES: Record<View, string> = {
  overview: 'Overview', alerts: 'Alerts', reports: 'Reports',
  devices: 'Devices', schedules: 'Schedules', settings: 'Settings',
};

export function Dashboard() {
  const { parent, logout } = useAuth();
  const [view, setView] = useState<View>('overview');
  const [selectedChild, setSelectedChild] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [theme, setTheme] = useState<Theme>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [flashId, setFlashId] = useState<string | null>(null);

  const { data: children } = useAsync(() => api.children(), [refreshKey]);

  // Live alert stream → refresh data, flash the row, raise a toast.
  const onAlert = useCallback((alert: LiveAlertMessage['alert']) => {
    setRefreshKey((k) => k + 1);
    setFlashId(alert.id);
    const child = children?.find((c) => c.id === alert.childId);
    const toast: Toast = { id: alert.id, label: alert.label ?? 'New alert', childName: child?.name ?? 'a device' };
    setToasts((t) => [...t, toast]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== toast.id)), 6000);
  }, [children]);
  const { connected } = useLiveAlerts(onAlert);

  function applyTheme(next: Theme) {
    setTheme(next);
    const root = document.documentElement;
    if (next) root.setAttribute('data-theme', next);
    else root.removeAttribute('data-theme');
  }
  const isDark = theme === 'dark' || (theme === null && window.matchMedia?.('(prefers-color-scheme: dark)').matches);

  const totalOpen = children?.reduce((n, c) => n + c.openAlerts, 0) ?? 0;
  const onlineCount = children?.filter((c) => c.device?.online).length ?? 0;

  const subtitles: Record<View, string> = {
    overview: `${today()} · ${onlineCount} of ${children?.length ?? 0} devices online`,
    alerts: `${totalOpen} open · live stream ${connected ? 'connected' : 'reconnecting…'}`,
    reports: 'Trends across the last 7–30 days',
    devices: `${children?.length ?? 0} device${children?.length === 1 ? '' : 's'} on the family plan`,
    schedules: 'Applies to all devices unless overridden per child',
    settings: 'Filtering, alerts, and privacy controls',
  };

  const kids: Child[] = children ?? [];

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="sb-brand"><Logo /><span>Wardline</span></div>
        <div className="sb-children">
          {kids.map((c) => (
            <button key={c.id} className={`child-chip ${selectedChild === c.id ? 'active' : ''}`}
              onClick={() => setSelectedChild((cur) => (cur === c.id ? null : c.id))}>
              <Avatar name={c.name} color={c.color} />{c.name}
            </button>
          ))}
        </div>
        <nav className="sb-nav">
          {NAV.map(({ key, label, Icon }) => (
            <button key={key} className={view === key ? 'active' : ''} onClick={() => setView(key)}>
              <Icon />{label}
              {key === 'alerts' && totalOpen > 0 && <span className="nav-count">{totalOpen}</span>}
            </button>
          ))}
        </nav>
        <div className="sb-foot">
          <Avatar name={parent?.name ?? 'P'} color="neutral" />
          <div className="who"><strong>{parent?.name}</strong><span>Family plan · {kids.length} children</span></div>
          <button onClick={logout} title="Sign out">Sign out</button>
        </div>
      </aside>

      <main className="content">
        {parent && !parent.emailVerified && <VerifyBanner />}
        <div className="topbar">
          <div>
            <h1>{TITLES[view]}</h1>
            <div className="sub">{subtitles[view]}</div>
          </div>
          <div className="topbar-right">
            <button className="theme-toggle" title="Toggle theme" onClick={() => applyTheme(isDark ? 'light' : 'dark')}>
              {isDark ? <IconSun /> : <IconMoon />}
            </button>
            <div className="bell" title={`${totalOpen} open alerts`}>
              <IconBell />{totalOpen > 0 && <span className="dot" />}
            </div>
            <Avatar name={parent?.name ?? 'P'} color="neutral" />
          </div>
        </div>

        <div className="view-body">
          {view === 'overview' && <Overview children={kids} refreshKey={refreshKey} onReview={() => setView('alerts')} />}
          {view === 'alerts' && <Alerts childId={selectedChild ?? undefined} refreshKey={refreshKey} flashId={flashId} />}
          {view === 'reports' && <Reports children={kids} focusChildId={selectedChild} refreshKey={refreshKey} />}
          {view === 'devices' && <Devices children={kids} refreshKey={refreshKey} />}
          {view === 'schedules' && <Schedules refreshKey={refreshKey} />}
          {view === 'settings' && <Settings />}
        </div>
      </main>

      <div className="toast-wrap">
        {toasts.map((t) => (
          <div className="toast" key={t.id} onClick={() => { setView('alerts'); setToasts((cur) => cur.filter((x) => x.id !== t.id)); }} role="button">
            <h5>New alert · {t.childName}</h5>
            <p>{t.label} — click to review.</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function today(): string {
  return new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
}

/** Soft nudge to verify email — informational only, doesn't block anything. */
function VerifyBanner() {
  const { refresh } = useAuth();
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  async function resend() {
    setBusy(true);
    try {
      const res = await api.resendVerification();
      if (res.alreadyVerified) await refresh();
      else setSent(true);
    } catch {
      // Cooldown or a transient error — Settings has the full retry UI.
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="verify-banner">
      <p>{sent ? 'Verification email sent — check your inbox.' : 'Please verify your email — check your inbox for a confirmation link.'}</p>
      {!sent && <button className="btn btn-ghost btn-sm" disabled={busy} onClick={resend}>Resend email</button>}
    </div>
  );
}
