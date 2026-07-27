import { useState } from 'react';
import { api, type Child } from '../lib/api';
import { useAsync } from '../lib/useAsync';
import { Avatar } from '../components/ui';
import { relativeTime } from '../lib/format';
import { INSTALLER_DOWNLOAD_URL } from '../lib/config';

export function Devices({ children, refreshKey }: { children: Child[]; refreshKey: number }) {
  const [nonce, setNonce] = useState(0);
  const { data, loading } = useAsync(() => api.devices(), [refreshKey, nonce]);
  const [revealed, setRevealed] = useState<{ name: string; deviceToken: string } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function getKey(id: string, name: string, alreadySetUp: boolean) {
    if (alreadySetUp && !window.confirm(`${name} is already reporting in. Getting a new key will stop it working until you reinstall with the new one. Continue?`)) {
      return;
    }
    setBusyId(id);
    try {
      const res = await api.regenerateDeviceKey(id);
      setRevealed({ name: res.name, deviceToken: res.deviceToken });
    } finally {
      setBusyId(null);
    }
  }

  if (loading) return <p className="loading">Loading devices…</p>;
  return (
    <>
      <p style={{ marginBottom: '.8rem' }}>
        <a href={INSTALLER_DOWNLOAD_URL} className="btn btn-ghost btn-sm">Download the Wardline installer</a>
        <span style={{ color: 'var(--muted)', marginLeft: '.6rem', fontSize: '.85rem' }}>
          Needs a device key to finish setup — get one with "Add a device" below.
        </span>
      </p>
      <div className="tbl-wrap">
        <table>
          <thead>
            <tr><th>Device</th><th>Assigned to</th><th>Status</th><th>Agent</th><th>Browser coverage</th><th>Last check-in</th><th></th></tr>
          </thead>
          <tbody>
            {data?.map((d) => {
              const alreadySetUp = d.agentVersion !== 'not yet installed';
              return (
                <tr key={d.id}>
                  <td><span className="device-name"><Avatar name={d.childName} color={d.childColor} />{d.name}</span></td>
                  <td>{d.childName}</td>
                  <td><span className={`status-live ${d.online ? '' : 'off'}`}><span className="dot" />{d.online ? 'Online' : 'Offline'}</span></td>
                  <td><span className="mono">{d.agentVersion}</span></td>
                  <td>{d.browserCoverage}</td>
                  <td>{relativeTime(d.lastSeen)}</td>
                  <td>
                    <button
                      className="btn btn-ghost btn-sm" disabled={busyId === d.id}
                      onClick={() => getKey(d.id, d.name, alreadySetUp)}
                      title={alreadySetUp ? 'The device key is only shown once at creation. Getting a new one replaces it and disconnects this device until reinstalled.' : 'Show the device key again to finish installing.'}
                    >{alreadySetUp ? 'Replace key' : 'Get key'}</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {revealed && <KeyReveal name={revealed.name} deviceToken={revealed.deviceToken} onDone={() => { setRevealed(null); setNonce((n) => n + 1); }} />}

      <AddDevice childrenList={children} onAdded={() => setNonce((n) => n + 1)} />
    </>
  );
}

/** The one-time device-key reveal, shared by "Add a device" and "Get key"/"Replace key" on an existing row. */
function KeyReveal({ name, deviceToken, onDone }: { name: string; deviceToken: string; onDone: () => void }) {
  const [copied, setCopied] = useState(false);
  const installCmd = `WardlineSetup.exe /DeviceToken=${deviceToken}`;

  return (
    <div className="card card-pad" style={{ marginTop: '1rem' }}>
      <span className="section-title">Install on {name}</span>
      <p style={{ fontSize: '.85rem', color: 'var(--ink-soft)', margin: '.5rem 0 .6rem' }}>
        On that PC, download the installer and run it once as administrator with this device key — the agent
        and browser extension configure themselves.
      </p>
      <p style={{ marginBottom: '.6rem' }}>
        <a href={INSTALLER_DOWNLOAD_URL} className="btn btn-primary btn-sm">Download WardlineSetup.exe</a>
      </p>

      <span style={{ display: 'block', fontSize: '.78rem', fontWeight: 600, marginBottom: '.3rem' }}>Device key</span>
      <div style={{ display: 'flex', gap: '.5rem', alignItems: 'center', background: 'var(--surface-sunken)', padding: '.6rem .7rem', borderRadius: 6 }}>
        <code style={{ flex: 1, fontSize: '.85rem' }}>{deviceToken}</code>
        <button
          className="btn btn-ghost btn-sm"
          onClick={() => { void navigator.clipboard?.writeText(deviceToken); setCopied(true); }}
        >{copied ? 'Copied' : 'Copy'}</button>
      </div>
      <p style={{ fontSize: '.78rem', color: 'var(--muted)', margin: '.5rem 0 .8rem' }}>
        The installer asks for this on its first screen — paste it there. Or run it unattended with the full
        command:
      </p>
      <code style={{ display: 'block', fontSize: '.75rem', wordBreak: 'break-all', color: 'var(--muted)' }}>{installCmd}</code>

      <p style={{ fontSize: '.78rem', color: 'var(--muted)', marginTop: '.8rem' }}>
        Keep this key private — it lets a device report as {name}. It won't be shown again.
      </p>
      <button className="btn btn-ghost btn-sm" style={{ marginTop: '.7rem' }} onClick={onDone}>Done</button>
    </div>
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

  if (issued) {
    return <KeyReveal name={issued.name} deviceToken={issued.deviceToken} onDone={() => { setIssued(null); setOpen(false); }} />;
  }

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
    </div>
  );
}
