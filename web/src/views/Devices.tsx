import { useState } from 'react';
import { api, type Child } from '../lib/api';
import { useAsync } from '../lib/useAsync';
import { Avatar } from '../components/ui';
import { relativeTime } from '../lib/format';

export function Devices({ children, refreshKey }: { children: Child[]; refreshKey: number }) {
  const [nonce, setNonce] = useState(0);
  const { data, loading } = useAsync(() => api.devices(), [refreshKey, nonce]);

  if (loading) return <p className="loading">Loading devices…</p>;
  return (
    <>
      <div className="tbl-wrap">
        <table>
          <thead>
            <tr><th>Device</th><th>Assigned to</th><th>Status</th><th>Agent</th><th>Browser coverage</th><th>Last check-in</th></tr>
          </thead>
          <tbody>
            {data?.map((d) => (
              <tr key={d.id}>
                <td><span className="device-name"><Avatar name={d.childName} color={d.childColor} />{d.name}</span></td>
                <td>{d.childName}</td>
                <td><span className={`status-live ${d.online ? '' : 'off'}`}><span className="dot" />{d.online ? 'Online' : 'Offline'}</span></td>
                <td><span className="mono">{d.agentVersion}</span></td>
                <td>{d.browserCoverage}</td>
                <td>{relativeTime(d.lastSeen)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <AddDevice childrenList={children} onAdded={() => setNonce((n) => n + 1)} />
    </>
  );
}

/** Enrol a new PC: mints a device token and shows how to install the agent. */
function AddDevice({ childrenList, onAdded }: { childrenList: Child[]; onAdded: () => void }) {
  const [open, setOpen] = useState(false);
  const [childId, setChildId] = useState(childrenList[0]?.id ?? '');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issued, setIssued] = useState<{ name: string; deviceToken: string } | null>(null);
  const [copied, setCopied] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api.addDevice(childId || childrenList[0]?.id, name);
      setIssued({ name: res.name, deviceToken: res.deviceToken });
      setName('');
      onAdded();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const installCmd = issued ? `WardlineSetup.exe /DeviceToken=${issued.deviceToken}` : '';

  if (!open) {
    return (
      <p style={{ marginTop: '1rem', fontSize: '.85rem' }}>
        <button className="btn btn-ghost btn-sm" onClick={() => setOpen(true)}>+ Add a device</button>
        <span style={{ color: 'var(--muted)', marginLeft: '.6rem' }}>Enrol another Windows PC.</span>
      </p>
    );
  }

  return (
    <div className="card card-pad" style={{ marginTop: '1rem' }}>
      <span className="section-title">Add a device</span>
      {error && <div className="login-error" style={{ marginBottom: '.7rem' }}>{error}</div>}

      {!issued && (
        <form onSubmit={submit} style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <select
            aria-label="Child" value={childId} onChange={(e) => setChildId(e.target.value)}
            style={{ padding: '.4rem .6rem', border: '1px solid var(--line-strong)', borderRadius: 6, background: 'var(--surface)', color: 'var(--ink)', fontSize: '.85rem' }}
          >
            {childrenList.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <input
            aria-label="Device name" placeholder="e.g. Marcus-Laptop" value={name} onChange={(e) => setName(e.target.value)}
            style={{ flex: 1, minWidth: '12rem', padding: '.4rem .6rem', border: '1px solid var(--line-strong)', borderRadius: 6, background: 'var(--surface)', color: 'var(--ink)', fontSize: '.85rem' }}
          />
          <button type="submit" className="btn btn-primary btn-sm" disabled={busy || name.trim().length < 2}>Create</button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(false)}>Cancel</button>
        </form>
      )}

      {issued && (
        <div>
          <p style={{ fontSize: '.85rem', color: 'var(--ink-soft)', marginBottom: '.6rem' }}>
            <strong>{issued.name}</strong> is enrolled. On that PC, download the installer and run it once as
            administrator with this device key — the agent and browser extension configure themselves.
          </p>
          <div style={{ display: 'flex', gap: '.5rem', alignItems: 'center', background: 'var(--surface-sunken)', padding: '.6rem .7rem', borderRadius: 6 }}>
            <code style={{ flex: 1, fontSize: '.75rem', wordBreak: 'break-all' }}>{installCmd}</code>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => { void navigator.clipboard?.writeText(installCmd); setCopied(true); }}
            >{copied ? 'Copied' : 'Copy'}</button>
          </div>
          <p style={{ fontSize: '.78rem', color: 'var(--muted)', marginTop: '.6rem' }}>
            Keep this key private — it lets a device report as {issued.name}. It won't be shown again.
          </p>
          <button className="btn btn-ghost btn-sm" style={{ marginTop: '.7rem' }} onClick={() => { setIssued(null); setOpen(false); }}>Done</button>
        </div>
      )}
    </div>
  );
}
