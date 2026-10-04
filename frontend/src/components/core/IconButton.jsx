import React from 'react';
import { injectCss } from './css.js';
import { Icon } from './Icon.jsx';
const CSS = `.ts-ib{display:inline-flex;align-items:center;justify-content:center;border-radius:var(--radius-pill);border:1px solid transparent;cursor:pointer;color:var(--text-body);background:transparent;transition:background var(--dur-fast) var(--ease-out),color var(--dur-fast) var(--ease-out)}
.ts-ib:hover:not(:disabled){background:var(--border-subtle);color:var(--text-strong)}.ts-ib:active:not(:disabled){transform:translateY(1px)}
.ts-ib:focus-visible{outline:2px solid var(--focus-ring);outline-offset:2px}.ts-ib:disabled{opacity:.42;cursor:not-allowed}
.ts-ib--outline{border-color:var(--border-default)}.ts-ib--outline:hover:not(:disabled){border-color:var(--border-strong)}
.ts-ib--solid{background:var(--ink-900);color:var(--bone-100)}.ts-ib--solid:hover:not(:disabled){background:var(--stone-700);color:var(--bone-50)}`;
export function IconButton({ icon, label, variant = 'ghost', size = 'md', ...rest }) {
  injectCss('ib', CSS);
  const px = { sm: 28, md: 36, lg: 44 }[size];
  return <button className={`ts-ib ts-ib--${variant}`} aria-label={label} title={label} style={{ width: px, height: px }} {...rest}><Icon name={icon} size={size === 'sm' ? 14 : 16} /></button>;
}
