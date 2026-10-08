export type IconName = 'shield'|'shield-check'|'shield-alert'|'shield-x'|'arrow-right'|'arrow-up-right'|'check'|'x'|'chevron-down'|'chevron-right'|'search'|'settings'|'activity'|'gauge'|'file-code'|'terminal'|'server'|'globe'|'lock'|'key-round'|'bell'|'circle-alert'|'info'|'eye'|'filter'|'copy'|'external-link'|'plus'|'minus'|'refresh-cw'|'zap'|'layers'|'git-branch'|'book-open'|'log-out'|'user'|'clock'|'scan-line'|'route'|'database'|'sliders-horizontal'|'ellipsis'|'play'|'pause'|'landmark'|'ticket'|'menu';
export interface IconProps {
  /** Lucide icon name (subset copied into the system) */
  name: IconName;
  /** px, default 16 */
  size?: number;
  /** default 1.5 — keep at 1.5 everywhere */
  strokeWidth?: number;
  style?: React.CSSProperties;
}
export declare function Icon(props: IconProps): JSX.Element;
