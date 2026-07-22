import { useEffect, useState } from 'react';
import { api, type Settings as SettingsT, type HouseholdInfo } from '../lib/api';
import { Switch, Segmented } from '../components/ui';
import { useAuth } from '../lib/auth';

export function Settings() {
  const [s, setS] = useState<SettingsT | null>(null);
  const [saved, setSaved] = useState(false);
  const [newSite, setNewSite] = useState('');

  useEffect(() => { api.getSettings().then(setS); }, []);

  function normalizeHost(input: string): string | null {
    const host = input.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '');
    return /^[a-z0-9.-]+\.[a-z]{2,}$/.test(host) ? host : null;
  }

  async function patch(next: Partial<SettingsT>) {
    if (!s) return;
    const merged = { ...s, ...next };
    setS(merged);
    const result = await api.saveSettings(next);
    setS(result);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }

  if (!s) return <p className="loading">Loading settings…</p>;

  return (
    <div className="stack">
      <div className="card card-pad">
        <span className="section-title">Content filtering {saved && <span className="saved-hint">✓ saved</span>}</span>
        <Row title="Adult content" desc="Blocks explicit and adult sites across every monitored browser. Always on.">
          <Switch checked={s.filters.adult} disabled />
        </Row>
        <Row title="Gambling" desc="Blocks gambling and prize-wheel style sites.">
          <Switch checked={s.filters.gambling} onChange={(v) => patch({ filters: { ...s.filters, gambling: v } })} />
        </Row>
        <Row title="Social media" desc="Allowed, subject to the household schedule.">
          <Switch checked={s.filters.social} onChange={(v) => patch({ filters: { ...s.filters, social: v } })} />
        </Row>
        <Row title="Enforce SafeSearch" desc="Locks SafeSearch on for Google, Bing, and YouTube; auto-restores if a child disables it.">
          <Switch checked={s.safeSearch} onChange={(v) => patch({ safeSearch: v })} />
        </Row>
        <Row title="Custom blocked sites" desc="Always blocked, regardless of category.">
          <span />
        </Row>
        <div className="taglist" style={{ marginTop: '-.4rem' }}>
          {s.customBlocked.map((site) => (
            <span className="tag-item" key={site}>{site}
              <button title="Remove" onClick={() => patch({ customBlocked: s.customBlocked.filter((x) => x !== site) })}>×</button>
            </span>
          ))}
        </div>
        <form
          style={{ display: 'flex', gap: '.5rem', marginTop: '.7rem' }}
          onSubmit={(e) => {
            e.preventDefault();
            const host = normalizeHost(newSite);
            if (host && !s.customBlocked.includes(host)) {
              patch({ customBlocked: [...s.customBlocked, host] });
              setNewSite('');
            }
          }}
        >
          <input
            aria-label="Add a site to block"
            placeholder="e.g. omegle.com"
            value={newSite}
            onChange={(e) => setNewSite(e.target.value)}
            style={{ flex: 1, maxWidth: '16rem', padding: '.4rem .6rem', border: '1px solid var(--line-strong)', borderRadius: 6, background: 'var(--surface)', color: 'var(--ink)', fontFamily: 'var(--font-mono)', fontSize: '.82rem' }}
          />
          <button type="submit" className="btn btn-ghost btn-sm" disabled={!normalizeHost(newSite)}>Block site</button>
        </form>
      </div>

      <div className="card card-pad">
        <span className="section-title">Alerts {saved && <span className="saved-hint">✓ saved</span>}</span>
        <Row title="Detection sensitivity" desc="Balanced is recommended — fewer false positives than Strict, without missing high-risk content.">
          <Segmented
            value={s.alerts.sensitivity}
            options={[{ value: 'cautious', label: 'Cautious' }, { value: 'balanced', label: 'Balanced' }, { value: 'strict', label: 'Strict' }]}
            onChange={(v) => patch({ alerts: { ...s.alerts, sensitivity: v } })}
          />
        </Row>
        <Row title="Email notifications" desc="renee@family.wardline.app">
          <Switch checked={s.alerts.email} onChange={(v) => patch({ alerts: { ...s.alerts, email: v } })} />
        </Row>
        <Row title="Push notifications" desc="Sent to any browser where the dashboard is open.">
          <Switch checked={s.alerts.push} onChange={(v) => patch({ alerts: { ...s.alerts, push: v } })} />
        </Row>
      </div>

      <HouseholdSection />

      <TwoFactorSection />

      <div className="card card-pad">
        <span className="section-title">Screenshots {saved && <span className="saved-hint">✓ saved</span>}</span>
        <Row title="Capture on flagged events" desc="Off by default. When on, a screenshot is taken only at the moment a critical alert fires — never continuously.">
          <Switch checked={s.screenshots.enabled} onChange={(v) => patch({ screenshots: { ...s.screenshots, enabled: v } })} />
        </Row>
        <Row title="Retention" desc="Screenshots are deleted automatically after this period.">
          <Segmented
            value={String(s.screenshots.retentionDays)}
            options={[{ value: '7', label: '7 days' }, { value: '30', label: '30 days' }, { value: '90', label: '90 days' }]}
            onChange={(v) => patch({ screenshots: { ...s.screenshots, retentionDays: Number(v) } })}
          />
        </Row>
      </div>
    </div>
  );
}

