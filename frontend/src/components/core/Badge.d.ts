/** Verdict badge — square dot (a mosaic tile), mono uppercase label. */
export interface BadgeProps {
  status?: 'blocked' | 'passed' | 'review' | 'jev' | 'neutral';
  /** show the square status tile, default true */
  dot?: boolean;
  children?: React.ReactNode;
  style?: React.CSSProperties;
}
export declare function Badge(props: BadgeProps): JSX.Element;
