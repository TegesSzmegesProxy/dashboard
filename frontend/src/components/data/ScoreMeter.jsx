import React from 'react';
export function ScoreMeter({ score = 0, tiles = 20, label = 'Maliciousness', showValue = true, threshold = 0.7, tone = 'light', style }) {
  const lit = Math.round(score * tiles);
  const col = i => { const p = (i + 1) / tiles; if (i >= lit) return tone === 'dark' ? 'rgba(241,235,224,.1)' : 'var(--bone-300)'; return p > threshold ? 'var(--clay-500)' : p > threshold * 0.6 ? 'var(--ochre-500)' : 'var(--verdigris-500)'; };
  const verdict = score >= threshold ? 'block' : score >= threshold * 0.6 ? 'review' : 'pass';
  const dark = tone === 'dark';
  return <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontFamily: 'var(--font-mono)', ...style }}>
    {(label || showValue) && <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: dark ? 'var(--bone-500)' : 'var(--text-muted)' }}><span>{label}</span>{showValue && <span style={{ color: dark ? 'var(--bone-100)' : 'var(--text-strong)' }}>{score.toFixed(2)} · {verdict}</span>}</div>}
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${tiles}, 1fr)`, gap: 2 }}>
      {Array.from({ length: tiles }, (_, i) => <span key={i} style={{ height: 14, background: col(i), transition: `background var(--dur-base) var(--ease-out) ${i * 12}ms` }} />)}
    </div>
  </div>;
}
