import React from 'react';
export function NavPill({ items = [], active, onSelect, tone = 'light', style }) {
  const dark = tone === 'dark';
  return <nav style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: 4, borderRadius: 999, background: dark ? 'rgba(31,31,31,.62)' : 'rgba(247,243,235,.7)', border: dark ? '1px solid var(--border-glass)' : '1px solid rgba(31,31,31,.08)', backdropFilter: 'blur(14px)', WebkitBackdropFilter: 'blur(14px)', fontFamily: 'var(--font-sans)', ...style }}>
    {items.map((it, i) => { const on = it === active; return <React.Fragment key={it}>
      {i > 0 && <span aria-hidden="true" style={{ width: 3, height: 3, background: dark ? 'var(--bone-500)' : 'var(--stone-500)' }} />}
      <button onClick={() => onSelect && onSelect(it)} style={{ height: 34, padding: '0 16px', border: 0, borderRadius: 999, cursor: 'pointer', fontFamily: 'inherit', fontSize: 14, fontWeight: 450, background: on ? (dark ? 'rgba(241,235,224,.12)' : 'var(--bone-50)') : 'transparent', color: dark ? (on ? 'var(--bone-50)' : 'var(--bone-300)') : (on ? 'var(--ink-900)' : 'var(--stone-700)'), transition: 'all var(--dur-fast) var(--ease-out)' }}>{it}</button>
    </React.Fragment>; })}
  </nav>;
}
