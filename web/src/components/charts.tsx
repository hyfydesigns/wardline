import { useRef, useState, type ReactNode } from 'react';
import type { ScreenTimeReport, CategorySlice, SeverityWeek } from '../lib/api';

export function colorVar(color: string): string {
  return color === 'ava' ? 'var(--series-ava)' : 'var(--series-marcus)';
}

interface TipState { show: boolean; left: number; top: number; content: ReactNode; }
const HIDDEN: TipState = { show: false, left: 0, top: 0, content: null };

function Tooltip({ tip }: { tip: TipState }) {
  return (
    <div className="chart-tooltip" style={{ left: tip.left, top: tip.top, opacity: tip.show ? 1 : 0 }}>
      {tip.content}
    </div>
  );
}

function Dot({ color }: { color: string }) {
  return <span className="tt-dot" style={{ background: color }} />;
}

/* ------------------------------- Sparkline ------------------------------- */
export function Sparkline({ values, color }: { values: number[]; color: string }) {
  const w = 260, h = 40, pad = 4;
  if (values.length < 2) return <svg viewBox={`0 0 ${w} ${h}`} />;
  const max = Math.max(...values, 1);
  const min = Math.min(...values) * 0.7;
  const range = max - min || 1;
  const pts = values.map((v, i) => [pad + (i * (w - pad * 2)) / (values.length - 1), h - pad - ((v - min) / range) * (h - pad * 2)]);
  const line = 'M' + pts.map((p) => `${p[0]},${p[1]}`).join(' L');
  const area = `${line} L${pts[pts.length - 1][0]},${h} L${pts[0][0]},${h} Z`;
  const c = colorVar(color);
  const last = pts[pts.length - 1];
  return (
    <svg viewBox={`0 0 ${w} ${h}`}>
      <path d={area} style={{ fill: c, opacity: 0.12 }} />
      <path d={line} fill="none" style={{ stroke: c }} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={last[0]} cy={last[1]} r={4} style={{ fill: c, stroke: 'var(--surface)' }} strokeWidth={2} />
    </svg>
  );
}

/* --------------------------- Screen-time line ---------------------------- */
export function ScreenTimeLine({ report }: { report: ScreenTimeReport }) {
  const [tip, setTip] = useState<TipState>(HIDDEN);
  const [crossX, setCrossX] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const W = 640, H = 240, padL = 36, padR = 44, padT = 16, padB = 30;
  const n = report.days.length;
  const allVals = report.series.flatMap((s) => s.values);
  const max = Math.max(60, Math.ceil(Math.max(1, ...allVals) / 60) * 60);
  const x = (i: number) => padL + (i * (W - padL - padR)) / Math.max(1, n - 1);
  const y = (v: number) => H - padB - (v / max) * (H - padT - padB);
  const ticks = Array.from({ length: max / 60 + 1 }, (_, i) => i * 60);
  const dayLabel = (d: string) => new Date(d + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'short' });

  function onMove(e: React.MouseEvent) {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const mx = ((e.clientX - rect.left) / rect.width) * W;
    let i = Math.round((mx - padL) / ((W - padL - padR) / Math.max(1, n - 1)));
    i = Math.max(0, Math.min(n - 1, i));
    setCrossX(x(i));
    setTip({
      show: true, left: e.clientX, top: e.clientY,
      content: (
        <>
          <div style={{ fontWeight: 700, marginBottom: '.25rem' }}>{dayLabel(report.days[i])}</div>
          {report.series.map((s) => (
            <div className="tt-row" key={s.childId}><Dot color={colorVar(s.color)} />{s.name} — {s.values[i]} min</div>
          ))}
        </>
      ),
    });
  }

  return (
    <>
      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', overflow: 'visible' }}
        onMouseMove={onMove} onMouseLeave={() => { setTip(HIDDEN); setCrossX(null); }}>
        {ticks.map((v) => (
          <g key={v}>
            <line x1={padL} x2={W - padR} y1={y(v)} y2={y(v)} style={{ stroke: 'var(--chart-grid)' }} strokeWidth={1} />
            <text x={6} y={y(v) + 4} fontSize={10} style={{ fill: 'var(--faint)', fontFamily: 'var(--font-mono)' }}>{v === 0 ? '0' : `${v}m`}</text>
          </g>
        ))}
        {report.days.map((d, i) => (
          <text key={d} x={x(i)} y={H - 8} fontSize={11} textAnchor="middle" style={{ fill: 'var(--muted)' }}>{dayLabel(d)}</text>
        ))}
        {crossX !== null && <line x1={crossX} x2={crossX} y1={padT} y2={H - padB} style={{ stroke: 'var(--line-strong)' }} strokeWidth={1} />}
        {report.series.map((s) => {
          const c = colorVar(s.color);
          const pts = s.values.map((v, i) => [x(i), y(v)]);
          const line = 'M' + pts.map((p) => `${p[0]},${p[1]}`).join(' L');
          const area = `${line} L${pts[pts.length - 1][0]},${y(0)} L${pts[0][0]},${y(0)} Z`;
          const last = pts[pts.length - 1];
          return (
            <g key={s.childId}>
              <path d={area} style={{ fill: c, opacity: 0.08 }} />
              <path d={line} fill="none" style={{ stroke: c }} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
              {pts.map((p, i) => <circle key={i} cx={p[0]} cy={p[1]} r={3.5} style={{ fill: c, stroke: 'var(--surface)' }} strokeWidth={2} />)}
              <text x={last[0] + 8} y={last[1] + 4} fontSize={11} fontWeight={700} style={{ fill: c }}>{s.values[s.values.length - 1]}m</text>
            </g>
          );
        })}
      </svg>
      <Tooltip tip={tip} />
    </>
  );
}

