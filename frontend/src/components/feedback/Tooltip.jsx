import React from 'react';
export function Tooltip({ label, side = 'top', children }) {
  const [on, setOn] = React.useState(false);
  const pos = side === 'top' ? { bottom: 'calc(100% + 6px)', left: '50%', transform: 'translateX(-50%)' } : side === 'bottom' ? { top: 'calc(100% + 6px)', left: '50%', transform: 'translateX(-50%)' } : side === 'left' ? { right: 'calc(100% + 6px)', top: '50%', transform: 'translateY(-50%)' } : { left: 'calc(100% + 6px)', top: '50%', transform: 'translateY(-50%)' };
  return <span style={{ position: 'relative', display: 'inline-flex' }} onMouseEnter={() => setOn(true)} onMouseLeave={() => setOn(false)} onFocus={() => setOn(true)} onBlur={() => setOn(false)}>
    {children}
    <span role="tooltip" style={{ position: 'absolute', ...pos, zIndex: 50, padding: '5px 8px', borderRadius: 'var(--radius-xs)', background: 'var(--ink-900)', color: 'var(--bone-100)', fontFamily: 'var(--font-mono)', fontSize: 11, whiteSpace: 'nowrap', pointerEvents: 'none', opacity: on ? 1 : 0, transition: 'opacity var(--dur-fast) var(--ease-out)' }}>{label}</span>
  </span>;
}
