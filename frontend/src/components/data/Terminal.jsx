import React from 'react';
const C = { cmd: 'var(--bone-50)', out: 'var(--bone-400)', comment: 'var(--stone-500)', block: 'var(--clay-500)', pass: 'var(--verdigris-500)', jev: 'var(--blue-300)', key: 'var(--blue-300)', warn: 'var(--ochre-500)' };
function hl(text) {
  const parts = []; const re = /("[^"]*"|'[^']*'|\b\d+(?:\.\d+)?\b|^\s*[\w.-]+:)/g; let last = 0, m, k = 0;
  while ((m = re.exec(text))) { if (m.index > last) parts.push(text.slice(last, m.index)); const s = m[0]; const col = /^["']/.test(s) ? 'var(--ochre-100)' : /:$/.test(s) ? 'var(--blue-300)' : 'var(--terracotta-400)'; parts.push(<span key={k++} style={{ color: col }}>{s}</span>); last = m.index + s.length; }
  parts.push(text.slice(last)); return parts;
}
export function Terminal({ title = 'tessera', lines = [], highlight = true, style }) {
  return <div style={{ borderRadius: 'var(--radius-lg)', background: 'var(--ink-900)', border: '1px solid #2c2a28', boxShadow: 'var(--shadow-3)', overflow: 'hidden', fontFamily: 'var(--font-mono)', ...style }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, height: 38, padding: '0 14px', borderBottom: '1px solid rgba(241,235,224,.08)' }}>
      <span style={{ display: 'flex', gap: 5 }}>{[0, 1, 2].map(i => <span key={i} style={{ width: 8, height: 8, background: 'var(--stone-700)' }} />)}</span>
      <span style={{ fontSize: 12, color: 'var(--stone-500)' }}>{title}</span>
    </div>
    <pre style={{ margin: 0, padding: '16px 18px 18px', fontSize: 13, lineHeight: 1.65, color: 'var(--bone-300)', overflowX: 'auto', whiteSpace: 'pre' }}>
      {lines.map((l, i) => { const ln = typeof l === 'string' ? { kind: 'out', text: l } : l; const plain = ln.kind === 'out' || ln.kind === 'code';
        return <div key={i} style={{ color: C[ln.kind] || 'var(--bone-300)' }}>{ln.kind === 'cmd' && <span style={{ color: 'var(--blue-500)' }}>$ </span>}{highlight && plain ? hl(ln.text) : ln.text}</div>; })}
    </pre>
  </div>;
}
