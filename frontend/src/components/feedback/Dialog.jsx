import React from 'react';
import { IconButton } from '../core/IconButton.jsx';
export function Dialog({ open, title, description, children, actions, onClose, width = 460 }) {
  if (!open) return null;
  return <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, background: 'rgba(31,31,31,.32)', backdropFilter: 'blur(3px)' }}>
    <div role="dialog" aria-modal="true" onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: width, background: 'var(--surface-card)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-subtle)', boxShadow: 'var(--shadow-3)', fontFamily: 'var(--font-sans)' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '20px 20px 0 24px' }}>
        <div style={{ flex: 1, paddingTop: 4 }}>
          <div style={{ fontSize: 18, fontWeight: 500, letterSpacing: '-0.015em', color: 'var(--text-strong)' }}>{title}</div>
          {description && <div style={{ marginTop: 6, fontSize: 14, color: 'var(--text-muted)', textWrap: 'pretty' }}>{description}</div>}
        </div>
        {onClose && <IconButton icon="x" label="Close" size="sm" onClick={onClose} />}
      </div>
      {children && <div style={{ padding: '16px 24px 0' }}>{children}</div>}
      {actions && <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: 24 }}>{actions}</div>}
    </div>
  </div>;
}
