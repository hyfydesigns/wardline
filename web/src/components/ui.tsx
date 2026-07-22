import type { ReactNode } from 'react';
import { avatarClass, initials } from '../lib/format';
import type { Severity } from '../lib/api';

export function Avatar({ name, color, size }: { name: string; color: string; size?: 'sm' | 'lg' }) {
  return <span className={`avatar ${avatarClass(color)} ${size ?? ''}`}>{initials(name)}</span>;
}

const SEVERITY_LABEL: Record<Severity, string> = {
  critical: 'Critical', concerning: 'Concerning', informational: 'Informational',
};

export function SeverityPill({ severity }: { severity: Severity }) {
  return <span className={`pill pill-${severity}`}>{SEVERITY_LABEL[severity]}</span>;
}

export function Switch({ checked, onChange, disabled }: { checked: boolean; onChange?: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className="switch">
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange?.(e.target.checked)} />
      <span className="track" /><span className="thumb" />
    </label>
  );
}

export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="segmented" role="group">
      {options.map((o) => (
        <button key={o.value} className={o.value === value ? 'active' : ''} onClick={() => onChange(o.value)} type="button">
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={`card ${className ?? ''}`}>{children}</div>;
}
