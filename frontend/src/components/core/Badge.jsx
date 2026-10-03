import React from 'react';
const MAP = {
  blocked: ['var(--status-blocked-bg)', 'var(--clay-600)', 'var(--status-blocked)'],
  passed: ['var(--status-passed-bg)', 'var(--verdigris-600)', 'var(--status-passed)'],
  review: ['var(--status-review-bg)', 'var(--ochre-600)', 'var(--status-review)'],
  jev: ['var(--status-jev-bg)', 'var(--blue-700)', 'var(--status-jev)'],
  neutral: ['var(--border-subtle)', 'var(--text-body)', 'var(--text-faint)'],
};
export function Badge({ status = 'neutral', dot = true, children, style }) {
  const [bg, fg, d] = MAP[status] || MAP.neutral;
  return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 22, padding: '0 8px', borderRadius: 'var(--radius-xs)', background: bg, color: fg, fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 500, letterSpacing: '0.04em', textTransform: 'uppercase', whiteSpace: 'nowrap', ...style }}>
    {dot && <span style={{ width: 6, height: 6, background: d, flex: 'none' }} />}{children}
  </span>;
}
