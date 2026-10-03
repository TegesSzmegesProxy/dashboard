import React from 'react';
export function Tabs({ tabs = [], value, onChange, variant = 'underline', style }) {
  const pill = variant === 'pill';
  return <div role="tablist" style={{ display: 'flex', gap: pill ? 2 : 24, padding: pill ? 3 : 0, borderRadius: pill ? 999 : 0, background: pill ? 'var(--surface-sunken)' : 'transparent', borderBottom: pill ? 0 : '1px solid var(--border-default)', width: pill ? 'fit-content' : 'auto', fontFamily: 'var(--font-sans)', ...style }}>
    {tabs.map(t => { const on = t.id === value; return <button key={t.id} role="tab" aria-selected={on} onClick={() => onChange && onChange(t.id)} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, border: 0, cursor: 'pointer', fontFamily: 'inherit', fontSize: 14, fontWeight: 500, transition: 'all var(--dur-fast) var(--ease-out)',
      ...(pill ? { height: 32, padding: '0 14px', borderRadius: 999, background: on ? 'var(--surface-card)' : 'transparent', boxShadow: on ? 'var(--shadow-1)' : 'none', color: on ? 'var(--text-strong)' : 'var(--text-muted)' }
        : { height: 40, padding: 0, background: 'transparent', marginBottom: -1, borderBottom: on ? '2px solid var(--text-strong)' : '2px solid transparent', color: on ? 'var(--text-strong)' : 'var(--text-muted)' }) }}>
      {t.label}{t.count != null && <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-faint)' }}>{t.count}</span>}
    </button>; })}
  </div>;
}
