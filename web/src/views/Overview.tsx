import { api, type Child } from '../lib/api';
import { useAsync } from '../lib/useAsync';
import { Avatar } from '../components/ui';
import { Sparkline, colorVar } from '../components/charts';
import { IconAlert } from '../components/icons';
import { minutesToHm } from '../lib/format';

export function Overview({ children, refreshKey, onReview }: { children: Child[]; refreshKey: number; onReview: () => void }) {
  // The banner surfaces the most recent open critical alert across all children.
  const { data } = useAsync(() => api.alerts(undefined, 'critical'), [refreshKey]);
  const topCritical = data?.alerts.find((a) => a.status === 'open');

  return (
    <>
      {topCritical && (
        <div className="attention-banner">
          <IconAlert />
          <div>
            <h4>Needs your attention</h4>
            <p>{topCritical.label} was flagged on {topCritical.childName}'s device — {relative(topCritical.occurredAt)}.</p>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={onReview}>Review alert</button>
        </div>
      )}

      <div className="grid-2">
        {children.map((c) => <ChildCard key={c.id} child={c} />)}
      </div>
    </>
  );
}

function ChildCard({ child: c }: { child: Child }) {
  const pct = Math.min(100, Math.round((c.todayMin / c.limitMin) * 100));
  const meterColor = pct >= 90 ? 'var(--status-concerning)' : 'var(--accent)';
  return (
    <div className="card card-pad">
      <div className="child-card-head">
        <Avatar name={c.name} color={c.color} size="lg" />
        <div>
          <h3>{c.name}</h3>
          <div className="device-line">
            <span className={`status-dot ${c.device?.online ? '' : 'off'}`} />
            {c.device ? `${c.device.name} · ${c.device.online ? 'online now' : 'offline'}` : 'no device'}
          </div>
        </div>
      </div>
      <div className="child-stats">
        <div>
          <span className="stat-label">Screen time today</span>
          <span className="stat-value">{minutesToHm(c.todayMin)} <small>/ {minutesToHm(c.limitMin)} limit</small></span>
        </div>
        <div>
          <span className="stat-label">Open alerts</span>
          <span className="stat-value" style={{ color: c.openAlerts > 0 ? 'var(--status-critical)' : undefined }}>{c.openAlerts}</span>
        </div>
        <div>
          <span className="stat-label">Blocked today</span>
          <span className="stat-value" style={{ color: c.blockedToday > 0 ? 'var(--accent)' : undefined }}>{c.blockedToday}</span>
        </div>
      </div>
      <div className="meter"><div style={{ width: `${pct}%`, background: meterColor }} /></div>
      <div className="sparkwrap"><Sparkline values={c.spark} color={c.color} /></div>
      <div style={{ fontSize: '.72rem', color: 'var(--muted)', marginTop: '.3rem', display: 'flex', alignItems: 'center', gap: '.35rem' }}>
        <span style={{ width: '.55rem', height: '.15rem', background: colorVar(c.color), borderRadius: 2 }} /> last 7 days
      </div>
    </div>
  );
}

function relative(iso: string): string {
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return 'moments ago';
  if (min < 60) return `${min} minute${min === 1 ? '' : 's'} ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} hour${h === 1 ? '' : 's'} ago`;
  return new Date(iso).toLocaleDateString();
}
