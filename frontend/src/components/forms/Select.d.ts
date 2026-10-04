export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  hint?: string;
  error?: string;
  options: Array<string | { value: string; label: string }>;
  mono?: boolean;
}
export declare function Select(props: SelectProps): JSX.Element;
