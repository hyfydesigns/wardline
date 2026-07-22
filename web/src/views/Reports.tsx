import { useState } from 'react';
import { api, type Child } from '../lib/api';
import { useAsync } from '../lib/useAsync';
import { ScreenTimeLine, CategoryBars, SeverityBars, colorVar } from '../components/charts';

export function Reports({ children, focusChildId, refreshKey }: { children: Child[]; focusChildId?: string | null; refreshKey: number }) {
  const [days, setDays] = useState(7);
  const focusChild = children.find((c) => c.id === focusChildId) ?? children[0];
  const screen = useAsync(() => api.screenTime(days), [days, refreshKey]);
  const cats = useAsync(() => (focusChild ? api.categories(focusChild.id, days) : Promise.resolve([])), [focusChild?.id, days, refreshKey]);
  const sev = useAsync(() => api.severityByWeek(4), [refreshKey]);

  return (
    <div className="stack">
      <div className="card card-pad">
        <div className="chart-head">
          <span className="section-title" style={{ marginBottom: 0 }}>Screen time, last {days} days</span>
          <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <div className="legend">
              {screen.data?.series.map((s) => (
                <span className="key" key={s.childId}><span className="swatch line" style={{ background: colorVar(s.color) }} />{s.name}</span>
              ))}
            </div>
            <div className="range-select">
              {[7, 14, 30].map((d) => (
                <button key={d} className={days === d ? 'active' : ''} onClick={() => setDays(d)}>{d}d</button>
              ))}
            </div>
          </div>
        </div>
        {screen.data ? <ScreenTimeLine report={screen.data} /> : <p className="loading">Loading…</p>}
      </div>

      <div className="grid-2">
        <div className="card card-pad">
          <span className="section-title">{focusChild?.name ?? 'Child'} — where the time went</span>
          {cats.data ? <CategoryBars data={cats.data} color={focusChild?.color ?? 'marcus'} /> : <p className="loading">Loading…</p>}
        </div>
        <div className="card card-pad">
          <span className="section-title" style={{ marginBottom: '.6rem' }}>Alerts by severity, last 4 weeks</span>
          <div className="legend" style={{ marginBottom: '.6rem' }}>
            <span className="key"><span className="swatch" style={{ background: 'var(--status-critical)' }} />Critical</span>
            <span className="key"><span className="swatch" style={{ background: 'var(--status-concerning)' }} />Concerning</span>
            <span className="key"><span className="swatch" style={{ background: 'var(--status-info)' }} />Informational</span>
          </div>
          {sev.data ? <SeverityBars data={sev.data} /> : <p className="loading">Loading…</p>}
        </div>
      </div>
    </div>
  );
}
