import React from 'react';
export function Ticket({ numeral = 'XII', label, title, meta, status = 'passed', style }) {
  const c = { passed: 'var(--verdigris-500)', blocked: 'var(--clay-500)', review: 'var(--ochre-500)', jev: 'var(--blue-500)' }[status];
  const notch = 'radial-gradient(circle at 0 50%, transparent 7px, #000 7.5px) left/51% 100% no-repeat, radial-gradient(circle at 100% 50%, transparent 7px, #000 7.5px) right/51% 100% no-repeat';
  return <div style={{ display: 'flex', alignItems: 'stretch', width: 'fit-content', minWidth: 300, background: 'var(--surface-card)', borderRadius: 'var(--radius-sm)', WebkitMask: notch, mask: notch, boxShadow: 'var(--shadow-1)', fontFamily: 'var(--font-sans)', ...style }}>
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4, width: 76, padding: '14px 0', background: 'var(--terracotta-500)', color: 'var(--bone-50)' }}>
      <span style={{ fontFamily: 'var(--font-pixel)', fontSize: 20, letterSpacing: '0.04em', lineHeight: 1 }}>{numeral}</span>
      {label && <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase', opacity: .85 }}>{label}</span>}
    </div>
    <div style={{ flex: 1, padding: '14px 22px 14px 16px', borderLeft: '1px dashed var(--border-strong)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, fontWeight: 500, color: 'var(--text-strong)' }}><span style={{ width: 6, height: 6, background: c }} />{title}</div>
      {meta && <div style={{ marginTop: 4, fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)' }}>{meta}</div>}
    </div>
  </div>;
}
