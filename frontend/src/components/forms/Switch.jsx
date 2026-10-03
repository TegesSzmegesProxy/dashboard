import React from 'react';
import { injectCss } from '../core/css.js';
import { CHOICE_CSS } from './Checkbox.jsx';
export function Switch({ label, checked, defaultChecked, onChange, disabled, ...rest }) {
  injectCss('choice', CHOICE_CSS);
  return <label className="ts-ch ts-sw" data-disabled={!!disabled}>
    <input type="checkbox" role="switch" checked={checked} defaultChecked={defaultChecked} onChange={e => onChange && onChange(e.target.checked, e)} disabled={disabled} {...rest} />
    <span className="track"><span className="knob" /></span>
    {label}
  </label>;
}
