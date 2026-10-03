import type { IconName } from './Icon';
/**
 * Pill button. Primary = Tessera blue with ink text; secondary = ink; outline; ghost; bone (on dark/photo); danger (clay).
 * @startingPoint section="Core" subtitle="Pill buttons in six variants" viewport="700x260"
 */
export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'bone' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  iconLeft?: IconName;
  iconRight?: IconName;
  /** stretch to container width */
  full?: boolean;
  children?: React.ReactNode;
}
export declare function Button(props: ButtonProps): JSX.Element;
