import React from 'react';
import { injectCss } from '../core/css.js';
import { CHOICE_CSS } from './Checkbox.jsx';
export function Radio({ label, name, value, checked, defaultChecked, onChange, disabled, ...rest }) {
  injectCss('choice', CHOICE_CSS);
  return <label className="ts-ch" data-disabled={!!disabled}>
    <input type="radio" name={name} value={value} checked={checked} defaultChecked={defaultChecked} onChange={e => onChange && onChange(value, e)} disabled={disabled} {...rest} />
    <span className="box" style={{ borderRadius: 999 }}><span className="dot" style={{ borderRadius: 999 }} /></span>
    {label}
  </label>;
}
