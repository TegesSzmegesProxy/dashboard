import React from 'react';
import { Sparkline } from './Sparkline.jsx';
export function StatTile({ label, value, unit, delta, deltaTone = 'neutral', trend, trendColor, variant = 'paper', style }) {
  const ink = variant === 'ink';
  const dc = { good: 'var(--verdigris-500)', bad: 'var(--clay-500)', neutral: ink ? 'var(--bone-500)' : 'var(--text-muted)' }[deltaTone];
  return <div style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: 20, borderRadius: 'var(--radius-lg)', background: ink ? 'var(--ink-900)' : 'var(--surface-card)', border: ink ? '1px solid var(--ink-900)' : '1px solid var(--border-subtle)', boxShadow: ink ? 'none' : 'var(--shadow-1)', fontFamily: 'var(--font-sans)', minWidth: 0, ...style }}>
    <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: ink ? 'var(--bone-500)' : 'var(--text-muted)' }}>{label}</div>
    <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12 }}>
      <div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
          <span style={{ fontSize: 40, fontWeight: 400, lineHeight: 1, letterSpacing: '-0.04em', color: ink ? 'var(--bone-50)' : 'var(--text-strong)', fontVariantNumeric: 'tabular-nums' }}>{value}</span>
          {unit && <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: ink ? 'var(--bone-500)' : 'var(--text-muted)' }}>{unit}</span>}
        </div>
        {delta && <div style={{ marginTop: 8, fontFamily: 'var(--font-mono)', fontSize: 12, color: dc }}>{delta}</div>}
      </div>
      {trend && <Sparkline data={trend} width={96} height={36} color={trendColor || (ink ? 'var(--blue-300)' : 'var(--ink-900)')} />}
    </div>
  </div>;
}