/** Co-parents: who's in the household, and inviting/removing them. */
function HouseholdSection() {
  const [info, setInfo] = useState<HouseholdInfo | null>(null);
  const [email, setEmail] = useState('');
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () => api.household().then(setInfo).catch((e: Error) => setError(e.message));
  useEffect(() => { void load(); }, []);

  async function act(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try { await fn(); await load(); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setCopied(false);
    try {
      const res = await api.inviteCoParent(email);
      setInviteLink(`${window.location.origin}${res.invitePath}`);
      setEmail('');
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!info) return <div className="card card-pad"><span className="section-title">Household</span><p className="loading">Loading…</p></div>;

  const isOwner = info.yourRole === 'owner';

  return (
    <div className="card card-pad">
      <span className="section-title">Household</span>
      <p style={{ color: 'var(--muted)', fontSize: '.85rem', marginBottom: '1rem' }}>
        Everyone here sees the same children, alerts, and settings. {isOwner ? 'As the owner you can add or remove parents.' : 'Only the household owner can remove parents.'}
      </p>

      {error && <div className="login-error" style={{ marginBottom: '.8rem' }}>{error}</div>}

      {info.members.map((m) => (
        <div className="setting-row" key={m.id}>
          <div className="setting-text">
            <h4>
              {m.name}{m.isYou && <span style={{ color: 'var(--muted)', fontWeight: 400 }}> — you</span>}
              <span className={`pill ${m.role === 'owner' ? 'pill-good' : 'pill-neutral'}`} style={{ marginLeft: '.5rem' }}>{m.role}</span>
            </h4>
            <p>{m.email}{m.mfaEnabled ? ' · 2FA on' : ''}</p>
          </div>
          {isOwner && !m.isYou && m.role !== 'owner' && (
            <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => act(() => api.removeMember(m.id))}>Remove</button>
          )}
        </div>
      ))}

      {info.invitations.length > 0 && (
        <>
          <h4 style={{ fontSize: '.82rem', marginTop: '1rem', color: 'var(--muted)' }}>Pending invitations</h4>
          {info.invitations.map((i) => (
            <div className="setting-row" key={i.id}>
              <div className="setting-text">
                <h4 style={{ fontWeight: 500 }}>{i.email}</h4>
                <p>Expires {new Date(i.expiresAt).toLocaleDateString()}</p>
              </div>
              <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => act(() => api.revokeInvite(i.id))}>Revoke</button>
            </div>
          ))}
        </>
      )}

      <form onSubmit={invite} style={{ display: 'flex', gap: '.5rem', marginTop: '1rem' }}>
        <input
          type="email" placeholder="co-parent@example.com" value={email} onChange={(e) => setEmail(e.target.value)}
          aria-label="Invite a co-parent by email"
          style={{ flex: 1, maxWidth: '18rem', padding: '.4rem .6rem', border: '1px solid var(--line-strong)', borderRadius: 6, background: 'var(--surface)', color: 'var(--ink)', fontSize: '.85rem' }}
        />
        <button type="submit" className="btn btn-primary btn-sm" disabled={busy || !email.includes('@')}>Send invite</button>
      </form>

      {inviteLink && (
        <div style={{ marginTop: '.8rem', padding: '.7rem .8rem', background: 'var(--surface-sunken)', borderRadius: 6 }}>
          <p style={{ fontSize: '.8rem', color: 'var(--muted)', marginBottom: '.4rem' }}>
            Share this link with them — it works once and expires in 7 days.
          </p>
          <div style={{ display: 'flex', gap: '.5rem', alignItems: 'center' }}>
            <code style={{ flex: 1, fontSize: '.75rem', wordBreak: 'break-all' }}>{inviteLink}</code>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => { void navigator.clipboard?.writeText(inviteLink); setCopied(true); }}
            >
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Authenticator-app two-factor enrolment and removal. */
function TwoFactorSection() {
  const { parent, refresh } = useAuth();
  const enabled = !!parent?.mfaEnabled;
  const [setup, setSetup] = useState<{ secret: string; otpauthUri: string } | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /** Begin enrolment: mint a secret to show, without changing account state. */
  async function beginSetup() {
    setBusy(true);
    setError(null);
    try {
      setSetup(await api.twoFactorSetup());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  /** Commit a change (enable/disable), then re-read the parent. */
  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await refresh();
      setSetup(null);
      setCode('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card card-pad">
      <span className="section-title">Two-factor authentication</span>
      <div className="setting-row">
        <div className="setting-text">
          <h4>Authenticator app</h4>
          <p>
            {enabled
              ? 'On. Signing in requires a code from your authenticator app.'
              : 'Off. Add a second step at sign-in using any authenticator app (1Password, Google Authenticator, Authy).'}
          </p>
        </div>
        {!enabled && !setup && (
          <button className="btn btn-primary btn-sm" disabled={busy} onClick={beginSetup}>Set up</button>
        )}
      </div>

      {error && <div className="login-error" style={{ marginTop: '.6rem' }}>{error}</div>}

      {setup && (
        <div style={{ marginTop: '.5rem' }}>
          <p style={{ fontSize: '.85rem', color: 'var(--muted)', marginBottom: '.6rem' }}>
            Add this key to your authenticator app, then enter the 6-digit code it shows to confirm.
          </p>
          <div className="tag-item" style={{ display: 'inline-flex', marginBottom: '.7rem', userSelect: 'all' }}>{setup.secret}</div>
          <form
            style={{ display: 'flex', gap: '.5rem' }}
            onSubmit={(e) => { e.preventDefault(); run(() => api.twoFactorEnable(code)); }}
          >
            <input
              className="mono" placeholder="000000" maxLength={6} inputMode="numeric" value={code}
              onChange={(e) => setCode(e.target.value)}
              style={{ width: '7rem', padding: '.4rem .6rem', border: '1px solid var(--line-strong)', borderRadius: 6, background: 'var(--surface)', color: 'var(--ink)', textAlign: 'center', letterSpacing: '.2em', fontFamily: 'var(--font-mono)' }}
            />
            <button type="submit" className="btn btn-primary btn-sm" disabled={busy || code.length !== 6}>Turn on</button>
            <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => { setSetup(null); setError(null); }}>Cancel</button>
          </form>
        </div>
      )}

      {enabled && (
        <form
          style={{ display: 'flex', gap: '.5rem', marginTop: '.3rem' }}
          onSubmit={(e) => { e.preventDefault(); run(() => api.twoFactorDisable(code)); }}
        >
          <input
            className="mono" placeholder="000000" maxLength={6} inputMode="numeric" value={code}
            onChange={(e) => setCode(e.target.value)}
            style={{ width: '7rem', padding: '.4rem .6rem', border: '1px solid var(--line-strong)', borderRadius: 6, background: 'var(--surface)', color: 'var(--ink)', textAlign: 'center', letterSpacing: '.2em', fontFamily: 'var(--font-mono)' }}
          />
          <button type="submit" className="btn btn-ghost btn-sm" disabled={busy || code.length !== 6}>Turn off</button>
        </form>
      )}
    </div>
  );
}

function Row({ title, desc, children }: { title: string; desc: string; children: React.ReactNode }) {
  return (
    <div className="setting-row">
      <div className="setting-text"><h4>{title}</h4><p>{desc}</p></div>
      {children}
    </div>
  );
}
