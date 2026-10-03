/** JEV maliciousness score as a row of mosaic tiles (tesserae). Verdigris → ochre → clay past threshold. */
export interface ScoreMeterProps {
  /** 0–1 */
  score: number;
  tiles?: number;
  label?: string;
  showValue?: boolean;
  /** block threshold 0–1, default 0.7 */
  threshold?: number;
  tone?: 'light' | 'dark';
  style?: React.CSSProperties;
}
export declare function ScoreMeter(props: ScoreMeterProps): JSX.Element;
