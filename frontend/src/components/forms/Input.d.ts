import type { IconName } from '../core/Icon';
export interface InputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'prefix'> {
  label?: string;
  hint?: string;
  error?: string;
  icon?: IconName;
  /** monospace value — use for hosts, routes, regexes */
  mono?: boolean;
  /** trailing unit text, e.g. "ms" */
  suffix?: string;
}
export declare function Input(props: InputProps): JSX.Element;