/* ---------------------------- Category bars ------------------------------ */
export function CategoryBars({ data, color }: { data: CategorySlice[]; color: string }) {
  const [tip, setTip] = useState<TipState>(HIDDEN);
  const W = 400, H = 240, padL = 10, padR = 10, padT = 12, padB = 28;
  if (data.length === 0) return <p className="empty">No usage recorded yet.</p>;
  const n = data.length, gap = 14;
  const bw = Math.min(48, (W - padL - padR - gap * (n - 1)) / n);
  const max = Math.max(...data.map((d) => d.pct), 1);
  const c = colorVar(color);
  return (
    <>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', overflow: 'visible' }}>
        {data.map((d, i) => {
          const bx = padL + i * (bw + gap);
          const bh = (d.pct / max) * (H - padT - padB);
          const by = H - padB - bh;
          return (
            <g key={d.category}
              onMouseMove={(e) => setTip({ show: true, left: e.clientX, top: e.clientY, content: <div className="tt-row"><Dot color={c} />{d.category} — {d.pct}% · {d.minutes} min</div> })}
              onMouseLeave={() => setTip(HIDDEN)}>
              <rect x={bx} y={by} width={bw} height={bh} rx={4} style={{ fill: c }} />
              <text x={bx + bw / 2} y={by - 6} fontSize={11} fontWeight={700} textAnchor="middle" style={{ fill: 'var(--ink)' }}>{d.pct}%</text>
              <text x={bx + bw / 2} y={H - 10} fontSize={10.5} textAnchor="middle" style={{ fill: 'var(--muted)' }}>{d.category}</text>
            </g>
          );
        })}
        <line x1={padL} x2={W - padR} y1={H - padB} y2={H - padB} style={{ stroke: 'var(--chart-axis)' }} strokeWidth={1} />
      </svg>
      <Tooltip tip={tip} />
    </>
  );
}

/* --------------------------- Severity bars ------------------------------- */
const SEV_COLORS: Record<string, string> = {
  critical: 'var(--status-critical)', concerning: 'var(--status-concerning)', informational: 'var(--status-info)',
};
export function SeverityBars({ data }: { data: SeverityWeek[] }) {
  const [tip, setTip] = useState<TipState>(HIDDEN);
  const W = 400, H = 200, padL = 10, padR = 10, padT = 12, padB = 26;
  const keys = ['critical', 'concerning', 'informational'] as const;
  const max = Math.max(1, ...data.flatMap((w) => keys.map((k) => w[k])));
  const groupW = (W - padL - padR) / Math.max(1, data.length);
  const barW = 14, barGap = 2;
  return (
    <>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', overflow: 'visible' }}>
        {data.map((wk, i) => {
          const gx = padL + i * groupW + groupW / 2 - (barW * 3 + barGap * 2) / 2;
          return (
            <g key={wk.week}>
              {keys.map((k, j) => {
                const v = wk[k];
                const bh = (v / max) * (H - padT - padB);
                const bx = gx + j * (barW + barGap);
                const by = H - padB - Math.max(bh, 1);
                return (
                  <rect key={k} x={bx} y={by} width={barW} height={Math.max(bh, 1)} rx={3} style={{ fill: SEV_COLORS[k] }}
                    onMouseMove={(e) => setTip({ show: true, left: e.clientX, top: e.clientY, content: <div className="tt-row"><Dot color={SEV_COLORS[k]} />{k[0].toUpperCase() + k.slice(1)} — {v}</div> })}
                    onMouseLeave={() => setTip(HIDDEN)} />
                );
              })}
              <text x={padL + i * groupW + groupW / 2} y={H - 8} fontSize={10.5} textAnchor="middle" style={{ fill: 'var(--muted)' }}>{wk.week}</text>
            </g>
          );
        })}
        <line x1={padL} x2={W - padR} y1={H - padB} y2={H - padB} style={{ stroke: 'var(--chart-axis)' }} strokeWidth={1} />
      </svg>
      <Tooltip tip={tip} />
    </>
  );
}
