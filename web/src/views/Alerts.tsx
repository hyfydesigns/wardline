import { useState } from 'react';
import { api, type Alert, type AlertStatus } from '../lib/api';
import { useAsync } from '../lib/useAsync';
import { Avatar, SeverityPill } from '../components/ui';
import { timeOfDay, STATUS_LABEL } from '../lib/format';

const FILTERS: { key: string; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'critical', label: 'Critical' },
  { key: 'concerning', label: 'Concerning' },
  { key: 'informational', label: 'Informational' },
];

export function Alerts({ childId, refreshKey, flashId }: { childId?: string; refreshKey: number; flashId?: string | null }) {
  const [severity, setSeverity] = useState('all');
  const { data, loading, reload } = useAsync(() => api.alerts(childId, severity), [childId, severity, refreshKey]);

  return (
    <>
      <div className="alert-filters">
        {FILTERS.map((f) => (
          <button key={f.key} className={`chip-filter ${severity === f.key ? 'active' : ''}`} onClick={() => setSeverity(f.key)}>
            {f.label}{data ? ` (${data.counts[f.key as keyof typeof data.counts]})` : ''}
          </button>
        ))}
      </div>
      {loading && <p className="loading">Loading alerts…</p>}
      {data && data.alerts.length === 0 && <p className="empty">No alerts in this view. That's good news.</p>}
      {data?.alerts.map((a) => (
        <AlertRow key={a.id} alert={a} flash={a.id === flashId} onChange={reload} />
      ))}
    </>
  );
}

function AlertRow({ alert: a, flash, onChange }: { alert: Alert; flash: boolean; onChange: () => void }) {
  const [open, setOpen] = useState(a.severity === 'critical' && a.status === 'open');
  const [busy, setBusy] = useState(false);

  async function setStatus(status: AlertStatus) {
    setBusy(true);
    try { await api.setAlertStatus(a.id, status); onChange(); }
    finally { setBusy(false); }
  }

  return (
    <div className={`alert-row ${open ? 'open' : ''} ${flash ? 'flash' : ''}`}>
      <button className="alert-summary" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <div className={`alert-stripe ${a.severity}`} />
        <div className="alert-main">
          <div className="top-row">
            <SeverityPill severity={a.severity} />
            <h4>{a.label}</h4>
            {a.status !== 'open' && <span className="status-tag">· {STATUS_LABEL[a.status]}</span>}
          </div>
          <div className="alert-meta">
            <Avatar name={a.childName} color={a.childColor} size="sm" />
            {a.childName} · {a.source} · {timeOfDay(a.occurredAt)}
            {a.confidence != null && ` · confidence ${a.confidence.toFixed(2)}`}
          </div>
          {a.snippet && <p className="alert-snippet">{a.severity === 'critical' ? `"${a.snippet}"` : a.snippet}</p>}
        </div>
        <svg className="chevron" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 9l6 6 6-6" /></svg>
      </button>
      {open && (
        <div className="alert-detail">
          <div className="alert-detail-grid">
            <div>
              <dt>Category</dt><dd>{a.label}</dd>
              <dt>Source</dt><dd>{a.source}</dd>
            </div>
            <div>
              <dt>Confidence</dt><dd>{a.confidence != null ? `${a.confidence.toFixed(2)} — ${a.confidence >= 0.85 ? 'high' : a.confidence >= 0.6 ? 'moderate' : 'low'}` : 'n/a — category / policy match'}</dd>
              <dt>Device</dt><dd>{a.deviceName}</dd>
            </div>
          </div>
          <div className="alert-actions">
            {a.status !== 'reviewed' && <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => setStatus('reviewed')}>Mark reviewed</button>}
            {a.severity === 'informational'
              ? <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => setStatus('dismissed')}>Dismiss</button>
              : <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => setStatus('false_positive')}>Not a concern</button>}
          </div>
        </div>
      )}
    </div>
  );
}
