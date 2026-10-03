import React from 'react';
import { Icon } from './Icon.jsx';
export function Tag({ children, mono = true, onRemove, style }) {
  return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 26, padding: onRemove ? '0 6px 0 10px' : '0 10px', borderRadius: 'var(--radius-pill)', border: '1px solid var(--border-default)', color: 'var(--text-body)', fontFamily: mono ? 'var(--font-mono)' : 'var(--font-sans)', fontSize: 12, whiteSpace: 'nowrap', ...style }}>
    {children}
    {onRemove && <button onClick={onRemove} aria-label="Remove" style={{ display: 'inline-flex', border: 0, background: 'none', padding: 2, cursor: 'pointer', color: 'var(--text-muted)' }}><Icon name="x" size={12} /></button>}
  </span>;
}
