/**
 * Surface container. paper (default) on bone; glass floats over pixel-art imagery; ink for terminal/dark panels.
 */
export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: 'paper' | 'sunken' | 'glass' | 'glass-dark' | 'ink';
  /** px or CSS value, default 24 */
  padding?: number | string;
  radius?: string;
  children?: React.ReactNode;
}
export declare function Card(props: CardProps): JSX.Element;
