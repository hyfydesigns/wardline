import { api, type Schedule } from '../lib/api';
import { useAsync } from '../lib/useAsync';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const START_HOUR = 6;
const END_HOUR = 23;
const HOURS = Array.from({ length: END_HOUR - START_HOUR + 1 }, (_, i) => START_HOUR + i);

function hourLabel(h: number): string {
  const suffix = h < 12 ? 'a' : 'p';
  const hr = h % 12 === 0 ? 12 : h % 12;
  return `${hr}${suffix}`;
}

function blockStyle(s: Schedule): React.CSSProperties {
  const rowStart = 2 + (Math.floor(s.startMin / 60) - START_HOUR);
  const rowEnd = 2 + (Math.ceil(s.endMin / 60) - START_HOUR);
  const colStart = Math.min(...s.days) + 2;
  const colEnd = Math.max(...s.days) + 3;
  return { gridRow: `${rowStart} / ${rowEnd}`, gridColumn: `${colStart} / ${colEnd}` };
}

export function Schedules({ refreshKey }: { refreshKey: number }) {
  const { data, loading } = useAsync(() => api.schedules(), [refreshKey]);
  return (
    <div className="card card-pad">
      <span className="section-title">Household schedule</span>
      <p style={{ color: 'var(--muted)', fontSize: '.85rem', marginBottom: '1rem' }}>
        Applies to every device unless overridden per child. Blocks internet access during the shaded windows.
      </p>
      <div className="sched-grid">
        <div />
        {DAYS.map((d) => <div key={d} className="sched-head">{d}</div>)}
        {HOURS.map((h, i) => (
          <div key={h} className="time-label" style={{ gridRow: i + 2 }}>{hourLabel(h)}</div>
        ))}
        {HOURS.map((h, i) =>
          DAYS.map((_, d) => <div key={`${h}-${d}`} className="day-cell" style={{ gridRow: i + 2, gridColumn: d + 2 }} />),
        )}
        {!loading && data?.map((s) => (
          <div key={s.id} className={`sched-block ${s.kind}`} style={blockStyle(s)}>{s.name}</div>
        ))}
      </div>
      <div className="sched-legend">
        {data?.map((s) => (
          <span className="key" key={s.id}>
            <span className={`swatch ${s.kind}`} style={swatchStyle(s.kind)} />{s.name} — {s.scope}
          </span>
        ))}
      </div>
    </div>
  );
}

function swatchStyle(kind: string): React.CSSProperties {
  if (kind === 'school') return { background: 'var(--primary-soft)', border: '1px solid var(--primary)' };
  if (kind === 'dinner') return { background: 'var(--accent-soft)', border: '1px solid var(--accent)' };
  return { background: 'var(--surface-sunken)', border: '1px dashed var(--line-strong)' };
}
