import React from 'react';
import { injectCss } from '../core/css.js';
import { Icon } from '../core/Icon.jsx';
import { Field } from './Field.jsx';
import { FIELD_CSS } from './Input.jsx';
export function Select({ label, hint, error, options = [], mono, id, style, ...rest }) {
  injectCss('field', FIELD_CSS);
  return <Field label={label} hint={hint} error={error} htmlFor={id}>
    <span className="ts-in" data-error={!!error} style={{ position: 'relative', paddingRight: 8, fontFamily: mono ? 'var(--font-mono)' : 'var(--font-sans)', ...style }}>
      <select id={id} {...rest}>{options.map(o => typeof o === 'string' ? <option key={o} value={o}>{o}</option> : <option key={o.value} value={o.value}>{o.label}</option>)}</select>
      <span style={{ color: 'var(--text-muted)', pointerEvents: 'none' }}><Icon name="chevron-down" size={15} /></span>
    </span>
  </Field>;
}
