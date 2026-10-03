import React from 'react';
import { Icon } from '../core/Icon.jsx';
import { IconButton } from '../core/IconButton.jsx';
const IC = { blocked: ['shield-x', 'var(--clay-500)'], passed: ['shield-check', 'var(--verdigris-500)'], review: ['shield-alert', 'var(--ochre-500)'], info: ['info', 'var(--blue-500)'] };
export function Toast({ status = 'info', title, message, meta, onClose, style }) {
  const [ic, c] = IC[status] || IC.info;
  return <div role="status" style={{ display: 'flex', gap: 12, alignItems: 'flex-start', width: 360, padding: '14px 12px 14px 16px', borderRadius: 'var(--radius-md)', background: 'var(--ink-900)', color: 'var(--bone-300)', boxShadow: 'var(--shadow-3)', fontFamily: 'var(--font-sans)', ...style }}>
    <span style={{ color: c, paddingTop: 1 }}><Icon name={ic} size={18} /></span>
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--bone-50)' }}>{title}</div>
      {message && <div style={{ fontSize: 13, marginTop: 2, color: 'var(--bone-400)' }}>{message}</div>}
      {meta && <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, marginTop: 8, color: 'var(--stone-500)' }}>{meta}</div>}
    </div>
    {onClose && <span className="theme-ink"><IconButton icon="x" label="Dismiss" size="sm" onClick={onClose} /></span>}
  </div>;
}
