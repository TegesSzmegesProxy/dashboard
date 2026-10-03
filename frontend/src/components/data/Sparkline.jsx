import React from 'react';
export function Sparkline({ data = [], width = 120, height = 32, color = 'var(--text-strong)', fill = true, style }) {
  if (!data.length) return null;
  const max = Math.max(...data), min = Math.min(...data), r = max - min || 1;
  const pts = data.map((v, i) => [(i / (data.length - 1)) * width, height - 2 - ((v - min) / r) * (height - 4)]);
  const d = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
  return <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" style={{ display: 'block', overflow: 'visible', ...style }}>
    {fill && <path d={`${d} L${width} ${height} L0 ${height} Z`} fill={color} opacity=".08" />}
    <path d={d} fill="none" stroke={color} strokeWidth="1.25" vectorEffect="non-scaling-stroke" />
  </svg>;
}
