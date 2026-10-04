export interface SparklineProps {
  data: number[];
  width?: number;
  height?: number;
  color?: string;
  fill?: boolean;
  style?: React.CSSProperties;
}
export declare function Sparkline(props: SparklineProps): JSX.Element | null;
