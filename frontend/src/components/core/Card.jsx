import React from 'react';
const V = {
  paper: { background: 'var(--surface-card)', border: '1px solid var(--border-subtle)', boxShadow: 'var(--shadow-1)', color: 'var(--text-body)' },
  sunken: { background: 'var(--surface-sunken)', border: '1px solid var(--border-subtle)', color: 'var(--text-body)' },
  glass: { background: 'var(--surface-glass)', border: '1px solid rgba(255,255,255,.5)', boxShadow: 'var(--shadow-3), var(--shadow-inset)', backdropFilter: 'blur(var(--blur-glass)) saturate(1.1)', WebkitBackdropFilter: 'blur(var(--blur-glass)) saturate(1.1)', color: 'var(--stone-800)' },
  'glass-dark': { background: 'var(--surface-glass-dark)', border: '1px solid var(--border-glass)', boxShadow: 'var(--shadow-3)', backdropFilter: 'blur(var(--blur-glass))', WebkitBackdropFilter: 'blur(var(--blur-glass))', color: 'var(--bone-300)' },
  ink: { background: 'var(--ink-900)', border: '1px solid var(--ink-900)', color: 'var(--bone-300)' },
};
export function Card({ variant = 'paper', padding = 24, radius = 'var(--radius-lg)', children, style, ...rest }) {
  return <div style={{ borderRadius: radius, padding, ...V[variant], ...style }} {...rest}>{children}</div>;
}
