import React from 'react';
import { injectCss } from '../core/css.js';
import { Icon } from '../core/Icon.jsx';
import { Field } from './Field.jsx';
export const FIELD_CSS = `.ts-in{display:flex;align-items:center;gap:8px;height:40px;padding:0 12px;border-radius:var(--radius-sm);background:var(--surface-card);border:1px solid var(--border-default);color:var(--text-strong);transition:border-color var(--dur-fast) var(--ease-out),box-shadow var(--dur-fast) var(--ease-out)}
.ts-in:hover{border-color:var(--border-strong)}.ts-in:focus-within{border-color:var(--blue-500);box-shadow:0 0 0 3px rgba(67,164,196,.22)}
.ts-in[data-error="true"]{border-color:var(--clay-500)}.ts-in[data-disabled="true"]{opacity:.5}
.ts-in input,.ts-in select{flex:1;min-width:0;height:100%;border:0;outline:0;background:transparent;color:inherit;font:inherit;font-size:14px;appearance:none}
.ts-in input::placeholder{color:var(--text-faint)}`;
export function Input({ label, hint, error, icon, mono, suffix, disabled, id, style, ...rest }) {
  injectCss('field', FIELD_CSS);
  return <Field label={label} hint={hint} error={error} htmlFor={id}>
    <span className="ts-in" data-error={!!error} data-disabled={!!disabled} style={{ fontFamily: mono ? 'var(--font-mono)' : 'var(--font-sans)', ...style }}>
      {icon && <span style={{ color: 'var(--text-muted)' }}><Icon name={icon} size={15} /></span>}
      <input id={id} disabled={disabled} {...rest} />
      {suffix && <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-muted)' }}>{suffix}</span>}
    </span>
  </Field>;
}
