/**
 * Single metric: mono uppercase label, large light numeral, optional delta + sparkline.
 * @startingPoint section="Data" subtitle="Metric tiles for dashboards" viewport="700x200"
 */
export interface StatTileProps {
  label: string;
  value: React.ReactNode;
  unit?: string;
  delta?: string;
  deltaTone?: 'good' | 'bad' | 'neutral';
  trend?: number[];
  trendColor?: string;
  variant?: 'paper' | 'ink';
  style?: React.CSSProperties;
}
export declare function StatTile(props: StatTileProps): JSX.Element;
