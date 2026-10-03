import React from 'react';
export function Field({ label, hint, error, htmlFor, children }) {
  return <label htmlFor={htmlFor} style={{ display: 'flex', flexDirection: 'column', gap: 6, fontFamily: 'var(--font-sans)' }}>
    {label && <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-strong)' }}>{label}</span>}
    {children}
    {(error || hint) && <span style={{ fontSize: 12, color: error ? 'var(--clay-600)' : 'var(--text-muted)' }}>{error || hint}</span>}
  </label>;
}
