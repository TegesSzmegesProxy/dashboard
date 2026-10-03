import React from 'react';
import { ICONS } from './icons.js';
export function Icon({ name, size = 16, strokeWidth = 1.5, style, ...rest }) {
  const body = ICONS[name] || '';
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flex: 'none', display: 'block', ...style }} dangerouslySetInnerHTML={{ __html: body }} {...rest} />;
}
