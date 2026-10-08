import React, { useEffect, useId, useRef } from 'react';
import { IconButton } from '../core/IconButton.jsx';
const FOCUSABLE = 'a[href],button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex]:not([tabindex="-1"])';
export function Dialog({ open, title, description, children, actions, onClose, width = 460 }) {
  const ref = useRef(null);
  const id = useId();
  // Close only when the press both started and ended on the backdrop: dragging a text selection out of an input must not dismiss the form.
  const downOnBackdrop = useRef(false);
  useEffect(() => {
    if (!open) return;
    const back = document.activeElement;
    const first = ref.current?.querySelector('input,select,textarea') ?? ref.current;
    first?.focus();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = overflow; back?.focus?.(); };
  }, [open]);
  if (!open) return null;
  const onKeyDown = (e) => {
    if (e.key === 'Escape' && onClose) { e.stopPropagation(); onClose(); return; }
    if (e.key !== 'Tab') return;
    const items = [...ref.current.querySelectorAll(FOCUSABLE)];
    if (!items.length) return;
    const [a, z] = [items[0], items[items.length - 1]];
    if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); }
    else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); }
  };
  return <div onMouseDown={e => { downOnBackdrop.current = e.target === e.currentTarget; }} onClick={e => { if (downOnBackdrop.current && e.target === e.currentTarget) onClose?.(); }} style={{ position: 'fixed', inset: 0, zIndex: 100, display: 'flex', overflowY: 'auto', padding: 24, background: 'rgba(31,31,31,.32)', backdropFilter: 'blur(3px)' }}>
    <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={`${id}-t`} aria-describedby={description ? `${id}-d` : undefined} tabIndex={-1} onKeyDown={onKeyDown} style={{ width: '100%', maxWidth: width, margin: 'auto', outline: 'none', background: 'var(--surface-card)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-subtle)', boxShadow: 'var(--shadow-3)', fontFamily: 'var(--font-sans)' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '20px 20px 0 24px' }}>
        <div style={{ flex: 1, paddingTop: 4 }}>
          <div id={`${id}-t`} style={{ fontSize: 18, fontWeight: 500, letterSpacing: '-0.015em', color: 'var(--text-strong)', overflowWrap: 'anywhere' }}>{title}</div>
          {description && <div id={`${id}-d`} style={{ marginTop: 6, fontSize: 14, color: 'var(--text-muted)', textWrap: 'pretty' }}>{description}</div>}
        </div>
        {onClose && <IconButton icon="x" label="Close" size="sm" onClick={onClose} />}
      </div>
      {children && <div style={{ padding: '16px 24px 0' }}>{children}</div>}
      {actions && <div style={{ display: 'flex', justifyContent: 'flex-end', flexWrap: 'wrap', gap: 8, padding: 24 }}>{actions}</div>}
    </div>
  </div>;
}
