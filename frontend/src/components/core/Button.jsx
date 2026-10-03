import React from 'react';
import { injectCss } from './css.js';
import { Icon } from './Icon.jsx';
const CSS = `.ts-btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;border:1px solid transparent;border-radius:var(--radius-pill);font-family:var(--font-sans);font-weight:500;letter-spacing:-0.005em;cursor:pointer;white-space:nowrap;transition:background var(--dur-fast) var(--ease-out),color var(--dur-fast) var(--ease-out),border-color var(--dur-fast) var(--ease-out),transform var(--dur-fast) var(--ease-out)}
.ts-btn:active:not(:disabled){transform:translateY(1px)}
.ts-btn:focus-visible{outline:2px solid var(--focus-ring);outline-offset:2px}
.ts-btn:disabled{opacity:.42;cursor:not-allowed}
.ts-btn--sm{height:32px;padding:0 14px;font-size:13px}.ts-btn--md{height:40px;padding:0 18px;font-size:14px}.ts-btn--lg{height:48px;padding:0 24px;font-size:15px}
.ts-btn--primary{background:var(--accent);color:var(--accent-fg)}.ts-btn--primary:hover:not(:disabled){background:var(--blue-300)}
.ts-btn--secondary{background:var(--ink-900);color:var(--bone-100)}.ts-btn--secondary:hover:not(:disabled){background:var(--stone-700)}
.ts-btn--outline{background:transparent;color:var(--text-strong);border-color:var(--border-strong)}.ts-btn--outline:hover:not(:disabled){border-color:var(--text-strong)}
.ts-btn--ghost{background:transparent;color:var(--text-body)}.ts-btn--ghost:hover:not(:disabled){background:var(--border-subtle);color:var(--text-strong)}
.ts-btn--bone{background:var(--bone-50);color:var(--ink-900)}.ts-btn--bone:hover:not(:disabled){background:var(--bone-200)}
.ts-btn--danger{background:var(--clay-500);color:var(--bone-50)}.ts-btn--danger:hover:not(:disabled){background:var(--clay-600)}`;
export function Button({ variant = 'primary', size = 'md', iconLeft, iconRight, full, children, className = '', style, ...rest }) {
  injectCss('btn', CSS);
  const is = size === 'lg' ? 16 : 15;
  return <button className={`ts-btn ts-btn--${variant} ts-btn--${size} ${className}`} style={{ width: full ? '100%' : undefined, ...style }} {...rest}>
    {iconLeft && <Icon name={iconLeft} size={is} />}{children}{iconRight && <Icon name={iconRight} size={is} />}
  </button>;
}
