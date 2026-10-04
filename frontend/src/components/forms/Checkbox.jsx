import React from 'react';
import { injectCss } from '../core/css.js';
import { Icon } from '../core/Icon.jsx';
export const CHOICE_CSS = `.ts-ch{display:inline-flex;align-items:center;gap:10px;font-family:var(--font-sans);font-size:14px;color:var(--text-body);cursor:pointer;user-select:none}
.ts-ch input{position:absolute;opacity:0;width:0;height:0}
.ts-ch .box{width:18px;height:18px;flex:none;display:inline-flex;align-items:center;justify-content:center;border:1px solid var(--border-strong);background:var(--surface-card);color:var(--ink-900);transition:all var(--dur-fast) var(--ease-out)}
.ts-ch:hover .box{border-color:var(--text-strong)}
.ts-ch input:checked+.box{background:var(--accent);border-color:var(--accent)}
.ts-ch input:focus-visible+.box{outline:2px solid var(--focus-ring);outline-offset:2px}
.ts-ch input:disabled+.box{opacity:.4}.ts-ch[data-disabled="true"]{cursor:not-allowed;color:var(--text-faint)}
.ts-ch .dot{width:6px;height:6px;background:var(--ink-900);opacity:0}.ts-ch input:checked+.box .dot{opacity:1}
.ts-sw .track{width:34px;height:20px;border-radius:999px;background:var(--bone-400);position:relative;flex:none;transition:background var(--dur-base) var(--ease-out)}
.ts-sw .knob{position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:999px;background:var(--bone-50);box-shadow:var(--shadow-1);transition:transform var(--dur-base) var(--ease-out)}
.ts-sw input:checked+.track{background:var(--accent)}.ts-sw input:checked+.track .knob{transform:translateX(14px)}
.ts-sw input:focus-visible+.track{outline:2px solid var(--focus-ring);outline-offset:2px}`;
export function Checkbox({ label, checked, defaultChecked, onChange, disabled, ...rest }) {
  injectCss('choice', CHOICE_CSS);
  return <label className="ts-ch" data-disabled={!!disabled}>
    <input type="checkbox" checked={checked} defaultChecked={defaultChecked} onChange={e => onChange && onChange(e.target.checked, e)} disabled={disabled} {...rest} />
    <span className="box" style={{ borderRadius: 'var(--radius-xs)' }}><Icon name="check" size={13} strokeWidth={2.25} /></span>
    {label}
  </label>;
}
